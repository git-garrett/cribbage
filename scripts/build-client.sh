#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
node --max-old-space-size=8192 node_modules/vite/bin/vite.js build
node scripts/check-client-artifacts.cjs
