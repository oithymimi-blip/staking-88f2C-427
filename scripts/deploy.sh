#!/usr/bin/env bash
set -euo pipefail

if [[ "${DEPLOY_HOST:-}" == "" ]]; then
  echo "DEPLOY_HOST is required (e.g. 72.60.221.157)" >&2
  exit 1
fi

DEPLOY_USER=${DEPLOY_USER:-root}
DEPLOY_APP_DIR=${DEPLOY_APP_DIR:-/var/www/puller}
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}
DEPLOY_REPO_URL=${DEPLOY_REPO_URL:-}
DEPLOY_PM2_NAME=${DEPLOY_PM2_NAME:-puller}

if [[ -z "$DEPLOY_REPO_URL" ]]; then
  echo "DEPLOY_REPO_URL is required (https clone url of this repository)" >&2
  exit 1
fi

ssh_opts=(
  "-o" "StrictHostKeyChecking=no"
)

ssh "${ssh_opts[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "bash -s" <<EOF
set -euo pipefail
APP_DIR="${DEPLOY_APP_DIR}"
BRANCH="${DEPLOY_BRANCH}"
REPO_URL="${DEPLOY_REPO_URL}"
PM2_NAME="${DEPLOY_PM2_NAME}"

if [ ! -d "\$APP_DIR/.git" ]; then
  mkdir -p "\$APP_DIR"
  cd "\$APP_DIR"
  if [ -d "\$APP_DIR/.git" ]; then
    git remote set-url origin "\$REPO_URL"
  else
    git clone --branch "\$BRANCH" "\$REPO_URL" "\$APP_DIR"
    cd "\$APP_DIR"
  fi
else
  cd "\$APP_DIR"
fi

git fetch origin "\$BRANCH"
git reset --hard "origin/\$BRANCH"

if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --production
fi

npm run build

if pm2 list | grep -q "\$PM2_NAME"; then
  pm2 restart "\$PM2_NAME"
else
  pm2 start server.js --name "\$PM2_NAME"
fi

systemctl reload nginx
EOF
