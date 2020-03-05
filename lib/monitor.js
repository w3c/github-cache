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

// if you want server timing, add the following after all router/middleware
// monitor.stats(app);
// and don't forget to use next() in between for each router/middleware
// you'll then see those time info added to the log

const config = require("./config.js");
const gh = require("./octokit-cache.js");
const {performance} = require('perf_hooks');
const {sendObject, sendError} = require("./utils.js");

let request_current = 0;
let include_current = false;
let request_total = 0;
let request_error = 0;
let request_warning = 0;
let name = "Generic Express Monitor";

let logs = [];
let MAX_ENTRIES = 500;

function add(msg) {
  if (logs.length === (MAX_ENTRIES * 2)) {
    // reset the logs to only contain the max number of entries
    logs = logs.slice(MAX_ENTRIES);
  }
  logs.push(msg);
}

let gh_logs = [];

function gh_add(msg) {
  if (gh_logs.length === (MAX_ENTRIES * 2)) {
    // reset the logs to only contain the max number of entries
    gh_logs = gh_logs.slice(MAX_ENTRIES);
  }
  gh_logs.push(msg);
}

let error_logs = [];

function error_add(msg) {
  if (error_logs.length === (MAX_ENTRIES * 2)) {
    // reset the logs to only contain the max number of entries
    error_logs = error_logs.slice(MAX_ENTRIES);
  }
  error_logs.push(msg);
}

// for beacon API
let beacons = [];
function beacon_add(entry) {
  if (beacons.length === (MAX_ENTRIES * 2)) {
    // reset the logs to only contain the max number of entries
    beacons = beacons.slice(MAX_ENTRIES);
  }
  beacons.push(entry);
}

function getDate(msg) {
  return "[" + (new Date()).toISOString() + "] " + msg;
}

const logStat = (msg) => {
  const args = "[stat] " + msg;
  add(args);
  process.nextTick(() => console.log(args));
};

exports.setName = (newName) => {
  name = newName;
}

exports.log = (msg) => {
  const args = "[log] " + getDate(msg);
  add(args);
  process.nextTick(() => console.log(args));
};

exports.gh_log = (msg) => {
  gh_add(getDate(msg));
};

exports.warn = (msg) => {
  const args = "[warn] " + getDate(msg);
  request_warning++;
  add(args);
  process.nextTick(() => console.warn(args));
};

exports.error = (msg) => {
  request_error++;
  const args = "[err] " + getDate(msg);
  add(args);
  error_add(args);
  process.nextTick(() => console.error(args));
};

const serverTimings = {};
function add_timing(key, dur) {
  if (dur <= 0) {
    return; // ignore 0 duration
  }
  const v = serverTimings[key] || {total: 0, min: Number.POSITIVE_INFINITY, max: 0, number: 0};
  if (dur > v.max) {
    v.max = dur;
  }
  if (dur < v.min) {
    v.min = dur;
  }
  serverTimings[key] = v;
}

class ServerTiming {
  constructor() {
    this._serverTiming = new Map();
    this._startTime = performance.now();
  }
  set(name, duration, description) {
    let value = this._serverTiming.get(name);
    if (value) {
      value.dur = value.dur + duration;
      if (description) {
        value.desc = description;
      }
    } else {
      value = {dur: duration};
      if (description) {
        value.desc = description;
      }
      this._serverTiming.set(name, {dur: duration, desc: description});
    }
    add_timing(name, duration);
  }
  get(name) {
    return this._serverTiming.get(name);
  }
  forEach(fct) {
    fct("monitor", Math.round(performance.now() - this._startTime));
    this._serverTiming.forEach((value, key) =>
      fct(key, value.dur, value.desc));
  }
  getHeader() {
    let header = "";
    this.forEach((key, value, desc) => {
      header += `, ${key};dur=${value}` + ((desc) ? `;desc="${desc}"` : "");
    });
    return {name: "Server-Timing", value: header.substring(2)};
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
    res.serverTiming = new ServerTiming();
    exports.log(req.method + " " + req.originalUrl);
    request_total++;
    request_current++;
    res.sendServerTiming = () => {
      const {name, value} = res.serverTiming.getHeader();
      res.set(name, value);
    };
    next();
  });

  app.use(path + "/*", (req, res, next) => {
    let origin = req.headers.origin;
    if (!ALLOW_ORIGINS.includes(origin)) {
      origin = "origin-denied"; // denied, invalid origin
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
    let begin = logs.length - MAX_ENTRIES;
    const end = logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + logs[index];
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
    let begin = gh_logs.length - MAX_ENTRIES;
    const end = gh_logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = gh_logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + gh_logs[index];
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
    let begin = error_logs.length - MAX_ENTRIES;
    const end = error_logs.length;
    if (begin < 0) {
      begin = 0;
    }
    output = error_logs[begin++];
    for (let index = begin; index < end; index++) {
      output += "\n" + error_logs[index];
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
    obj.requests = {total: request_total, errors: request_error, warnings: request_warning, timings: serverTimings};
    if (include_current) {
      obj.requests.current = request_current;
    }
    gh.request("GET /rate_limit")
      .then(data => data.data)
      .catch(() => {
        return {error: "unreachable"};
      })
      .then(data => {
        obj.GitHub = data;
        obj.GitHub.minimumRemaining = gh.getMinimumRemaining();
        res.json(obj);
        next();
      });
  });

  app.post(path + "/beacon", require("body-parser").text(), (req, res, next) => {
    res.status(200).send();
    const now = Date.now();
    try {
      const data = JSON.parse(req.body);
      data.referer = req.headers.referer;
      if (data.referer) {
        data.receivedAt = now;
        beacon_add(data);
      }
    } catch (error) {
      exports.error(error);
    }
    next();
  });

  app.get(path + "/beacon", (req, res, next) => {
    res.json(beacons);
    next();
  });

  if (config.debug) {
    app.get(path + "/cache", (req, res, next) => {
      const num = req.query.n;
      let p;
      if (num) {
        p = gh.getCacheEntryByNumber(req.query.n);
      } else {
        p = gh.getCacheEntries();
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
    logStat("[" + (Date.now() - res.startTime) + "ms] " + log);
    request_current--;
    include_current = true;
    next();
  });
};
