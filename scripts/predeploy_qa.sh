#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
exec scripts/run-quiet.sh --show-warnings "Predeploy QA" scripts/predeploy_qa_checks.sh
