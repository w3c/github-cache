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
// and don't forget to use next() im between for each router/middleware
// you'll then see those time info added to the log

const gh = require("./octokit-cache.js");

let request_current = 0;
let request_total = 0;
let request_error = 0;
let request_warning = 0;
let name = "Generic Express Monitor";

let logs = [];
let MAX_ENTRIES = 200;

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
    exports.log(req.method + " " + req.originalUrl);
    request_total++;
    request_current++;
    req.startTime = Date.now();
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
    res.set("Access-Control-Allow-Origin", "*");
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
    res.set("Access-Control-Allow-Origin", "*");
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
    res.set("Access-Control-Allow-Origin", "*");
    res.send(output);
    next();
  });

  // simple way to check if the server is alive
  app.get(path + "/ping", (req, res, next) => {
    res.set("Content-Type", "text/plain");
    res.set("Access-Control-Allow-Origin", "*");
    res.send("pong");
    next();
  });

  // simple way to check if the server is alive
  app.get(path + "/usage", (req, res, next) => {
    res.set("Content-Type", "application/json");
    res.set("Access-Control-Allow-Origin", "*");
    const obj = process.memoryUsage();
    obj.status = "ok";
    obj.name = name;
    obj.uptime = process.uptime();
    obj.cpuUsage = process.cpuUsage();
    obj.requests = {total: request_total, current: request_current, errors: request_error, warnings: request_warning};
    gh.request("GET /rate_limit")
      .then(data => data.data)
      .catch(() => {
        return {error: "unreachable"};
      })
      .then(data => {
        obj.GitHub = data;
        obj.GitHub.minimumRemaining = gh.getMinimumRemaining();
        res.send(JSON.stringify(obj));
        next();
      });
  });

  app.all(path + "/beacon", (req, res, next) => {
    let origin = req.headers.origin;
    if (!ALLOW_ORIGINS.includes(origin)) {
      origin = "http://localhost:8000/"; // denied, invalid origin
    }
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    return next();
  });

  app.post(path + "/beacon", require("body-parser").text(), (req, res, next) => {
    try {
      const entry = JSON.parse(req.body);
      entry.referer = req.headers.referer;
      if (entry.referer) {
        beacon_add(entry);
      }
      res.status(200).send();
    } catch (error) {
      exports.error(error);
      res.status(500).send("mayday");
    }
    next();
  });

  app.get(path + "/beacon", (req, res, next) => {
    res.set("Content-Type", "application/json");
    res.send(JSON.stringify(beacons));
    next();
  });


};

exports.stats = (app) => {
  app.use((req, res, next) => {
    let log = req.method + " " + req.originalUrl;
    if (req.get("traceparent") !== undefined) {
      log = "[" + req.get("traceparent") + "] " + log;
    }
    logStat("[" + (Date.now() - req.startTime) + "ms] " + log);
    request_current--;
    next();
  });
};
