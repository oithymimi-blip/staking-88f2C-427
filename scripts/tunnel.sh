#!/usr/bin/env bash
set -euo pipefail

PORT=${PORT:-4001}
HOST=${HOST:-0.0.0.0}

echo "Starting server on ${HOST}:${PORT} for local access..."
HOST=$HOST PORT=$PORT node server.js &
SERVER_PID=$!

cleanup() {
  echo "Stopping server (pid: ${SERVER_PID})"
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 2

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "Server failed to start (port ${PORT} might already be in use)." >&2
  exit 1
fi

echo "Starting LocalTunnel on port ${PORT}..."
npx localtunnel --port "${PORT}"
