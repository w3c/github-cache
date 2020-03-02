# github-cache

A simple cache for GitHub

Use npm start

The server exposes the following routes from GitHub:

- `/v3/orgs/:owner/repos`
- `/v3/repos/:owner/:repo`
- `/v3/repos/:owner/:repo/labels`
- `/v3/repos/:owner/:repo/teams`
- `/v3/repos/:owner/:repo/hooks`
- `/v3/repos/:owner/:repo/license`
- `/v3/repos/:owner/:repo/contents/w3c.json`
- `/v3/repos/:owner/:repo/branches`
- `/v3/repos/:owner/:repo/commits`
- `/v3/repos/:owner/:repo/issues`
- `/v3/repos/:owner/:repo/issues/:number`
- `/v3/repos/:owner/:repo/issues/:number/comments`

For each route, you may use th following optional parameters:

- `ttl` : a number representing the minutes since the last retrieval from GitHub
- `fields` : a comma-separated list of object property names

The server also exposes the following "macro" routes:

- `/v3/w3c/:id`

Macro routes take times when a refresh is needed, so you might get a timed out the first time you call it. Try again after 5 minutes. Those routes are only updated once per day...

By default, the ttl is 6 hours.

For example:

    http://localhost:5000/v3/repos/w3c/hr-time
    http://localhost:5000/v3/repos/w3c/hr-time?ttl=60
    http://localhost:5000/v3/repos/w3c/hr-time/issues?fields=number,created_at,labels

Make sure to set up config.json properly, including the CORS allowed origins.

Example of the cache used in code:

```js
get = async function(query_url, options) {
  if (options && options.ttl !== undefined) {
    if (query_url.indexOf("?") !== -1) {
      query_url += "&";
    } else {
      query_url += "?";
    }
    query_url += "ttl=" + ttl;
  }
  if (options && option.fields) {
    if (query_url.indexOf("?") !== -1) {
      query_url += "&";
    } else {
      query_url += "?";
    }
    query_url += "fields=" + fields;
  }

  return fetch(CACHE + query_url).then(res => {
    if (res.ok) return res.json();
    throw new Error("github-cache complained " + res.status);
  });
}
```

The service allows for performance reporting, including [server timing](https://w3c.github.io/server-timing/).

```js
// telemetry for performance monitoring
const traceId = (""+Math.random()).substring(2, 18); // for resource correlation
const rtObserver = new PerformanceObserver(list => {
  const resources = list.getEntries().filter(entry => entry.name.startsWith(CACHE + '/v3/repos'));
  if (resources.length > 0) {
    navigator.sendBeacon(`${CACHE}/monitor/beacon`, JSON.stringify({ traceId, resources }));
  }
});
rtObserver.observe({entryTypes: ["resource"]});
```
