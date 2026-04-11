#!/usr/bin/env bash
#
# scripts/deploy-on-ec2.sh
#
# Runs ON THE EC2 BOX (not on the GitHub runner). Invoked by the
# .github/workflows/deploy.yml workflow over SSH after the workflow
# has already done a `git fetch origin && git reset --hard
# origin/main` in the project directory — so this script can assume
# the working tree is at the commit we want to deploy.
#
# What it does:
#   1. npm ci      — clean install matching package-lock.json
#   2. npm run build — produce the .next/ standalone build
#   3. pm2 reload ecosystem.config.cjs — zero-downtime restart
#      (or `pm2 start` on the very first run)
#   4. pm2 save    — persist the process list across reboots
#   5. Healthcheck — curl http://localhost:9753/api/items and bail
#      with non-zero exit if it doesn't return 200 in 30s.
#
# Exit codes:
#   0 — deploy succeeded and healthcheck passed
#   1 — install/build/pm2 step failed
#   2 — healthcheck timed out (the app started but isn't responding)
#
# This script can also be run manually for debugging:
#   ssh ec2-user@your-box
#   cd ~/eu-shopping-list
#   bash scripts/deploy-on-ec2.sh

set -euo pipefail

PORT="${PORT:-9753}"
PM2_NAME="${PM2_NAME:-eu-shopping-list}"
HEALTHCHECK_URL="http://localhost:${PORT}/api/items"
HEALTHCHECK_TIMEOUT_S=30

echo "==> deploy-on-ec2.sh starting"
echo "    cwd:        $(pwd)"
echo "    branch:     $(git rev-parse --abbrev-ref HEAD)"
echo "    commit:     $(git rev-parse --short HEAD)"
echo "    pm2 name:   ${PM2_NAME}"
echo "    port:       ${PORT}"

# ------------------------------------------------------------------
# 1) Install dependencies
# ------------------------------------------------------------------
# `npm ci` is faster and more reproducible than `npm install` because
# it deletes node_modules and reinstalls strictly from package-lock.
# It also fails loudly if package-lock and package.json are out of
# sync, which is exactly what we want on a deploy box.
echo "==> npm ci"
npm ci

# ------------------------------------------------------------------
# 2) Build the Next.js app
# ------------------------------------------------------------------
echo "==> npm run build"
npm run build

# ------------------------------------------------------------------
# 3) (Re)start under pm2
# ------------------------------------------------------------------
# `pm2 reload` is graceful — it spins up the new process, waits for
# it to be ready, then kills the old one. Falls through to a fresh
# `pm2 start` if the named process doesn't exist yet (first deploy).
echo "==> pm2 reload (or start) ${PM2_NAME}"
if pm2 describe "${PM2_NAME}" > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs
fi

# ------------------------------------------------------------------
# 4) Persist the process list so pm2 resurrects it on reboot.
# ------------------------------------------------------------------
echo "==> pm2 save"
pm2 save

# ------------------------------------------------------------------
# 5) Healthcheck
# ------------------------------------------------------------------
# Poll the items endpoint until it returns 200 or we time out.
# We poll localhost rather than the public IP so the security group
# doesn't matter for this check — we're verifying the *app* came up,
# not the network path.
echo "==> healthcheck ${HEALTHCHECK_URL} (timeout ${HEALTHCHECK_TIMEOUT_S}s)"
deadline=$(( $(date +%s) + HEALTHCHECK_TIMEOUT_S ))
while true; do
  if curl -fsS -o /dev/null -m 5 "${HEALTHCHECK_URL}"; then
    echo "==> healthcheck OK"
    break
  fi
  if [[ $(date +%s) -ge $deadline ]]; then
    echo "!!  healthcheck FAILED after ${HEALTHCHECK_TIMEOUT_S}s"
    echo "!!  recent pm2 logs:"
    pm2 logs "${PM2_NAME}" --lines 30 --nostream || true
    exit 2
  fi
  sleep 2
done

echo "==> deploy complete (commit $(git rev-parse --short HEAD))"
