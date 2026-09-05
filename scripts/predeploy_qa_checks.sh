#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
PYTHON_BIN="${PYTHON_BIN:-${ROOT_DIR}/.venv/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]] || ! "$PYTHON_BIN" -c 'import flake8, pytest' 2>/dev/null; then
  echo "Python QA dependencies are missing. Run: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'" >&2
  exit 1
fi

scripts/run-quiet.sh "Python lint" "$PYTHON_BIN" -m flake8 src tests scripts webapp.py --count --select=E9,F63,F7,F82 --show-source --statistics
scripts/run-quiet.sh "Python tests" "$PYTHON_BIN" -m pytest
npm run --silent test:quiet-wrapper
npm run --silent typecheck
npm run --silent test:web
npm test --silent
npm run --silent build:deploy
scripts/run-quiet.sh "Browser regressions" node scripts/test-browser-regressions.cjs
npm run --silent package:server
