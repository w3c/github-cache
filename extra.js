/* eslint-env node */

"use strict";

const config = require("./lib/config.js");
const express = require("express");
const cache = require("./lib/cache.js");
const monitor = require("./lib/monitor.js");
const {sendObject, sendError, decode, searchTerms, fetchW3C} = require("./lib/utils.js");

const router = express.Router();

if (!config.checkOptions("owners")) {
  console.error("No config.owners configuration");
}

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

function transformContent(ghObject, encoding) {
  try {
    if (ghObject) {
      ghObject = ghObject[0];
      if (!ghObject.transformed) {
        ghObject.transformed = decode(ghObject.content, ghObject.encoding, encoding);
      }
      if (ghObject.transformed) {
        return ghObject.transformed;
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

//
let W3C_GROUPS;

function refreshGroups() {
  fetchW3C("groups").then(res => {
    return res;
  })
    .then(gs => {
      gs.forEach(g => {
        const matches = g._links.self.href.match("api.w3.org/groups/([a-z]+)/(.+)");
        if (matches) {
          g.group = `${matches[1]}/${matches[2]}`;
        } else {
          monitor.error(`Cannot match self link for ${g.id}`);
        }
      })
      monitor.log(`Refreshed W3C groups`);
      W3C_GROUPS = gs;
    }).catch(err => {
      monitor.error(`Cannot refresh list of W3C groups ${err}`);
    }).then(() => setTimeout(refreshGroups, 21600000)); // every 6 hours;
}

refreshGroups();

function getGroup(identifier) {
  for (let index = 0; index < W3C_GROUPS.length; index++) {
    const g = W3C_GROUPS[index];
    if (identifier === g.group || identifier === g.id) {
      return g;
    }
  }
  return undefined;
}

async function w3cJson(req, res, owner, repo) {
  if (repo.w3c) {
    return repo.w3c;
  }
  const w3c = await content(req, res, owner, repo, "w3c.json", "json");
  let groups;
  if (Array.isArray(w3c.group)) {
    groups = w3c.group.map(getGroup);
  } else if (w3c.group !== undefined) {
    groups = [getGroup(w3c.group)];
  }
  if (groups) {
    w3c.group = [];
    w3c.group_description = [];
    groups.forEach(g => {
      if (g) {
        w3c.group.push(g.id);
        w3c.group_description.push({id: g.id, shortname: g.group,
          name: g.name, is_closed: g.is_closed});
      } // else eliminate from the list
    })
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

router.route('/repos/:owner/:repo/code_of_conduct')
  .get((req, res, next) => {
    const {repo, owner} = req;
    cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/contents/CODE_OF_CONDUCT.md`)
      .then(data => transformContent(data))
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

async function enhanceRepository(req, res, repo) {
  if (!repo.w3c && req.queryFields.includes("w3c")) {
    repo.w3c = await w3cJson(req, res, repo.owner.login, repo.name);
  }
  if (!repo.prpreview && req.queryFields.includes("prpreview")) {
    try {
      repo.prpreview = await content(req, res, repo.owner.login, repo.name, ".pr-preview.json", "json");
    } catch (err) {
      // ignore
    }
  }
  if (!repo.license && req.queryFields.includes("license")) {
    try {
      repo.license = transformContent(await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/license`));
    } catch (err) {
      // ignore
    }
  }
  if (!repo.codeOfConduct && req.queryFields.includes("codeOfConduct")) {
    try {
      repo.codeOfConduct = transformContent(await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/contents/CODE_OF_CONDUCT.md`));
    } catch (err) {
      try {
        repo.codeOfConduct = transformContent(await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/contents/.github/CODE_OF_CONDUCT.md`));
      } catch (err) {
        console.log(err);
        // ignore
      }
    }
  }
  if (!repo.autoPublish && req.queryFields.includes("autopublish")) {
    try {
      repo.autoPublish = transformContent(await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/contents/.github/workflows/auto-publish.yml`));
    } catch (err) {
      // ignore
    }
  }
  if (!repo.defaultBranchProtectionRules && req.queryFields.includes("defaultBranchProtectionRules")) {
    try {
      repo.defaultBranchProtectionRules = await cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/branches/${repo.default_branch}/protection`);
    } catch (err) {
      // ignore
    }
  }
  for (const prop of ["labels", "teams", "branches", "hooks"]) {
    try {
      if (!repo[prop] && req.queryFields.includes(prop)) {
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

function getRepositories(req, res, next, identifier, enhanced) {
  return allRepositories()
    .then(async (data) => {
      const all = [];
      for (const repo of data) {
        const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
        if (conf.group_description && conf.group_description.find(g =>
          (g.id === identifier || g.shortname === identifier))) {
          if (enhanced) {
            all.push(await enhanceRepository(req, res, repo));
          } else {
            all.push(repo);
          }
        }
      }
      return all;
    })
    .then(data => sendObject(req, res, next, data))
    .catch(err => sendError(req, res, next, err));
}

// deprecated
router.route('/repos/:id([0-9]{4,6})')
  .get((req, res, next) => getRepositories(req, res, next,
    Number.parseInt(req.params.id), true));

router.route('/repositories/:id([0-9]{4,6})')
  .get((req, res, next) => getRepositories(req, res, next,
    Number.parseInt(req.params.id), false));

router.route('/repositories/:type/:shortname')
  .get((req, res, next) => getRepositories(req, res, next,
    `${req.params.type}/${req.params.shortname}`, false));

router.route('/repositories/enhanced/:id([0-9]{4,6})')
  .get((req, res, next) => getRepositories(req, res, next,
    Number.parseInt(req.params.id), true));
router.route('/repositories/enhanced/:type/:shortname')
  .get((req, res, next) => getRepositories(req, res, next,
    `${req.params.type}/${req.params.shortname}`, true));

async function filterIssues(req, res, repo) {
  let state = req.query.state;
  let labels = req.query.labels;
  let search = req.query.search;
  return cache.get(req, res, `/repos/${repo.owner.login}/${repo.name}/issues?state=all`)
    .then(data => {
      if (!state) {
        state = "open";
      }
      if (state !== "all") {
        data = data.filter(i => i.state === state);
      }
      return data;
    })
    .then(data => {
      if (!labels) {
        return data;
      }
      labels = labels.split(',').map(s => s.toLowerCase());
      return data.filter(i => i.labels.find(l => labels.includes(l.name.toLowerCase())));
    })
    .then(data => {
      if (!search) {
        return data;
      }
      search = search.split(',').map(s => s.toLowerCase());
      return data.filter(i => {
        return searchTerms(i.labels.map(l => l.name), search)
          || i.milestone && searchTerms([i.milestone.title], search)
          || i.title && searchTerms([i.title], search)
          || i.assignees && searchTerms(i.assignees.map(l => l.login), search);
      });
    })
}

router.route('/issues/:id([0-9]{4,6})')
  .get((req, res, next) => {
    const id = req.params.id;
    allRepositories()
      .then(async (data) => {
        const all = [];
        const savedTtl = req.ttl;
        req.ttl = undefined;
        for (const repo of data) {
          const conf = (await w3cJson(req, res, repo.owner.login, repo.name));
          if (conf.group && conf.group.find(g => g == id)) {
            all.push(repo);
          }
        }
        req.ttl = savedTtl;
        return all;
      })
      .then(async (repos) => {
        const all = [];
        for (const repo of repos) {
          const issues = await filterIssues(req, res, repo)
          if (issues.length > 0) {
            issues.forEach(i => {
              if (!i.repository) {
                i.repository = {
                  full_name: repo.full_name,
                  name: repo.name,
                  owner: {login: repo.owner.login},
                }
              }
            })
            all.push(issues);
          }
        }
        return all.flat();
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

router.route('/repos')
  .get((req, res, next) => {
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
            if (req.queryFields.includes("w3c")) {
              repo.w3c = conf;
            }
            all.push(await enhanceRepository(req, res, repo));
          }
        }
        return all;
      })
      .then(data => sendObject(req, res, next, data))
      .catch(err => sendError(req, res, next, err));
  });

module.exports = router;
