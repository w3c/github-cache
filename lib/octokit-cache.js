/* eslint-env node */

"use strict";

const monitor = require('./monitor.js');
const io = require('./io.js');
const config = require("./config.js");
const Octokit = require("@octokit/core").Octokit
  .plugin(require("@octokit/plugin-throttling"));
const {performance} = require('perf_hooks');

// the cache directory
const DIR = (config.cache && config.cache.dir) ? config.cache.dir : "cache";
// how many files per subdirectories
const PER_DIR = (config.cache && config.cache.file_per_directory) ? config.cache.file_per_directory : 1000;

/* read a JSON file and return an object, using Promise
   Used directly readCacheEntry and init
   */
const readFile = async (filename) => {
  return io.readFile(DIR + '/' + filename).then(JSON.parse);
};

// remember the cache files you already loaded
// should I use a WeakMap instead?
const FILES = {};
/* Read a cache entry based on its number */
const readCacheEntry = async (entry) => {
  let file = FILES[entry.num];
  if (!file) {
    file = readFile('' + Math.floor(entry.num / PER_DIR) + '/' + entry.num + ".json");
    FILES[entry.num] = file;
  }
  return file;
};

/* Create a cache subdirectory if needed */
let DIRS = { }; // remember which subdirectory you created
const mkdir = (path) => {
  path = DIR + '/' + path;
  if (DIRS[path]) {
    return Promise.resolve(path);
  } else {
    return io.mkdir(path).catch(() => {
      DIRS[path] = true;
      return path;
    });
  }
};


/* save a JSON file and return an object, using Promise
   Used directly saveCacheEntry and savedEntries
   */
const writeFile = (filename, obj) => {
  return io.writeFile(DIR + '/' + filename, obj);
};

/* Save a cache entry based on its number. Create the subdirectory if needed */
const writeCacheEntry = (entry, obj) => {
  const path = '' + Math.floor(entry.num / PER_DIR);
  return mkdir(path).then(() => {
    return writeFile(path + '/' + entry.num + ".json", obj)
  });
};

// current number of entries in the cache
let MAX = 0;
// the actual cache entries, indexed by keys
let ENTRIES = undefined;

// initialize the cache. Create cache.json if needed
// TODO: create the cache directory if it doesn't exist?
let _init = undefined;
async function init() {
  if (_init) {
    return _init;
  }
  _init = io.mkdir(DIR).catch(err => err).then(() => {
    return readFile("cache.json")
      .then(data => {
        MAX = data.max;
        ENTRIES = data.entries;
        for (const keys in ENTRIES) {
          const entry = ENTRIES[keys];
          entry.time = new Date(entry.time);
        }
        DIRS = data.dirs;
      }).catch(() => {
        monitor.warn(`Initialize ${DIR}/cache.json`);
        return writeFile("cache.json", {
          max: 0,
          dirs: DIRS,
          entries: {}
        }).then(() => ENTRIES = {});
      });
  });
  return _init;
}

/* This part is about saving the cache state, from time to time */

let _needSaveEntries = undefined;
// save the cache state
function saveEntries() {
  _needSaveEntries = undefined;
  return writeFile("cache.json", {
    max: MAX,
    dirs: DIRS,
    entries: ENTRIES
  }).catch(monitor.error);
}
function scheduleSaveEntries() {
  if (!_needSaveEntries) {
    // there is no need to always save cache.json every single time
    _needSaveEntries = setTimeout(saveEntries, 60000); // wait 60s before writing
  }
}

const MAX_RETRIES = 3;

const octokit = new Octokit({
  auth: config.ghToken,
  throttle: {
    onRateLimit: (retryAfter, options) => {
      if (options.request.retryCount < MAX_RETRIES) {
        monitor.warn(`Rate limit exceeded, retrying after ${retryAfter} seconds`)
        return true;
      } else {
        monitor.error(`Rate limit exceeded, giving up after ${MAX_RETRIES} retries`);
        return false;
      }
    },
    onAbuseLimit: (retryAfter, options) => {
      if (options.request.retryCount < MAX_RETRIES) {
        monitor.warn(`Abuse detection triggered, retrying after ${retryAfter} seconds`)
        return true;
      } else {
        monitor.error(`Abuse detection triggered, giving up after ${MAX_RETRIES} retries`);
        return false;
      }
    }
  }
});

function isExpired(previous, ttl) {
  const current = new Date();
  if (ttl > 0) {
    current.setMinutes(current.getMinutes() - ttl);
  }
  // we stop invalidating entry if we're too low
  return (REMAINING < 200 || previous <= current);
}

let REMAINING = 5000;
let MIN_REMAINING = 5000;

let resetId = undefined;

function resetRemaining() {
  if (resetId === undefined) {
    // wait one hour
    resetId = setTimeout(() => {
      REMAINING = 5000; resetId = undefined;
    }, 3600000);
  }
}

octokit.hook.after("request", async (payload) => {
  REMAINING = Number.parseInt(payload.headers['x-ratelimit-remaining']);
  if (REMAINING < MIN_REMAINING) {
    MIN_REMAINING = REMAINING;
  }
  monitor.gh_log(`${payload.status} ${REMAINING} ${payload.url}`);
});

octokit.hook.error("request", async (error) => {
  REMAINING = Number.parseInt(error.headers['x-ratelimit-remaining']);
  if (error.status != 304) {
    monitor.gh_log(`${error.status} ${REMAINING} ${error.request.url}`);
  }
  throw error;
});

octokit.getMinimumRemaining = () => {
  return MIN_REMAINING;
}

// this is where the magic happens
// uses HTTP ETag and GitHub 'since' parameter to minimize the impact on
//  api.github.com as much as possible

octokit.get = async function(request, response, query_url) {
  if (response) {
    response.serverTiming.set('github', 0);
  }
  const params = {};
  if (!ENTRIES) {
    await init();
  }

  // anything below 1 forces a total refresh of the cache
  const ttl = (request && request.ttl !== undefined) ? request.ttl : config.ttl;
  delete params.ttl; // we don't need to keep that anymore
  let entry = ENTRIES[query_url];
  let cached_data, returned_data;
  if (entry && ttl >= 0) {
    // cached_data is to remember the stale data later if needed
    // note that we don't have await here
    returned_data = cached_data = readCacheEntry(entry);

    // avoid unhandled promise rejection
    cached_data.catch(() => {});

    if (isExpired(entry.time, ttl)) {
      returned_data = FILES[entry.num] = undefined;
    }
  }
  if (returned_data) {
    return returned_data;
  }
  if (REMAINING <= 50) { // 50 just in case we have pending requests...
    resetRemaining();
    throw new Error(`no remaining GitHub requests`);
  }
  let should_use_old_data = false;
  if (entry && ttl >= 0) {
    // the entry is expired
    if (query_url.endsWith("/issues")
        || query_url.indexOf("/issues?") != -1
        || query_url.endsWith("/comments")
        || query_url.endsWith("/commits")) {
      // but some is still valid in cached_data
      // not all GitHub List supports "since"
      params.since = entry.time.toISOString();
      should_use_old_data = true;
    }
    if (entry.etag) {
      params.headers = {"If-None-Match": entry.etag};
    }
  }
  async function gh_get(url) {
    let new_data = [];
    let etag = undefined;
    let resp;
    const start = performance.now();
    while (url) {
      try {
        resp = await octokit.request(`GET ${url}`, params);
      } catch (err) {
        resp = err;
      }
      if (response) {
        response.serverTiming.set('github', Math.round(performance.now() - start));
      }

      if (!resp.headers) {
        // this wasn't an HTTP request error, give up
        throw resp;
      }
      if (!etag) {
        etag = resp.headers.etag;
      }
      if (resp.status >= 200 && resp.status <= 299) {
        new_data = new_data.concat(resp.data);
      }
      // from https://github.com/octokit/plugin-paginate-rest.js/blob/master/src/iterator.ts#L32
      url = ((resp.headers.link || "").match(
        /<([^>]+)>;\s*rel="next"/
      ) || [])[1];
    }
    const rate = resp.headers['x-ratelimit-remaining'];
    if (rate && response) {
      response.set('X-Ratelimit-Remaining', rate);
      response.set('X-Ratelimit-Reset', resp.headers['x-ratelimit-reset']);
    }
    if (resp.status === 304) {
      // the entry didn't change on github so exit
      monitor.gh_log(`${resp.status} ${REMAINING} ${resp.request.url}`);
      entry.time = new Date();
      scheduleSaveEntries();
      return cached_data;
    } else if (resp.status === 301) {
      // the entry didn't change on github so exit
      monitor.gh_log(`${resp.status} ${REMAINING} ${resp.request.url}`);
      throw resp;
    } else if (resp.status === 302 || resp.status === 307) {
      // the entry didn't change on github so exit
      // @@TODO
      monitor.gh_log(`${resp.status} ${REMAINING} ${resp.request.url}`);
      throw resp;
    } else if (resp.status >= 400) {
      // safeguard
      throw resp;
    } else if (cached_data && should_use_old_data) {
      // we have old data, so let's merge
      try {
        cached_data = await cached_data; // resolve any potential promise
      } catch (err) {
        cached_data = [];
      }
      if (new_data.length === 0) {
        // no change, no need to overwrite current cache entry
        //  but update the timestamp to make it as fresh as possible
        entry.time = new Date();
        // we don't need to write the data on disk, so return now
        scheduleSaveEntries();
        return cached_data;
      }
      new_data.forEach(value => {
        // I believe all GitHub Lists have objects with id
        const idx = cached_data.findIndex(cached_value => cached_value.id === value.id);
        if (idx === -1) {
          cached_data.push(value);
        } else {
          cached_data[idx] = value;
        }
      })
    } else {
      cached_data = new_data;
    }
    // write the data on disk, without blocking
    writeCacheEntry(entry, cached_data)
      .then(() => scheduleSaveEntries())
      .then(() => entry.etag = etag)
      .catch(err => {
        ENTRIES[query_url] = undefined;
        monitor.error(err)
      });
    return cached_data;
  }

  returned_data = gh_get(query_url);
  if (!entry) {
    entry = { };
    entry.num = MAX++;
    ENTRIES[query_url] = entry;
  }
  FILES[entry.num] = returned_data;
  entry.time = new Date();

  return returned_data;
}

// cache objects

const privateKey = key => "///private/" + key;

octokit.cacheObject = async (key, obj) => {
  const eKey = privateKey(key);
  if (!ENTRIES) {
    await init();
  }

  let entry = ENTRIES[eKey];
  if (!entry) {
    entry = { };
    entry.num = MAX++;
    ENTRIES[eKey] = entry;
  }

  FILES[entry.num] = writeCacheEntry(entry, obj)
    .then(() => scheduleSaveEntries())
    .then(() => entry.etag = "undefined")
    .catch(err => {
      ENTRIES[eKey] = undefined;
      monitor.error(err)
    });
  entry.time = new Date();

  return obj;
}

octokit.getObject = async (key) => {
  const eKey = privateKey(key);
  if (!ENTRIES) {
    await init();
  }
  const entry = ENTRIES[eKey];
  if (entry) {
    return readCacheEntry(entry);
  }
  throw new Error(`unknown object key ${key}`);
}

// for debugging purposes only

octokit.getCacheEntries = async () => {
  if (!ENTRIES) {
    await init();
  }
  return ENTRIES;
}

octokit.getCacheEntryByNumber = async (number) => {
  if (!ENTRIES) {
    await init();
  }
  for (const [key, entry] of Object.entries(ENTRIES)) {
    if (entry.num == number) {
      const obj = {};
      const copy = Object.assign({}, entry);
      copy.value = FILES[entry.num];
      obj[key] = copy;
      return obj;
    }
  }
}

octokit.getCacheEntryByKey = async (key) => {
  if (!ENTRIES) {
    await init();
  }
  const entry = ENTRIES[key];
  let ret;
  if (entry) {
    ret = FILES[entry.num];
  }
  if (ret) {
    return ret;
  }
  throw new Error(`key ${key} not found`);
}

module.exports = octokit;
