/* eslint-env node */

"use strict";

const config = require("./lib/config.js");
const express = require("express");
const monitor = require('./lib/monitor.js');
const gh = require("./lib/octokit-cache.js");
const {sendObject, sendError, decode} = require("./lib/utils.js");

const router = express.Router();

const DEFAULT_TTL = 1440;

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

async function w3cJson(req, res, owner, repo) {
  try {
    const ghObject = (await gh.get(req, res, `/repos/${owner}/${repo}/contents/w3c.json`))[0];
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
    //ignore
  }
  return {};
}

router.route('/repos/:owner/:repo/w3c.json')
  .get((req, res, next) => {
    const {repo, owner} = req;
    if (!req.ttl) {
      req.ttl = DEFAULT_TTL;
    }
    w3cJson(req, res, owner, repo)
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const {repo, owner} = req;
    if (!req.ttl) {
      req.ttl = DEFAULT_TTL;
    }
    gh.get(req, res, `/repos/${owner}/${repo}`).then(async (repository) => {
      // copy to avoid leaving traces in the cache
      const copy = Object.assign({}, repository[0]);
      copy.w3c = await w3cJson(req, res, owner, repo);
      for (const prop of ["labels", "teams", "branches", "hooks", "license"]) {
        try {
          copy[prop] = await gh.get(req, res, `/repos/${owner}/${repo}/${prop}`);
        } catch (err) {
          // ignore
        }
      }
      return copy;
    }).then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

async function allW3CJson(req, res, repositories, id) {
  const all = [];
  for (const repo of repositories) {
    const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
    if (conf.group == id
        || (Array.isArray(conf.group) && conf.group.find(g => g == id))) {
      conf.repository = repo.full_name;
      all.push(conf);
    } else if (!id) {
      all.push(conf);
    }
  }
  return all;
}

router.route('/ids/:id')
  .get((req, res, next) => {
    const id = req.params.id.match(/[0-9]{4,6}/g);
    if (!id) {
      throw new Error("invalid id");
    }
    req.ttl = DEFAULT_TTL; // 24 hours
    const promises = config.owners.map(owner => gh.get(req, res, `/orgs/${owner.login}/repos`));
    Promise.all(promises).then(results => results.flat())
      .then(data => data.filter(repo => !repo.archived)) // filter out the archived ones
      .then(repos => allW3CJson(req, res, repos, id))
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

module.exports = router;
