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

The server also exposes additional routes:

- `/extra/ids/:id`
- `/extra/repos/:owner/:repo`
- `/extra/repos/:owner/:repo/w3c.json`

For each route, you may use the following optional parameters:

- `ttl` : a number representing the minutes since the last retrieval from GitHub
- `fields` : a comma-separated list of object property names

By default, the ttl is 6 hours for GitHub routes, and 24 hours for additional routes.

Additional routes take times to compute so using a ttl below 24 hours may result in long delays for the response (you may get back HTTP 504 the first time you try).

## Examples

For example:

    http://localhost:8080/v3/repos/w3c/hr-time
    http://localhost:8080/v3/repos/w3c/hr-time?ttl=60
    http://localhost:8080/v3/repos/w3c/hr-time/issues?fields=number,created_at,labels

Make sure to set up config.json properly, including the CORS allowed origins.

## Sample code

Example of the cache used in code:

```js
const getFromCache = async (query_url, options) => {
  const separator = (url) => url.indexOf("?") !== -1) ? "&" : "?";

  for (const [key, value] of Object.entries(options)) {
    query_url += `${separator(query_url)}${value}=${value}` : "";
  }
  const response = await fetch(CACHE + query_url);
  if (response.ok) {
    return response.json();
  }
  throw new Error(`github-cache complained ${res.status}`);
}
```

## Performance metrics

The service allows for performance reporting, including [server timing](https://w3c.github.io/server-timing/).

```js
// telemetry for performance monitoring
const traceId = (""+Math.random()).substring(2, 18); // for resource correlation
const rtObserver = new PerformanceObserver(list => {
  const resources = list.getEntries().filter(entry => {
    return (entry.name.startsWith(CACHE)
      && !entry.name.startsWith(`${CACHE}/monitor`));
  });
  if (resources.length > 0) {
    navigator.sendBeacon(`${CACHE}/monitor/beacon`, JSON.stringify({ traceId, resources }));
  }
});
rtObserver.observe({entryTypes: ["resource"]});
```
