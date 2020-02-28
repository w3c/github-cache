# github-cache

A simple cache for GitHub

Use npm start

The server exposes the following routes:

- `/orgs/:owner/repos`
- `/repos/:owner/:repo`
- `/repos/:owner/:repo/labels`
- `/repos/:owner/:repo/teams`
- `/repos/:owner/:repo/hooks`
- `/repos/:owner/:repo/license`
- `/repos/:owner/:repo/contents/w3c.json`
- `/repos/:owner/:repo/branches`
- `/repos/:owner/:repo/commits`
- `/repos/:owner/:repo/issues`
- `/repos/:owner/:repo/issues/:number`
- `/repos/:owner/:repo/issues/:number/comments`

For each route, you may use th following optional parameters:

- `ttl` : a number representing the minutes since the last retrieval from GitHub
- `fields` : a comma-separated list of object property names

By default, the ttl is 6 hours.

For example:

    http://localhost:5000/repos/w3c/hr-time
    http://localhost:5000/repos/w3c/hr-time?ttl=60
    http://localhost:5000/repos/w3c/hr-time/issues?fields=number,created_at,labels

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
