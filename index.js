/* eslint-env node */

"use strict";

const t0 = Date.now();

const config = require("./config.json");
const express = require("express");
const compression = require("compression");
const monitor = require('./lib/monitor.js');
const gh = require("./lib/octokit-cache.js");

const app = express();
const router = express.Router();

app.enable('trust proxy');

monitor.setName("GitHub handler", config);
monitor.install(app);

app.use(compression());

function defaultError(req, res, next, err) {
  monitor.error(err);
  res.status(404).send(`Cannot GET ${req.url}`);
  return next()
}

// filter object properties
function resJson(req, res, objs) {
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
    retObj = objs;
  } else {
    fields = fields.split(',');
    retObj = (Array.isArray(objs)) ? objs.map(skim) : skim(objs);
  }
  res.json(retObj);
}

// Our various routes

// filter the req.query to isolate ttl
function params(req) {
  const params = {};
  if (req.query.ttl) {
    const ttl = Number.parseInt(req.query.ttl);
    if (ttl > -2 && ttl < 1440) {
      params.ttl = ttl;
    }
  }
  return params;
}

router.param('repo', (req, res, next, repo) => {
  req.repo = repo;
  next();
});
router.param('owner', (req, res, next, owner) => {
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
  if (!OWNERS.includes(owner.toLowerCase())) {
    monitor.error("Unexpected owner access " + owner);
  }
  req.owner = owner;
  next();
});

// CORS
router.all("/v3/*", (req, res, next) => {
  const ALLOW_ORIGINS = config.allowOrigins || ["http://localhost:8080"];
  let origin = req.headers.origin;
  if (!ALLOW_ORIGINS.includes(origin)) {
    origin = "origin-denied"; // denied, invalid origin
  }
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set('Timing-Allow-Origin', origin);
  return next();
});

router.route('/v3/orgs/:owner/repos')
  .get((req, res, next) => {
    const { owner } = req;
    gh.get(`/orgs/${owner}/repos`, params(req))
      .then(conf => resJson(req, res, conf))
      .catch(err => defaultError(req, res, next, err));
  });

router.route('/v3/repos/:owner/:repo')
  .get((req, res, next) => {
    const { repo, owner } = req;
    gh.get(`/repos/${owner}/${repo}`, params(req))
      .then(conf => resJson(req, res, conf))
      .catch(err => defaultError(req, res, next, err));
  });

async function gh_route(path) {
  router.route(`/v3/repos/:owner/:repo/${path}`)
    .get((req, res, next) => {
      const { repo, owner } = req;
      gh.get(`/repos/${owner}/${repo}/${path}`, params(req))
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

router.route('/v3/repos/:owner/:repo/issues')
  .get((req, res, next) => {
    const { repo, owner } = req;
    let state = req.query.state;
    gh.get(`/repos/${owner}/${repo}/issues?state=all`, params(req))
      .then(issues => issues.sort(compareIssues))
      .then(issues => {
        if (!state) {
          state = "open";
        }
        if (state === "all") {
          return issues;
        } else {
          return issues.filter(i => i.state === state);
        }
      })
      .then(issues => resJson(req, res, issues))
      .catch(err => defaultError(req, res, next, err));
  });


router.route('/v3/repos/:owner/:repo/issues/:number')
  .get((req, res, next) => {
    const { repo, owner } = req;
    const number = req.params.number;
    gh.get(`/repos/${owner}/${repo}/issues?state=all`, params(req))
      .then(issues => issues.filter(issue => issue.number == number)[0])
      .then(issue => {
        if (!issue) {
          monitor.warn(`${owner}/${repo}/issues/${number} doesn't exist`);
          res.status(404).send(`Cannot GET ${req.url}`);
        } else {
          resJson(req, res, issue);
        }
        return next();
      })
      .catch(err => defaultError(req, res, next, err));
  });

router.route('/v3/repos/:owner/:repo/issues/:number/comments')
  .get((req, res, next) => {
    const { repo, owner } = req;
    const number = req.params.number;
    gh.get(`/repos/${owner}/${repo}/issues/${number}/comments`, params(req))
      .then(comments => resJson(req, res, comments))
      .catch(err => defaultError(req, res, next, err));
  });

app.use(router);

const port = config.port || 5000;
const server = app.listen(port, () => {
  console.log("Server started in", (Date.now() - t0) + "ms.\n");
  console.log("Using port " + server.address().port);
});
