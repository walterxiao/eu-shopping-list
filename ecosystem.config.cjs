/**
 * pm2 process definition for the eu-shopping-list app on EC2.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs       # initial bring-up
 *   pm2 reload ecosystem.config.cjs      # zero-downtime restart on deploy
 *   pm2 save                             # persist process list across reboots
 *
 * The script expects `npm run build` to have been run first — pm2
 * itself just exec's `npm run start` (which is `next start -p 8642`).
 *
 * Why a CommonJS file: pm2 always loads ecosystem files via Node's
 * legacy `require`, even when the surrounding project is ESM. Naming
 * the file `.cjs` makes that work regardless of the project's
 * `"type": "module"` setting (we don't use one today, but better safe
 * than sorry — Next.js can flip the default).
 */
module.exports = {
  apps: [
    {
      name: "eu-shopping-list",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      // Bind to all interfaces; the EC2 security group is the firewall.
      // Without HOSTNAME=0.0.0.0 next.js binds to 127.0.0.1 only and
      // the box rejects external connections with ECONNREFUSED.
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: "8642",
        NEXT_TELEMETRY_DISABLED: "1",
        // Persist tracked items + FX cache to ./data/app.sqlite
        // (relative to cwd, which is the project root).
        CACHE_DB_PATH: "data/app.sqlite",
      },
      // Restart at most 5 times in 60s to avoid crash loops eating
      // the whole box. After that pm2 marks the process "errored"
      // and stops retrying — `pm2 logs` shows the cause.
      max_restarts: 5,
      min_uptime: "10s",
      // Keep the last 10MB of stdout/stderr per file in pm2's log dir.
      max_memory_restart: "512M",
      // Don't watch source files in production — `pm2 reload` is the
      // explicit deploy signal.
      watch: false,
    },
  ],
};
