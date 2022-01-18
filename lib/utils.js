/* eslint-env node */

"use strict";

const config = require("./config.js"),
  fetch = require("node-fetch"),
  monitor = require('./monitor.js');

// encoding is https://nodejs.org/dist/latest/docs/api/buffer.html#buffer_buffers_and_character_encodings
// decoder is "json" or "text"
function decode(content, encoding, decoder = "text") {
  if (encoding) {
    content = Buffer.from(content, encoding).toString();
  }
  switch (decoder) {
  case "json":
    try {
      return JSON.parse(content);
    } catch (e) {
      return undefined;
    }
  default:
    return content;
  }
}

// assumes arrayOfTerms is already in lower case
function searchTerms(arrayOfStrings, arrayOfTerms) {
  return arrayOfStrings.map(str => str.toLowerCase())
    .reduce((a, v) => arrayOfTerms.find(term => v.includes(term) || a), false);
}

function sendSecurityHeaders(req, res) {
  let origin = req.headers.origin;
  if (!config.allowOrigins.includes(origin)) {
    origin = (config.debug) ? "*" : "origin-denied";
  }
  res.set("Access-Control-Allow-Origin", "*"); // @@TODO use origin but allow proxying :(
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

  res.status(status);

  if (status === 301 || status === 302 || status === 307) {
    res.sendServerTiming();
    res.set("Location", err.location);
    sendSecurityHeaders(req, res);
    res.end();
    monitor.log(`${status} ${req.method} ${req.originalUrl}`);
  } else if (status === 304) {
    res.sendServerTiming();
    sendSecurityHeaders(req, res);
    res.end();
    monitor.log(`${status} ${req.method} ${req.originalUrl}`);
  } else if (status >= 400 && status < 500) {
    res.set('Content-Type', 'text/plain');
    sendSecurityHeaders(req, res);
    res.send(req.message);
    monitor.log(`${status} ${req.method} ${req.originalUrl}`);
  } else if (status >= 500) {
    res.set('Content-Type', 'text/plain')
    sendSecurityHeaders(req, res);
    res.send(err.message);
    monitor.error(`${status} ${req.method} ${req.originalUrl} ${err.message}`);
    console.error(err);
  }
  next();
}

class Fields {
  constructor(str) {
    if (str) {
      this.matches = str.split(',');
    }
  }
  includes(field) {
    if (!this.matches) {
      return true;
    }
    return this.matches.includes(field);
  }
}

function enhanceRequest(request) {
  request.queryFields = new Fields(request.query.fields);
  if (request.query.ttl) {
    const ttl = Number.parseInt(request.query.ttl.substring(0, 4));
    if (ttl > -2 && ttl < 1440) {
      request.ttl = ttl;
    }
  }
}

// filter object properties set the server timing header, send the response
function sendObject(req, res, next, data) {
  function skim(obj) {
    const copy = {};
    for (const key in obj) {
      if (req.queryFields.includes(key)) {
        copy[key] = obj[key];
      }
    }
    return copy;
  }
  if (req.queryFields && req.queryFields.matches) {
    data = (Array.isArray(data)) ? data.map(skim) : skim(data);
  }
  sendSecurityHeaders(req, res);
  res.sendServerTiming();
  if (req.ttl > 1) {
    res.set("Cache-Control", "public, max-age=60, s-maxage=60");
  }
  res.json(data);
  monitor.log(`200 ${req.method} ${req.originalUrl}`);
  next();
}

const W3C_APIURL = "https://api.w3.org/";

// to get information out of the W3C API
function fetchW3C(queryPath) {
  if (!config.w3capikey) throw new ReferenceError("Missing W3C key")
  const apiURL = new URL(queryPath, W3C_APIURL);
  apiURL.searchParams.set("apikey", config.w3capikey);
  apiURL.searchParams.set("embed", "1"); // grab everything
  return fetch(apiURL).then(r => r.json()).then(data => {
    if (data.error) throw new Error(data.error);
    if (data.message) throw new Error(data.message);
    if (data.pages && data.pages > 1 && data.page < data.pages) {
      return fetchW3C(data._links.next.href).then(nextData => {
        const key = Object.keys(data._embedded)[0];
        const value = data._embedded[key];
        return value.concat(nextData);
      });
    }
    let value;
    if (data._embedded) {
      let key = Object.keys(data._embedded)[0];
      value = data._embedded[key];
    } else {
      value = data;
    }
    return value;
  });
}

module.exports = {decode, sendError, sendObject, enhanceRequest, searchTerms, fetchW3C};
