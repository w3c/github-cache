/* eslint-env node */

"use strict";

const config = require("../config.json");

config.ghToken = config.ghToken || "missing-GitHub-token";
config.port = config.port || 5000;
config.owners = config.owners || [];
config.allowOrigins = config.allowOrigins || [];
config.ttl = config.ttl || 360;

config.allowOrigins = config.allowOrigins.concat(config.owners.map(owner => `https://${owner}.github.io`));

module.exports = config;
