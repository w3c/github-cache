/* eslint-env node */
"use strict";

// const monitor  = require('./monitor.js');
// let app = express();
// monitor.setName("MyService");
// monitor.install(app, [options]);
//
// options.path - HTTP root path for the monitor, default is /monitor
// options.entries - max number of entries to return in the log
//
// This will expose the following resources
// /monitor/logs
// /monitor/ping
// /monitor/usage

// if you want server HTTP header, add the following before send
//   res.sendServerTiming();
// if you want server timing logged, add the following after all router/middleware
//   monitor.stats(app);
// and don't forget to use next() in between for each router/middleware
// you'll then see those time info added to the log

const config = require("./config.js");
const cache = require("./cache.js");
const email = require("./email.js");
const {performance} = require("perf_hooks");
const v8 = require("v8");
const os = require("os");
const {sendObject, sendError} = require("./utils.js");

let request_current = 0;
let include_current = false;
let request_total = 0;
let request_error = 0;
let request_warning = 0;
let name = "Generic Express Monitor";

const buffers = {
  logs: [],
  gh_logs: [],
  error_logs: [],
  beacons: [],
}

let MAX_ENTRIES = 500;

function add(logger, msg) {
  let buffer = buffers[logger];
  if (buffer.length === (MAX_ENTRIES * 2)) {
    // reset the buffer to only contain the max number of entries
    buffers[logger] = buffer = buffer.slice(MAX_ENTRIES);
  }
  buffer.push(msg);
  if (config.debug) {
    if (logger !== "beacons") {
      console.log(msg);
    }
  } else {
    if (logger !== "beacons" && logger !== "gh_logs") {
      process.nextTick(() => {
        console.log(msg);
      });
    }
  }
}

function log_add(msg) {
  add("logs", msg);
}

function gh_add(msg) {
  add("gh_logs", msg);
}

function error_add(msg) {
  email(msg);
  add("error_logs", msg);
}

// for beacon API
function beacon_add(entry) {
  add("beacons", entry);
}

function getDate(msg) {
  if (config.debug) {
    return msg;
  }
  return "[" + (new Date()).toISOString() + "] " + msg;
}

const logStat = (msg) => {
  const args = "[stat] " + msg;
  log_add(args);
};

exports.setName = (newName) => {
  name = newName;
}

exports.log = (msg) => {
  const args = "[log] " + getDate(msg);
  log_add(args);
};

exports.gh_log = (msg) => {
  const args = "[gh_log] " + getDate(msg);
  gh_add(args);
};

exports.warn = (msg) => {
  const args = "[warn] " + getDate(msg);
  request_warning++;
  log_add(args);
};

exports.error = (msg) => {
  request_error++;
  const args = "[err] " + getDate(msg);
  log_add(args);
  error_add(args);
};

const serverTimings = {};
function add_timing(measure) {
  const v = serverTimings[measure.name] || {count: 0, min: Number.POSITIVE_INFINITY, max: 0};
  const dur = measure.end - measure.start;
  if (dur > v.max) {
    v.max = dur;
  }
  if (dur < v.min) {
    v.min = dur;
  }
  v.count++;
  serverTimings[measure.name] = v;
}

function formatTiming(number) {
  return Math.trunc(number * 1000) / 1000;
}

class Measure {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.start = performance.now();
  }
  stop() {
    this.end = performance.now();
  }
}

class ServerTiming {
  constructor() {
    this.measures = [];
    this.startTime = performance.now();
  }
  getMeasure(name, description) {
    const measure = new Measure(name, description);
    this.measures.push(measure);
    return measure;
  }
  getHeader() {
    let header = `r;dur=${formatTiming(performance.now() - this.startTime)}`;
    let order = 1;
    if (this.measures.length < 10) {
      this.measures.forEach(measure => {
        if (measure.end) {
          const withDesc = (measure.description) ? `;desc="${measure.description}"` : "";
          header += `, ${measure.name}s${order};dur=${formatTiming(measure.start - this.startTime)}` + withDesc;
          header += `, ${measure.name}e${order};dur=${formatTiming(measure.end - this.startTime)}` + withDesc;
          order++;
          add_timing(measure);
        }
      });
    } else {
      const new_measures = {};
      this.measures.forEach(measure => {
        if (measure.end) {
          const entry = new_measures[measure.name];
          if (!entry) {
            new_measures[measure.name] = Object.assign({}, measure);
          } else if (entry.end < measure.end) {
            entry.end = measure.end;
          }
          add_timing(measure);
        }
      });
      Object.values(new_measures).forEach(measure => {
        const withDesc = (measure.description) ? `;desc="${measure.description}"` : "";
        header += `, ${measure.name}s${order};dur=${formatTiming(measure.start - this.startTime)}` + withDesc;
        header += `, ${measure.name}e${order};dur=${formatTiming(measure.end - this.startTime)}` + withDesc;
        order++;
      });
    }
    return {name: "Server-Timing", value: header};
  }
}

let ALLOW_ORIGINS = ["http://localhost:8080"];
exports.install = (app, options) => {
  let path = "/monitor";
  if (options !== undefined) {
    if (options.path !== undefined) {
      path = options.path;
    }
    if (options.entries !== undefined) {
      MAX_ENTRIES = options.entries;
    }
    if (options.allowOrigins !== undefined) {
      ALLOW_ORIGINS = options.allowOrigins;
    }
  }

  // monitor all methods
  app.use((req, res, next) => {
    let st_sent = false;
    res.serverTiming = new ServerTiming();
    if (config.debug) {
      exports.log(`${req.method} ${req.originalUrl}`);
    }
    request_total++;
    request_current++;
    res.measure = (...args) => { // convenient shortcut
      return res.serverTiming.getMeasure(...args);
    }
    res.sendServerTiming = () => {
      const {name, value} = res.serverTiming.getHeader();
      if (!st_sent) {
        res.set(name, value);
      }
      st_sent = true;
    };
    next();
  });

  app.use(path + "/*", (req, res, next) => {
    let origin = req.headers.origin;
    if (!ALLOW_ORIGINS.includes(origin)) {
      origin = (config.debug) ? "*" : "origin-denied";
    }
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // grabs the logs easily
  app.get(path + "/logs", (req, res, next) => {
    process.nextTick(() => {
      console.warn("[monitor] " + getDate("/logs " + req.ips.join(", ")));
    });
    let output = "";
    let begin = buffers.logs.length - MAX_ENTRIES;
    const end = buffers.logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = buffers.logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + buffers.logs[index];
    }
    res.set("Content-Type", "text/plain");
    res.send(output);
    next();
  });

  // grabs the github logs easily
  app.get(path + "/gh_logs", (req, res, next) => {
    process.nextTick(() => {
      console.warn("[monitor] " + getDate("/gh_logs " + req.ips.join(", ")));
    });
    let output = "";
    let begin = buffers.gh_logs.length - MAX_ENTRIES;
    const end = buffers.gh_logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = buffers.gh_logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + buffers.gh_logs[index];
    }
    res.set("Content-Type", "text/plain");
    res.send(output);
    next();
  });

  // grabs the error logs easily
  app.get(path + "/error_logs", (req, res, next) => {
    process.nextTick(() => {
      console.warn("[monitor] " + getDate("/error_logs " + req.ips.join(", ")));
    });
    let output = "";
    let begin = buffers.error_logs.length - MAX_ENTRIES;
    const end = buffers.error_logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = buffers.error_logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + buffers.error_logs[index];
    }
    res.set("Content-Type", "text/plain");
    res.send(output);
    next();
  });

  // simple way to check if the server is alive
  app.get(path + "/ping", (req, res, next) => {
    res.set("Content-Type", "text/plain");
    res.send("pong");
    next();
  });

  // simple way to check if the server is alive
  app.get(path + "/usage", (req, res, next) => {
    const obj = process.memoryUsage();
    obj.status = "ok";
    obj.name = name;
    obj.uptime = process.uptime();
    obj.cpuUsage = process.cpuUsage();
    obj.os = {
      uptime: os.uptime(),
      totalmem: os.totalmem(),
      freemem: os.freemem(),
    };
    obj.requests = {total: request_total, errors: request_error, warnings: request_warning, timings: serverTimings};
    if (include_current) {
      obj.requests.current = request_current;
    }
    obj.v8 = {};
    obj.v8.getHeapSpaceStatistics = v8.getHeapSpaceStatistics();
    obj.v8.getHeapStatistics = v8.getHeapStatistics();
    obj.v8.getHeapCodeStatistics = v8.getHeapCodeStatistics();
    cache.getGitHubRateLimit()
      .then(limits => {
        obj.GitHub = limits;
        res.json(obj);
        next();
      }).catch(err => {
        obj.GitHub = {error: err};
        res.json(obj);
        next();
      });
  });

  app.post(path + "/beacon", require("body-parser").text(), (req, res, next) => {
    async function process() {
      const now = performance.now();
      const data = JSON.parse(req.body);
      data.referer = req.headers.referer;
      if (data.referer && data.traceId && data.resources && Array.isArray(data.resources)) {
        for (const rt of data.resources) {
          rt.referer = data.referer;
          rt.receivedAt = now;
          rt.traceId = data.traceId;
          if (rt.serverTiming) {
            const ste = rt.serverTiming.find(e => e.name == "r");
            if (ste && ste.duration > rt.duration) {
              // it came from the browser cache, so discard those
              rt.serverTiming = [];
            }
          }
          beacon_add(rt);
        }
      }
    }
    res.status(204).end();
    process().catch(exports.error);
    next();
  });

  app.get(path + "/beacon", (req, res, next) => {
    res.json(buffers.beacons);
    next();
  });

  app.get(path + "/clear_beacon", (req, res, next) => {
    buffers.beacons = [];
    res.status(204).end();
    next();
  });

  if (config.debug) {
    app.get(path + "/cache", (req, res, next) => {
      const num = req.query.n;
      let p;
      if (num) {
        p = cache.getCacheEntryByNumber(req.query.n);
      } else {
        p = cache.getCacheEntries();
      }
      p.then(data => sendObject(req, res, next, data))
        .catch(err => sendError(req, res, next, err));
    });
  }

};

exports.stats = (app) => {
  app.use((req, res, next) => {
    let log = req.method + " " + req.originalUrl;
    if (req.get("traceparent") !== undefined) {
      log = "[" + req.get("traceparent") + "] " + log;
    }
    logStat("[" + (performance.now() - res.serverTiming.startTime) + "ms] " + log);
    request_current--;
    include_current = true;
    next();
  });
};
