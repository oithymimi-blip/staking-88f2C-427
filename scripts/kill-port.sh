#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-${1:-4001}}

if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -ti tcp:"${PORT}" || true)
  if [ -n "${PIDS}" ]; then
    echo "${PIDS}" | xargs -r kill
  fi
else
  echo "Neither fuser nor lsof is available; skipping port check for ${PORT}." >&2
  exit 0
fi
