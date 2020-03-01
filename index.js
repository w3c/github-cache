/* eslint-env node */

"use strict";

const t0 = Date.now();

const config = require("./lib/config.js");
const express = require("express");
const compression = require("compression");
const monitor = require('./lib/monitor.js');
const v3 = require("./v3.js");

const app = express();

app.enable('trust proxy');

monitor.setName("GitHub cache", config);
monitor.install(app);

app.use(compression());

app.use("/v3", v3);

app.use("/doc", express.static("docs"));

const port = config.port || 5000;
const server = app.listen(port, () => {
  console.log("Server started in", (Date.now() - t0) + "ms.\n");
  console.log("Using port " + server.address().port);
});
