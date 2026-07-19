#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('${ROOT_DIR}/package.json').version")"
ARCHIVE="${ROOT_DIR}/cribbage-server-${VERSION}.tgz"

for required in \
  "${ROOT_DIR}/dist" \
  "${ROOT_DIR}/rust/Cargo.toml" \
  "${ROOT_DIR}/rust/Cargo.lock" \
  "${ROOT_DIR}/rust/cribbage-api" \
  "${ROOT_DIR}/rust/cribbage-policy-trainer" \
  "${ROOT_DIR}/rust/cribbage-runner" \
  "${ROOT_DIR}/rust/cribbage-shadow-engine" \
  "${ROOT_DIR}/rust/cribbage-shadow-engine/assets"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing deployment input: $required" >&2
    echo "Run npm run build:deploy first." >&2
    exit 1
  fi
done

cd "$ROOT_DIR"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$ARCHIVE" \
  dist \
  rust/Cargo.toml \
  rust/Cargo.lock \
  rust/cribbage-api \
  rust/cribbage-policy-trainer \
  rust/cribbage-runner \
  rust/cribbage-shadow-engine \
  scripts/migrate-legacy-leaderboard.py \
  docs/nanode-rocky-server-setup.md
