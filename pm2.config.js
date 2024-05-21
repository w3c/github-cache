module.exports = {
  /**
   * Application configuration section
   * http://pm2.keymetrics.io/docs/usage/application-declaration/
   *
   * --max-old-space-size=SIZE (in megabytes)
   *    As memory consumption approaches the limit, V8 will
   *    spend more time on garbage collection in an effort
   *    to free unused memory.
   * https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes
   */
  apps: [
    {
      name: 'github-cache',
      script: 'index.js',
      env: {
        NODE_ENV: 'production',
        PORT: '8050'
      },
      error_file: "/var/log/nodejs/github-cache.err",
      out_file: "/var/log/nodejs/github-cache.log",
      "node_args": "--max_old_space_size=2000"
    }
  ]
};
