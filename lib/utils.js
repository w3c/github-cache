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

function sendError(req, res, next, err) {
  let internalError = err.internalError;
  if (!internalError) {
    internalError = err;
  }
  monitor.error(`${Object.getPrototypeOf(err).name} ${req.url} ${err}`);
  if (config.debug) {
    console.log(`error on ${req.url}`);
    console.error(internalError);
  }
  const status = err.status || 404;
  res.status(status);
  if (err.status === 301 || err.status === 302 || err.status === 307) {
    res.set("Location", err.headers.location);
  }
  res.sendServerTiming();
  res.set('Content-Type', 'text/plain')
  res.send(`Cannot GET ${req.url}`);
  return next();
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
  res.sendServerTiming();
  res.json(retObj);
  next();
}

module.exports = {decode, sendError, sendObject};
