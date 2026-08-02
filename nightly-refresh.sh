#!/usr/bin/env bash
# Nightly cron entry, e.g.:
#   0 2 * * * /path/to/repo/tools/repo-index-mcp/nightly-refresh.sh >> /path/to/repo/.repo-index/refresh.log 2>&1
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

git fetch origin
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

# indexer.js reads the last-indexed commit from the db itself and only
# re-parses/re-embeds files that changed between that commit and HEAD.
node tools/repo-index-mcp/src/indexer.js

echo "[$(date -Is)] repo-index refreshed at $(git rev-parse HEAD)"
