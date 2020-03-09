/* eslint-env node */

"use strict";

const t0 = Date.now();

const config = require("./lib/config.js");
const express = require("express");
const compression = require("compression");
const monitor = require('./lib/monitor.js');
const v3 = require("./v3.js");
const extra = require("./extra.js");

const app = express();

app.set('x-powered-by', false);
app.set('strict routing', true);
app.enable('trust proxy');

monitor.setName("GitHub cache", config);
monitor.install(app);

app.use(compression());

app.use("/v3", v3);
app.use("/extra", extra);

app.use("/doc", express.static("docs"));

if (!config.debug) {
  process.on('unhandledRejection', error => {
    console.log("-----------------------------");
    console.log('unhandledRejection', error.message);
    console.log(error);
    console.log("-----------------------------");
  });
}

const port = config.port || 5000;

app.listen(port, () => {
  console.log(`Server started in ${Date.now() - t0}ms at http://localhost:${port}/`);
  if (!config.debug && process.env["NODE_ENV"] != "production") {
    console.warn("WARNING: 'export NODE_ENV=production' is missing");
    console.warn("See http://expressjs.com/en/advanced/best-practice-performance.html#set-node_env-to-production");
  }
});
