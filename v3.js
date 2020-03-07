/* eslint-env node */

"use strict";

const config = require("./lib/config.js");
const express = require("express");
const monitor = require('./lib/monitor.js');
const cache = require("./lib/cache.js");
const {sendObject, sendError} = require("./lib/utils.js");

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

router.route('/orgs/:owner/repos')
  .get((req, res, next) => {
    const {owner} = req;
    cache.get(req, res, `/orgs/${owner}/repos`)
       .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const {repo, owner} = req;
    cache.get(req, res, `/repos/${owner}/${repo}`)
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

async function v3_route(path) {
  router.route(`/repos/:owner/:repo/${path}`)
    .get((req, res, next) => {
      const {repo, owner} = req;
      cache.get(req, res, `/repos/${owner}/${repo}/${path}`)
        .then(data => sendObject(req, res, next, data))
        .catch(err => sendError(req, res, next, err));
    });
}

v3_route('labels');
v3_route('teams');
v3_route('hooks');
v3_route('license');
v3_route('contents/w3c.json');
v3_route('branches');
v3_route('commits');
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
    const {repo, owner} = req;
    let state = req.query.state;
    cache.get(req, res, `/repos/${owner}/${repo}/issues?state=all`)
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
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });


router.route('/repos/:owner/:repo/issues/:number')
  .get((req, res, next) => {
    const {repo, owner} = req;
    const number = req.params.number;
    cache.get(req, res, `/repos/${owner}/${repo}/issues?state=all`)
      .then(data => {
        data = data.filter(issue => issue.number == number)[0];
        if (!data) {
          monitor.warn(`${owner}/${repo}/issues/${number} doesn't exist`);
          res.status(404).send(`Cannot GET ${req.url}`);
        } else {
          sendObject(req, res, next, data);
        }
        return next();
      })
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos/:owner/:repo/issues/:number/comments')
  .get((req, res, next) => {
    const {repo, owner} = req;
    const number = req.params.number;
    cache.get(req, res, `/repos/${owner}/${repo}/issues/${number}/comments`)
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

// those are entries that I'd like to have available with ttl of 24 hours

async function refreshRepository(owner, repo) {
  const routes = [
    ``,
    `/contents/w3c.json`,
    `/labels`,
    `/teams`,
    `/hooks`,
    `/license`,
    `/branches`,
  ];
  const req = {ttl: 0};
  if (config.debug) {
    monitor.log(`refreshing routes for ${owner}/${repo}`);
  }
  for (const route of routes) {
    await (cache.get(req, undefined, `/repos/${owner}/${repo}${route}`).catch(() => {}));
  }
}

async function refresh() {
  if (config.debug) {
    // abort
    return;
  }
  const req = {ttl: 0};
  let repos = config.owners.map(owner => `/orgs/${owner.login}/repos`);
  for (let index = 0; index < repos.length; index++) {
    const repo = repos[index];
    repos[index] = await (cache.get(req, undefined, repo).catch(() => []));
  }
  repos = repos.flat().filter(repo => !repo.archived);
  if (!repos.length) {
    monitor.error("Can't access repositories");
    return;
  }
  let current = 0;
  const per_minute = Math.ceil(repos.length / (24 * 60));
  async function loop() {
    process.nextTick(async () => {
      for (let index = current; index < (current + per_minute); index++) {
        const repo = repos[index];
        await refreshRepository(repo.owner.login, repo.name);
      }
      current = current + per_minute;
      if (current < repos.length) {
        setTimeout(loop, 1000 * 60);
      } else {
        // start all over again
        setTimeout(refresh, 1000 * 60);
      }
    });
  }
  monitor.log(`refreshing ${repos.length} repositories (${per_minute} per minute)`);
  setTimeout(loop, 1000 * 60); // start working after a minute
}

refresh();


module.exports = router;
