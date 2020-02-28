/* eslint-env node */

"use strict";

const t0 = Date.now();

const config = require("./config.json");
const express = require("express");
const monitor = require('./lib/monitor.js');
const gh = require("./lib/octokit-cache.js");

const app = express();
const router = express.Router();

app.enable('trust proxy');

monitor.setName("GitHub handler");
monitor.install(app);

// filter the req.query to isolate ttl
function params(req) {
  let params = {};
  if (req.query.ttl) {
    let ttl = Number.parseInt(req.query.ttl);
    if (ttl > -2 && ttl < 1440) {
      params.ttl = ttl;
    }
  }
  return params;
}

// should we only authorize some owners?
function full_name(req) {
  const OWNERS = [
    "w3c",
    "w3ctag",
    "webassembly",
    "immersive-web",
    "wicg",
    "whatwg",
    "webaudio",
    "web-platform-tests",
    "w3cping"
  ];
  if (!OWNERS.includes(req.params.owner.toLowerCase())) {
    monitor.error("Unexpected owner access " + req.params.owner);
  }
  return { owner: req.params.owner, repo: req.params.repo };
}

// CORS
const ALLOW_ORIGINS = config.allowOrigin || ["http://localhost:8080"];
function security(req, res) {
  let origin = req.headers.origin;
  if (!ALLOW_ORIGINS.includes(origin)) {
    origin = "http://localhost:8000/"; // denied, invalid origin
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set(`Access-Control-Allow-Credentials`, "true");
}
app.options('*', (req, res, next) => {
  security(req, res);
  return next();
});

router.route('/orgs/:owner/repos')
  .get((req, res, next) => {
    const { owner } = full_name(req);
    security(req, res);
    gh.get(`/orgs/${owner}/repos`, params(req))
      .then(conf => res.json(conf))
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

router.route('/repos/:owner/:repo')
  .get((req, res, next) => {
    const { repo, owner } = full_name(req);
    security(req, res);
    gh.get(`/repos/${owner}/${repo}`, params(req))
      .then(conf => res.json(conf))
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

async function gh_route(path) {
  router.route(`/repos/:owner/:repo/${path}`)
    .options((req, res, next) => {
      security(req, res);
      return next();
    })
    .get((req, res, next) => {
      const { repo, owner } = full_name(req);
      security(req, res);
      gh.get(`/repos/${owner}/${repo}/${path}`, params(req))
        .then(data => res.json(data))
        .catch(err => {
          monitor.error(err);
          res.status(404).send(`Cannot GET ${req.url}`);
          return next()
        });
    });
}

gh_route('teams');
gh_route('hooks');
gh_route('license');
gh_route('contents/w3c.json');
gh_route('branches');
gh_route('commits');
// gh_route('community/code_of_conduct');
// gh_route('projects');

router.route('/repos/:owner/:repo/issues')
  .options((req, res, next) => {
    security(req, res);
    return next();
  })
  .get((req, res, next) => {
    const { repo, owner } = full_name(req);
    const state = req.query.state;
    security(req, res);
    gh.get(`/repos/${owner}/${repo}/issues?state=all`, params(req))
      .then(issues => {
        if (state === "all" || !state) {
          return issues;
        } else {
          return issues.filter(i => i.state === state);
        }
      })
      .then(issues => res.json(issues))
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

router.route('/repos/:owner/:repo/issues/:number')
  .get((req, res, next) => {
    const { repo, owner } = full_name(req);
    const number = req.params.number;
    security(req, res);
    gh.get(`/repos/${owner}/${repo}/issues?state=all`, params(req))
      .then(issues => issues.filter(issue => issue.number == number)[0])
      .then(issue => {
        if (!issue) {
          monitor.warn(`${owner}/${repo}/issues/${number} doesn't exist`);
          res.status(404).send(`Cannot GET ${req.url}`);
        } else {
          res.json(issue);
        }
        return next();
      })
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

router.route('/repos/:owner/:repo/issues/:number/comments')
  .get((req, res, next) => {
    const { repo, owner } = full_name(req);
    const number = req.params.number;
    security(req, res);
    gh.get(`/repos/${owner}/${repo}/issues/${number}/comments`, params(req))
      .then(comments => res.json(comments))
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

router.route('/repos/:owner/:repo/labels')
  .get((req, res, next) => {
    const { repo, owner } = full_name(req);
    security(req, res);
    gh.get(`/repos/${owner}/${repo}/labels`, params(req))
      .then(labels => res.json(labels))
      .catch(err => {
        monitor.error(err);
        res.status(404).send(`Cannot GET ${req.url}`);
        return next()
      });
  });

app.use(router);

const port = config.port || 5000;
const server = app.listen(port, function () {
  console.log("Server started in", (Date.now() - t0) + "ms.\n");
  console.log("Using port " + server.address().port);
});
