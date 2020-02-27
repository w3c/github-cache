/* eslint-env node */

"use strict";

const fs = require('fs');

const readFile = function (filename, options) {
  let opts = options;
  if (options === undefined) {
    opts = { encoding: "utf-8" };
  }
  return new Promise(function (resolve, reject) {
    fs.readFile(filename, opts, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const mkdir = (path) => {
  return new Promise((resolve, reject) => {
    fs.mkdir(path, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(path); // ignore errors, so no reject
      }
    });
  });
};

const writeFile = function (filename, data, options) {
  let opts = options;
  let bytes = data;
  if (options === undefined) {
    opts = { encoding: "utf-8" };
  }
  if (typeof data == "object") {
    // Use JSON serializer for objects
    bytes = JSON.stringify(data);
  }
  return new Promise(function (resolve, reject) {
    fs.writeFile(filename, bytes, opts, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

module.exports = {readFile, mkdir, writeFile};
