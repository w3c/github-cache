/* eslint-env node */

"use strict";

const config = require("./lib/config.js");
const express = require("express");
const cache = require("./lib/cache.js");
const monitor = require("./lib/monitor.js");
const {sendObject, sendError, decode} = require("./lib/utils.js");

const router = express.Router();

// Our various routes

router.param('repo', (req, res, next, repo) => {
  // do we need more input checks here?
  req.repo = repo.substring(0, 100);
  next();
});
router.param('owner', (req, res, next, owner) => {
  req.owner = owner.substring(0, 100);
  next();
});

// TTL
router.all("/*", (req, res, next) => {
  res.set('X-GitHub-Media-Type', 'github.v3; format=json');

  if (req.query.ttl) {
    const ttl = Number.parseInt(req.query.ttl.substring(0, 4));
    if (ttl > -2 && ttl < 1440) {
      req.ttl = ttl;
    }
  }
  return next();
});

function setCompounded(req, res) {
  req.compounded = true;
  res.compounded = true;
}

async function w3cJson(req, res, owner, repo) {
  try {
    const ghObject = (await cache.get(req, res, `/repos/${owner}/${repo}/contents/w3c.json`))[0];
    if (ghObject) {
      const w3c = decode(ghObject.content, ghObject.encoding, "json");
      if (Array.isArray(w3c.group)) {
        w3c.group = w3c.group.map(Number.parseInt);
      } else if (config.group) {
        w3c.group = Number.parseInt(w3c.group);
      }
      return w3c;
    }
  } catch (e) {
    if (e.status === 304) {
      monitor.error(`compounded requests aren't allowed to return 304 ${req.originalUrl}`);
    }
    //otherwise ignore
  }
  return {};
}

router.route('/repos/:owner/:repo/w3c.json')
  .get((req, res, next) => {
    const {repo, owner} = req;
    w3cJson(req, res, owner, repo)
      .then(data => {
        return data;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const {repo, owner} = req;
    let fields = req.query.fields;
    if (fields) {
      fields = fields.split(',');
    } else {
      fields = [];
    }
    setCompounded(req, res);
    cache.get(req, res, `/repos/${owner}/${repo}`).then(async (repository) => {
      // copy to avoid leaving traces in the cache
      const copy = Object.assign({}, repository[0]);
      if (fields.length === 0 || fields.includes("w3c")) {
        copy.w3c = await w3cJson(req, res, owner, repo);
      }
      for (const prop of ["labels", "teams", "branches", "hooks", "license"]) {
        try {
          if (fields.length === 0 || fields.includes(prop)) {
            copy[prop] = await cache.get(req, res, `/repos/${owner}/${repo}/${prop}`);
          }
        } catch (err) {
          // ignore
        }
      }
      return copy;
    }).then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos/:id?')
  .get((req, res, next) => {
    const id = req.params.id.match(/[0-9]{4,6}/g);
    if (!id) {
      sendError(req, res, next, {status: 404, message: "id must match [0-9]{4,6}"});
      return;
    }
    setCompounded(req, res);
    const promises = config.owners.map(owner => cache.get(req, res, `/orgs/${owner.login}/repos`));
    Promise.all(promises).then(results => results.flat())
      .then(data => data.filter(repo => !repo.archived)) // filter out the archived ones
      .then(async (data) => {
        const all = [];
        for (const repo of data) {
          const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
          if (conf.group == id || (Array.isArray(conf.group) && conf.group.find(g => g == id))) {
            const copy = Object.assign({}, repo);
            copy.w3c = conf;
            all.push(copy);
          } else if (!id) {
            all.push(repo);
          }
        }
        return all;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

module.exports = router;
