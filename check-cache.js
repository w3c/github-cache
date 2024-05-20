/* eslint-env node */

"use strict";

const t0 = Date.now();

const cache = require("./lib/cache.js");
const process = require('node:process');

async function check() {
  await cache.checkEntries();
  // process.exit(0); don't exit abrutly
}

async function status() {
  const data = await cache.getCacheStatus();

  console.log("CACHE STATUS");
  console.log(`   # of entries: ${data.entries}`)
  if (data.entries > 0) {
    console.log('   By status code:');
    for (const [key, entry] of Object.entries(data.entryStatus)) {
      console.log(`     ${key}: ${entry}`);
    }
  }
}

let statusOnly = false;

for (let index = 0; index < process.argv.length; index++) {
  const arg = process.argv[index];
  switch (arg) {
    case "-status":
      statusOnly = true;
      break;
    default:
      // nothing
  }
}

if (!statusOnly) {
  check();
} else {
  status().then(() => process.exit(0));
}
