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
- `/v3/repos/:owner/:repo/contents/pr-preview.json`
- `/v3/repos/:owner/:repo/contents/CODE_OF_CONDUCT.md`
- `/v3/repos/:owner/:repo/branches`
- `/v3/repos/:owner/:repo/commits`
- `/v3/repos/:owner/:repo/issues` (support `state`, `labels`, and `search` parameter)
- `/v3/repos/:owner/:repo/issues/:number`
- `/v3/repos/:owner/:repo/issues/:number/comments`

The server also exposes additional routes:

- `/extra/repos` (support [type](https://w3c.github.io/w3c.json.html#repo-type)). using `fields` is required for this route)
- `/extra/repos/:id` (`id` is a W3C Group number)
- `/extra/issues/:id` (`id` is a W3C Group number. support `state`, `labels`, and `search` parameter)
- `/extra/repos/:owner/:repo`
- `/extra/repos/:owner/:repo/w3c.json`
- `/extra/repos/:owner/:repo/pr-preview.json`
- `/extra/repos/:owner/:repo/code_of_conduct`

For each route, you may use the following optional parameters:

- `ttl` : the maximum number of minutes since the last retrieval from GitHub
- `fields` : a comma-separated list of object property names to include in the returned object

By default, the ttl is 6 hours for all routes.

Additional routes take times to compute so using a ttl below 6 hours may result in long delays for the response (you may get back HTTP 504 the first time you try).

## Starting the server

```js
// install the packages
npm install

// start the server
npm start
```

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

## Monitoring

The service reports its usage metrics at:

    http://localhost:8080/monitor/usage

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

To visualize the metrics, visit

    http://localhost:8080/doc/metrics.html

## Tests

Visit

    http://localhost:8080/doc/tests.html

