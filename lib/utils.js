/* eslint-env node */

"use strict";

const config = require("./config.js");
const monitor = require('./monitor.js');

// encoding is https://nodejs.org/dist/latest/docs/api/buffer.html#buffer_buffers_and_character_encodings
// decoder is "json" or "text"
function decode(content, encoding, decoder = "text") {
  let buffer;
  if (encoding && decoder !== "text") {
    buffer = Buffer.from(content, encoding).toString();
  }
  switch (decoder) {
  case "json":
    try {
      return JSON.parse(buffer);
    } catch (e) {
      return undefined;
    }
  default:
    try {
      return JSON.parse(buffer);
    } catch (e) {
      return {};
    }
  }
}

function sendSecurityHeaders(req, res) {
  let origin = req.headers.origin;
  if (!config.allowOrigins.includes(origin)) {
    origin = (config.debug) ? "*" : "origin-denied";
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set('Access-Control-Request-Headers', 'Server-Timing');
  res.set('Timing-Allow-Origin', origin);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'origin-when-cross-origin, strict-origin-when-cross-origin');
/*  res.set('Report-To', '{"group":"monitor","max_age": 10886400,'
    + '"endpoints": [{"url":"https://labs.w3.org/github-cache/monitor/beacon","priority":1}]}');
  res.set("Content-Security-Policy", "default-src' 'self'; report-to monitor"); */
}

function sendError(req, res, next, err) {
  const status = err.status || 500;
  if (err.fromGitHubCache) {
    // CacheStatus
    res.status(status);
    res.sendServerTiming();
    if (err.status != 304) {
      res.set('Content-Type', 'text/plain')
      res.send(err.message);
    } else {
      res.end();
    }
    next();
    return;
  }
  res.status(err.status);
  if (err.status === 301 || err.status === 302 || err.status === 307) {
    res.sendServerTiming();
    res.set("Location", err.location);
    res.end();
    monitor.log(`${err.status} ${req.method} ${req.originalUrl}`);
  } else if (err.status === 304) {
    res.sendServerTiming();
    res.end();
    monitor.log(`${err.status} ${req.method} ${req.originalUrl}`);
  } else if (err.status >= 400 && err.status < 500) {
    res.set('Content-Type', 'text/plain');
    res.send(req.message);
    monitor.log(`${err.status} ${req.method} ${req.originalUrl}`);
  } else if (err.status >= 400 && err.status < 500) {
    res.set('Content-Type', 'text/plain')
    res.send(req.message);
    monitor.error(`${err.status} ${req.method} ${req.originalUrl} ${err.message}`);
    if (config.debug) {
      console.log(err);
    }
  }
  next();
}

// filter object properties set the server timing header, send the response
function sendObject(req, res, next, data) {
  let fields = req.query.fields;
  function skim(obj) {
    const newobj = {};
    for (const key in obj) {
      if (fields.includes(key)) {
        newobj[key] = obj[key];
      }
    }
    return newobj;
  }
  let retObj;
  if (!fields) {
    retObj = data;
  } else {
    fields = fields.split(',');
    retObj = (Array.isArray(data)) ? data.map(skim) : skim(data);
  }
  sendSecurityHeaders(req, res);
  res.sendServerTiming();
  if (req.ttl > 1) {
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
  }
  res.json(retObj);
  monitor.log(`200 ${req.method} ${req.originalUrl}`);
  next();
}

module.exports = {decode, sendError, sendObject};
