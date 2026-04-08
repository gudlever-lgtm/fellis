#!/usr/bin/env bash
# deploy.sh — Pull latest code, build frontend, restart server
# Usage: bash scripts/deploy.sh [--skip-migrate]
#
# Run this from the repo root on the server:
#   cd /var/www/fellis.eu && bash scripts/deploy.sh

set -euo pipefail

SKIP_MIGRATE=0
for arg in "$@"; do
  [[ "$arg" == "--skip-migrate" ]] && SKIP_MIGRATE=1
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✖ $1${NC}"; exit 1; }

step "Git pull"
git pull origin "$(git branch --show-current)" || fail "git pull failed"

step "Install frontend dependencies"
npm install --prefer-offline || fail "npm install failed"

step "Install server dependencies"
(cd server && npm install --prefer-offline) || fail "server npm install failed"

if [[ "$SKIP_MIGRATE" -eq 0 ]]; then
  step "Running database migrations"
  (cd server && npm run migrate) || fail "migrations failed"
else
  warn "Skipping migrations (--skip-migrate)"
fi

step "Building frontend"
npm run build || fail "build failed"

step "Restarting PM2"
pm2 restart all || fail "pm2 restart failed"

# Brief pause so PM2 has time to come up before we show status
sleep 2
pm2 status

echo -e "\n${GREEN}✔ Deploy complete$(date +'  %Y-%m-%d %H:%M:%S')${NC}"
