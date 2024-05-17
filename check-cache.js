/* eslint-env node */

"use strict";

const t0 = Date.now();

const cache = require("./lib/cache.js");
const process = require('node:process');

async function check() {
  await cache.checkEntries();
  process.exit(0);
}

check();
