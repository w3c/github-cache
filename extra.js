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
  req.compounded = true;
  res.compounded = true;
  // do no allow compounded routes to have a ttl lower than 5
  if (req.ttl && req.ttl < 5) {
    req.ttl = 5;
  }
  return next();
});

// indicate that this request and response will trigger a significant amount of cache.get
function setCompounded(req, res) {
}

function transformContent(ghObject, encoding) {
  try {
    if (ghObject) {
      ghObject = ghObject[0];
      if (ghObject) {
        return decode(ghObject.content, ghObject.encoding, encoding);
      }
    }
  } catch (e) {
    //otherwise ignore
  }
  return (encoding == "json") ? {} : "";
}

async function content(req, res, owner, repo, path, encoding) {
  try {
    return transformContent(await cache.get(req, res, `/repos/${owner}/${repo}/contents/${path}`), encoding);
  } catch (e) {
    if (e.status === 304) {
      monitor.error(`compounded requests aren't allowed to return 304 ${req.originalUrl}`);
    }
    //otherwise ignore
  }
  return (encoding == "json") ? {} : "";
}

async function w3cJson(req, res, owner, repo) {
  const w3c = await content(req, res, owner, repo, "w3c.json", "json");
  if (Array.isArray(w3c.group)) {
    w3c.group = w3c.group.map(Number.parseInt);
  } else if (w3c.group !== undefined) {
    w3c.group = [Number.parseInt(w3c.group)];
  }
  const type = w3c["repo-type"];
  if (type && !Array.isArray(type)) {
    w3c["repo-type"] = [type];
  }
  return w3c;
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

router.route('/repos/:owner/:repo/.pr-preview.json')
  .get((req, res, next) => {
    const {repo, owner} = req;
    content(req, res, owner, repo, ".pr-preview.json", "json")
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

async function enhanceRepository(req, res, repo) {
  if (!repo.w3c && req.queryFields.includes("w3c")) {
    repo.w3c = await w3cJson(req, res, repo.owner.login, repo.name);
  }
  if (req.queryFields.includes("prpreview")) {
    try {
      repo.prpreview = await content(req, res, repo.owner.login, repo.name, ".pr-preview.json", "json");
    } catch (err) {
      // ignore
    }
  }
  if (req.queryFields.includes("license")) {
    try {
      repo.license = transformContent(await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/license`));
    } catch (err) {
      // ignore
    }
  }
  for (const prop of ["labels", "teams", "branches", "hooks"]) {
    try {
      if (req.queryFields.includes(prop)) {
        repo[prop] = await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/${prop}`);
      }
    } catch (err) {
      // ignore
    }
  }
  return repo;
}

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const {repo, owner} = req;
    setCompounded(req, res);
    cache.get(req, res, `/repos/${owner}/${repo}`).then(async (repository) => {
      return enhanceRepository(req, res, Object.assign({}, repository[0]));
    }).then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

async function allRepositories(req, res) {
  const paths = config.owners.map(owner => `/orgs/${owner.login}/repos`);
  const results = [];
  for (const path of paths) {
    results.push(await cache.get(req, res, path));
  }
  return results.flat().filter(repo => !repo.archived); // filter out the archived ones
}

router.route('/repos/:id([0-9]{4,6})')
  .get((req, res, next) => {
    const id = req.params.id.match(/[0-9]{4,6}/g);
    setCompounded(req, res);
    allRepositories()
      .then(async (data) => {
        const all = [];
        for (const repo of data) {
          const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
          if (conf.group) {
            if (!id) {
              all.push(await enhanceRepository(req, res, Object.assign({}, repo)));
            } else if (conf.group.find(g => g == id)) {
              const copy = Object.assign({}, repo);
              if (req.queryFields.includes("w3c")) {
                copy.w3c = conf;
              }
              all.push(await enhanceRepository(req, res, copy));
            }
          }
        }
        return all;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos')
  .get((req, res, next) => {
    setCompounded(req, res);
    let types = req.query.type;
    if (!req.queryFields.matches) {
      res.statusCode(406).send("Use the <code>fields</code> parameter");
    }
    if (types) {
      types = types.split(',');
    }
    allRepositories()
      .then(async (data) => {
        const all = [];
        for (const repo of data) {
          const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
          if (!types) {
            all.push(await enhanceRepository(req, res, Object.assign({}, repo)));
          } else if (conf["repo-type"] && conf["repo-type"].find(t => types.includes(t))) {
            const copy = Object.assign({}, repo);
            if (req.queryFields.includes("w3c")) {
              copy.w3c = conf;
            }
            all.push(await enhanceRepository(req, res, copy));
          }
        }
        return all;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

module.exports = router;
