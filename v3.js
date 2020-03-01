/* eslint-env node */

"use strict";

const config = require("./lib/config.js");
const express = require("express");
const monitor = require('./lib/monitor.js');
const gh = require("./lib/octokit-cache.js");

const router = express.Router();

function defaultError(req, res, next, err) {
  monitor.error(err);
  res.sendServerTiming();
  res.status(404).send(`Cannot GET ${req.url}`);
  return next()
}

// filter object properties
function resJson(req, res, data) {
  let fields = req.query.fields;
  function skim(obj) {
    const newobj = {};
    for (const key in obj) {
      if (fields.includes(key)) {
        newobj[key] = obj[key];
      }
    }
    return newobj;
  }
  let retObj;
  if (!fields) {
    retObj = data;
  } else {
    fields = fields.split(',');
    retObj = (Array.isArray(data)) ? data.map(skim) : skim(data);
  }
  res.sendServerTiming();
  res.json(retObj);
}

// Our various routes

router.param('repo', (req, res, next, repo) => {
  // do we need more input checks here?
  req.repo = repo;
  next();
});
router.param('owner', (req, res, next, owner) => {
  // do we need more input checks here?
  if (!config.owners.includes(owner.toLowerCase())) {
    monitor.error("Unexpected owner access " + owner);
  }
  req.owner = owner;
  next();
});

// CORS
router.all("/*", (req, res, next) => {
  req.startTime = Date.now();
  let origin = req.headers.origin;
  if (!config.allowOrigins.includes(origin)) {
    origin = "origin-denied"; // denied, invalid origin
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set('Access-Control-Request-Headers', 'Server-Timing');
  res.set('Timing-Allow-Origin', origin);

  if (req.query.ttl) {
    const ttl = Number.parseInt(req.query.ttl);
    if (ttl > -2 && ttl < 1440) {
      req.ttl = ttl;
    }
  }
  return next();
});

router.route('/orgs/:owner/repos')
  .get((req, res, next) => {
    const { owner } = req;
    gh.get(req, res, `/orgs/${owner}/repos`)
      .then(data => resJson(req, res, data))
      .catch(err => defaultError(req, res, next, err));
  });

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const { repo, owner } = req;
    gh.get(req, res, `/orgs/${owner}/repos`)
      .then(data => {
        data = data.filter(r => r.name === repo)[0];
        if (!data) throw new Error(`repository not found ${owner}/${repo}`);
        return data;
      })
      .then(data => resJson(req, res, data))
      .catch(err => defaultError(req, res, next, err));
  });

async function gh_route(path) {
  router.route(`/repos/:owner/:repo/${path}`)
    .get((req, res, next) => {
      const { repo, owner } = req;
      gh.get(req, res, `/repos/${owner}/${repo}/${path}`)
        .then(data => resJson(req, res, data))
        .catch(err => defaultError(req, res, next, err));
    });
}

gh_route('labels');
gh_route('teams');
gh_route('hooks');
gh_route('license');
gh_route('contents/w3c.json');
gh_route('branches');
gh_route('commits');
// gh_route('community/code_of_conduct');
// gh_route('projects');

function compareIssues(a, b) {
  if (a.number > b.number) {
    return -1;
  }
  if (a.number < b.number) {
    return 1;
  }
  // a must be equal to b
  return 0;
}

router.route('/repos/:owner/:repo/issues')
  .get((req, res, next) => {
    const { repo, owner } = req;
    let state = req.query.state;
    gh.get(req, res, `/repos/${owner}/${repo}/issues?state=all`)
      .then(data => {
        data = data.sort(compareIssues)
        if (!state) {
          state = "open";
        }
        if (state !== "all") {
          data = data.filter(i => i.state === state);
        }
        return data;
      })
      .then(data => resJson(req, res, data))
      .catch(err => defaultError(req, res, next, err));
  });


router.route('/repos/:owner/:repo/issues/:number')
  .get((req, res, next) => {
    const { repo, owner } = req;
    const number = req.params.number;
    gh.get(req, res, `/repos/${owner}/${repo}/issues?state=all`)
      .then(data => {
        data = data.filter(issue => issue.number == number)[0];
        if (!data) {
          monitor.warn(`${owner}/${repo}/issues/${number} doesn't exist`);
          res.status(404).send(`Cannot GET ${req.url}`);
        } else {
          resJson(req, res, data);
        }
        return next();
      })
      .catch(err => defaultError(req, res, next, err));
  });

router.route('/repos/:owner/:repo/issues/:number/comments')
  .get((req, res, next) => {
    const { repo, owner } = req;
    const number = req.params.number;
    gh.get(req, res, `/repos/${owner}/${repo}/issues/${number}/comments`)
      .then(data => resJson(req, res, data))
      .catch(err => defaultError(req, res, next, err));
  });

module.exports = router;