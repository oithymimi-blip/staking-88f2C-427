#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
PUBLIC_DIR="${ROOT_DIR}/public"

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

cp -R "${PUBLIC_DIR}/." "${DIST_DIR}/"

cat > "${DIST_DIR}/_redirects" <<'EOF'
# Netlify: ensure clean admin route works without .html
/admin    /admin.html    200
EOF

echo "Dist build complete at ${DIST_DIR}"
