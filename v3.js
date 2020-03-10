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

async function v3_org(path) {
  const route = `/orgs/:owner${path}`;
  monitor.log(`adding route ${route}`);
  router.route(route)
    .get((req, res, next) => {
      const {owner} = req;
      cache.get(req, res, `/orgs/${owner}${path}`)
        .then(data => sendObject(req, res, next, data))
        .catch(err => sendError(req, res, next, err));
    });
}


async function v3_repo(path) {
  const route = `/repos/:owner/:repo${path}`;
  monitor.log(`adding route ${route}`);
  router.route(route)
    .get((req, res, next) => {
      const {repo, owner} = req;
      cache.get(req, res, `/repos/${owner}/${repo}${path}`)
        .then(data => sendObject(req, res, next, data))
        .catch(err => sendError(req, res, next, err));
    });
}


async function v3_issue(path) {
  const route = `/repos/:owner/:repo/issues/:number${path}`;
  monitor.log(`adding route ${route}`);
  router.route(route)
    .get((req, res, next) => {
      const {repo, owner} = req;
      const number = req.params.number;
      console.log("I'm here");
      cache.get(req, res, `/repos/${owner}/${repo}/issues/${number}${path}`)
        .then(data => sendObject(req, res, next, data))
        .catch(err => sendError(req, res, next, err));
    });
}

const ORGANIZATION_ROUTES = ['/repos'];
const REPOSITORY_ROUTES = ['', '/labels', '/teams', '/hooks', '/license', '/contents/w3c.json', '/branches', '/commits', '/issues?state=all'];
const ISSUE_ROUTES = ['/comments'];

ORGANIZATION_ROUTES.forEach(path => {
  v3_org(path);
});
REPOSITORY_ROUTES.forEach(path => {
  v3_repo(path);
});
ISSUE_ROUTES.forEach(path => {
  v3_issue(path);
});

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

monitor.log(`adding route /repos/:owner/:repo/issues`);
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

monitor.log(`adding route /repos/:owner/:repo/issues/:number`);
router.route('/repos/:owner/:repo/issues/:number')
  .get((req, res, next) => {
    const {repo, owner} = req;
    const number = req.params.number;
    cache.get(req, res, `/repos/${owner}/${repo}/issues?state=all`)
      .then(data => {
        data = data.filter(issue => issue.number == number)[0];
        if (!data) {
          return cache.get(req, res, `/repos/${owner}/${repo}/issues/${number}`);
        }
        return data;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

// those are entries that I'd like to have available with ttl of 24 hours

async function refreshRepository(owner, repo) {
  if (config.debug) {
    monitor.log(`refreshing routes for ${owner}/${repo}`);
  }
  for (const route of REPOSITORY_ROUTES) {
    const request = {ttl: 0};
    await (cache.weak_get(request, undefined, `/repos/${owner}/${repo}${route}`).catch(() => {}));
  }
}

async function refresh() {
  if (config.debug) {
    // abort
    monitor.warn(`refresh cycle not starting (debug mode)`);
    return;
  }
  let current = 0;
  let per_minute;
  let repos;
  async function loop() {
    process.nextTick(async () => {
      try {
        for (let index = current; index < (current + per_minute) && index < repos.length; index++) {
          const repo = repos[index];
          await refreshRepository(repo.owner.login, repo.name);
        }
        current = current + per_minute;
        if (current < repos.length) {
          setTimeout(loop, 1000 * 60);
        } else {
          monitor.log("refresh cycle finished. restarting in a minute");
          // start all over again
          setTimeout(refresh, 1000 * 60);
        }
      } catch (err) {
        monitor.error(`refresh loop crashed`);
        monitor.error(err);
      }
    });
  }
  try {
    const req = {ttl: 0};
    repos = config.owners.map(owner => `/orgs/${owner.login}/repos`);
    for (let index = 0; index < repos.length; index++) {
      const repo = repos[index];
      repos[index] = await (cache.get(req, undefined, repo).catch(() => []));
    }
    repos = repos.flat().filter(repo => !repo.archived);
    if (!repos.length) {
      monitor.error("Can't access repositories");
      return;
    }
    current = 0;
    per_minute = Math.ceil(repos.length / (config.refreshCycle * 60));
    monitor.log(`refreshing ${repos.length} repositories (${per_minute} per minute)`);
    setTimeout(loop, 1000 * 60); // start working after a minute
  } catch (err) {
    monitor.error(`refresh cycle crashed`);
    monitor.error(err);
  }
}

refresh();


module.exports = router;
