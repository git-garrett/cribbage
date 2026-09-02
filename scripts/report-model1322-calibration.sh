#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL1322_RUNTIME_ROOT:?MODEL1322_RUNTIME_ROOT is required}"
OUT_DIR="${MODEL1322_OUT_DIR:?MODEL1322_OUT_DIR is required}"
WORKERS="${MODEL1322_WORKERS:-10}"
WALL_SECONDS_FILE="${OUT_DIR}/wall-seconds.txt"
FULL_WORKLOAD="${MODEL1322_FULL_WORKLOAD:-}"

if [[ ! -f "$WALL_SECONDS_FILE" ]]; then
  echo "missing Model 13.22 calibration wall time: $WALL_SECONDS_FILE" >&2
  exit 1
fi

full_workload_args=()
if [[ -n "$FULL_WORKLOAD" ]]; then
  full_workload_args+=(--full-workload "$FULL_WORKLOAD")
fi

python3 "${RUNTIME_ROOT}/scripts/summarize-model1322-calibration.py" \
  --output "$OUT_DIR" \
  --workers "$WORKERS" \
  --wall-seconds "$(tr -d '[:space:]' < "$WALL_SECONDS_FILE")" \
  "${full_workload_args[@]}"
