/* eslint-env node */

"use strict";

const config = require("../config.json");

config.ghToken = config.ghToken || "missing-GitHub-token";
config.port = config.port || 8080;
config.cache = config.cache || ".cache";
config.debug = config.debug || false;
config.owners = config.owners || [];
config.allowOrigins = config.allowOrigins || [];
config.ttl = config.ttl || 360;
config.refreshCycle = config.refreshCycle || 24;

config.owners.forEach(owner => {
  owner.login = owner.login.toLowerCase();
});

config.allowOrigins = config.allowOrigins.concat(config.owners.map(owner => `https://${owner.login}.github.io`));

if (config.debug) {
  config.allowOrigins.push(`https://localhost:${config.port}`);
}

module.exports = config;
