/* eslint-env node */

"use strict";

const monitor = require('./monitor.js');
const io = require('./io.js');
const config = require("./config.js");
const Octokit = require("@octokit/core").Octokit
  .plugin(require("@octokit/plugin-throttling"));

// how many files per subdirectories
const PER_DIR = (config.cache && config.cache.file_per_directory) ? config.cache.file_per_directory : 1000;

/* read a JSON file and return an object, using Promise
   Used directly readCacheEntry and init
   */
const readFile = (filename) => {
  return io.readFile(config.cache + '/' + filename).then(JSON.parse);
};

// remember the cache files you already loaded
// should I use a WeakMap instead?
const FILES = {};

/* Read a cache entry based on its number */
const readCacheEntry = async (entry) => {
  if (!FILES[entry.num]) {
    FILES[entry.num] = readFile('' + Math.floor(entry.num / PER_DIR) + '/' + entry.num + ".json")
      .then(data => {
        return FILES[entry.num] = data;
      }).catch(() => {
        return FILES[entry.num] = new CacheStatus(507, "File Not Found");
      });
  }
  return FILES[entry.num];
};

/* Create a cache subdirectory if needed */
let DIRS = { }; // remember which subdirectory you created
const mkdir = (path) => {
  path = config.cache + '/' + path;
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
  return io.writeFile(config.cache + '/' + filename, obj);
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
  _init = io.mkdir(config.cache).catch(err => err).then(() => {
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
        monitor.warn(`Initialize ${config.cache}/cache.json`);
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

// this is where the magic happens
// uses HTTP ETag and GitHub 'since' parameter to minimize the impact on
//  api.github.com as much as possible

class CacheStatus {
  constructor(status, message, data) {
    this.status = status;
    this.message = message;
    this.data = data;
    this.fromGitHubCache = true;
  }
  toString() {
    return `CacheStatus: ${this.status} ${this.message}`;
  }
}

const REQUEST_PENDING = {};

// this function will check GitHub for updates
// DO NOT THROW IN THIS FUNCTION. UNHANDLED PROMISE REJECTIONS HAPPEN IF YOU DO.
octokit.get = async (request, response, query_url, params, should_use_old_data, cached_data, entry, ifModifiedSince, currentEntryTime) => {
  let new_data = [];
  let url = query_url;
  let etag = undefined;
  let resp;
  const measure = (response) ? response.measure('g') : undefined;
  while (url) {
    try {
      resp = await octokit.request(`GET ${url}`, params);
    } catch (err) {
      resp = err;
      if (!resp.headers) {
        // this wasn't an HTTP request error, give up
        monitor.error(`unexpected error ${err}`);
        if (measure) {
          measure.stop();
        }
        return new CacheStatus(500, "BUG in octokit-cache: unexpected error");
      }
    }
    REMAINING = Number.parseInt(resp.headers['x-ratelimit-remaining']);
    if (REMAINING < MIN_REMAINING) {
      MIN_REMAINING = REMAINING;
    }
    monitor.gh_log(`${resp.status} ${REMAINING} ${url}`);
    if (measure) {
      measure.stop();
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
  entry.status = resp.status;
  if (resp.status === 304) {
    // the entry didn't change on github so exit
    entry.time = new Date();
    scheduleSaveEntries();
    if (ifModifiedSince >= currentEntryTime) {
      return new CacheStatus(304, "GitHub said 304");
    }
    return cached_data;
  } else if (resp.status === 301) {
    // the entry didn't change on github so exit
    monitor.error(`Unhandled ${resp.status} ${query_url}`);
    return cached_data;
  } else if (resp.status === 302 || resp.status === 307) {
    // the entry didn't change on github so exit
    // @@TODO
    monitor.error(`Unhandled ${resp.status} ${query_url}`);
    return cached_data;
  } else if (resp.status >= 400) {
    // safeguard
    ENTRIES[query_url].status = resp.status;
    const error = new CacheStatus(resp.status, `Git returned ${resp.status}`);
    if (!FILES[entry.num]) {
      FILES[entry.num] = error;
    }
    return error;
  } else if (cached_data && should_use_old_data) {
    // we have old data, so let's merge
    let old_data;
    try {
      old_data = await cached_data; // resolve any potential promise
    } catch (err) {
      old_data = [];
    }
    if (new_data.length === 0) {
      // no change, no need to overwrite current cache entry
      //  but update the timestamp to make it as fresh as possible
      entry.time = new Date();
      // we don't need to write the data on disk, so return now
      scheduleSaveEntries();
      if (ifModifiedSince > currentEntryTime) {
        entry.status = 200;
      }
      return old_data;
    }
    new_data.forEach(value => {
      // I believe all GitHub Lists have objects with id
      const idx = old_data.findIndex(old_value => old_value.id === value.id);
      if (idx === -1) {
        old_data.push(value);
      } else {
        old_data[idx] = value;
      }
    })
    cached_data = old_data;
  } else {
    cached_data = new_data;
  }
  entry.time = new Date();
  FILES[entry.num] = cached_data;
  // write the data on disk, without blocking
  writeCacheEntry(entry, cached_data)
    .then(() => entry.etag = etag)
    .then(() => scheduleSaveEntries())
    .catch(err => {
      ENTRIES[query_url] = undefined;
      monitor.error(err)
    });
  return cached_data;
}

const CACHE = {};

CACHE.getGitHubRateLimit = async () => {
  try {
    const data = (await octokit.request("GET /rate_limit")).data;
    data.minimumRemaining = MIN_REMAINING;
    return data;
  } catch (err) {
    return {error: "unreachable"};
  }
}

CACHE.get = async function(request, response, query_url) {
  const params = {};
  if (!ENTRIES) {
    await init();
  }

  // anything below 1 forces a total refresh of the cache
  const ttl = (request && request.ttl !== undefined) ? request.ttl : config.ttl;

  let entry = ENTRIES[query_url];
  let cached_data, returned_data;

  let ifModifiedSince;
  const currentEntryTime = (entry) ? entry.time : undefined;

  if (request.get) {
    const header = request.get("if-modified-since");
    if (header) {
      ifModifiedSince = new Date(header);
    }
    // for ETag, we're counting on Node express to use its own cache and return 304
  }

  if (entry && ttl >= 0) {
    const hasExpired = isExpired(currentEntryTime, ttl);

    if (!hasExpired && ifModifiedSince < currentEntryTime) {
      throw new CacheStatus(304, ifModifiedSince.toUTCString());
    }

    // cached_data is to remember the stale data later if needed
    // note that we don't have await here
    if (!entry.status || entry.status < 400) {
      const measure = (response) ? response.measure('r') : undefined;
      returned_data = cached_data = readCacheEntry(entry);

      if (measure) {
        cached_data.finally(() => {
          measure.stop();
        });
      }
    }

    if (hasExpired && REMAINING > 50) {
      returned_data = REQUEST_PENDING[query_url];

      if (returned_data) {
        const measure = (response) ? response.measure('p') : undefined;
        // we're waiting for a github request
        returned_data = await returned_data;
        if (measure) {
          measure.stop();
        }
      }
    } else if (entry.status >= 400) {
      throw new CacheStatus(entry.status, `GitHub returned ${entry.status}`);
    }
  }
  if (returned_data) {
    if (response) {
      //  <day-name>, <day> <month> <year> <hour>:<minute>:<second> GMT
      response.set('Last-Modified', currentEntryTime.toUTCString());
    }
    returned_data = await returned_data;
    if (returned_data instanceof CacheStatus) {
      if (REQUEST_PENDING[query_url]) {
        // we're likely got this with "File Not Found", waiting for a pending request to fill the cache
        const measure = (response) ? response.measure('p') : undefined;
        returned_data = await REQUEST_PENDING[query_url];
        if (measure) {
          measure.stop();
        }
      }
      // try again, but this time, everything should be resolved...
      if (returned_data instanceof CacheStatus) {
        throw returned_data;
      }
    }
    return returned_data;
  }
  if (REMAINING <= 50) { // 50 just in case we have pending requests...
    resetRemaining();
    throw new CacheStatus(503, `GitHub only has ${REMAINING}. Try again in one hour or so.`);
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

  if (!entry) {
    entry = { };
    entry.num = MAX++;
    entry.time = new Date();
    ENTRIES[query_url] = entry;
  }

  const githubRequest = REQUEST_PENDING[query_url] =
    octokit.get(request, response,
      query_url, params, should_use_old_data, cached_data,
      entry, ifModifiedSince, currentEntryTime).catch(err => {
      monitor.error("octokit.get shouldn't throw " + err.message);
      return undefined;
    }).then(data => {
      REQUEST_PENDING[query_url] = undefined;
      if (data === undefined) {
        monitor.error("Improper value from octokit-cache");
        throw new CacheStatus(500, "Improper value. Please report");
      }
      return data;
    });

  if (response) {
    response.set('Last-Modified', entry.time.toUTCString());
  }

  return githubRequest.then(data => {
    if (data instanceof CacheStatus) {
      throw data;
    }
    return data;
  });
}

// cache objects

const privateKey = key => "///private/" + key;

CACHE.cacheObject = async (key, obj) => {
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

CACHE.getObject = async (key) => {
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

CACHE.getCacheEntries = async () => {
  if (!ENTRIES) {
    await init();
  }
  return ENTRIES;
}

CACHE.getCacheEntryByNumber = async (number) => {
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

CACHE.getCacheEntryByKey = async (key) => {
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

module.exports = CACHE;
