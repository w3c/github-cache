/* eslint-env node */

"use strict";

const t0 = Date.now();

const express = require("express");
const compression = require("compression");
const path = require("path");

const config = require("./lib/config.js");
const monitor = require('./lib/monitor.js');
const {enhanceRequest, sendObject} = require("./lib/utils.js");
const v3 = require("./v3.js");
const extra = require("./extra.js");
const cache = require('./lib/cache.js');

const app = express();

app.set('x-powered-by', false);
app.set('strict routing', true);
app.enable('trust proxy');

monitor.setName("GitHub cache");
monitor.install(app, config);

app.use(compression());

app.use((req, res, next) => {
  enhanceRequest(req);
  next();
});

app.use("/v3", v3);
app.use("/extra", extra);

app.use("/doc", express.static(path.resolve(__dirname, "docs")));

app.post("/cache/fix", (req, res, next) => {
    cache.fixEntries().then(data => {
      sendObject(req, res, next, data);
    });
  }
);

if (!config.debug) {
  process.on('unhandledRejection', error => {
    console.log("-----------------------------");
    console.log('unhandledRejection', error.message);
    console.log(error);
    console.log("-----------------------------");
  });
}

if (!config.checkOptions("host", "port", "env")) {
  console.error("Improper configuration. Not Starting");
  return;
}

app.listen(config.port, () => {
  console.log(`Server started in ${Date.now() - t0}ms at http://${config.host}:${config.port}/`);
  if (!config.debug && config.env != "production") {
    console.warn("WARNING: 'export NODE_ENV=production' is missing");
    console.warn("See http://expressjs.com/en/advanced/best-practice-performance.html#set-node_env-to-production");
  }
});
