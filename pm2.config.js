module.exports = {
  /**
   * Application configuration section
   * http://pm2.keymetrics.io/docs/usage/application-declaration/
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
      "node_args": "--max_old_space_size=4000"
    }
  ]
};
