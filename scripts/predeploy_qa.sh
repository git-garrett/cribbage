#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
npm run typecheck
npm run test:web
npm test
npm run build:deploy
npm run package:server
