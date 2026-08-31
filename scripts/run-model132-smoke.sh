#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model132/smoke}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
MODEL130="schell_table-peg_table-13.0"
MODEL132="schell_table-peg_table-13.2"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
if [[ ! -f "$MODEL_ROOT/rust/cribbage-shadow-engine/assets/model132-keep-pairs.bin" ]]; then
  echo "Missing Model 13.2 keep-pair asset." >&2
  exit 1
fi

run_one() {
  local label="$1"
  local left="$2"
  local right="$3"
  local directory="$OUT_DIR/$label"
  local database="$directory/games.db"
  mkdir -p "$directory"
  if [[ -f "$database" ]] && [[ "$(sqlite3 "$database" 'SELECT COUNT(*) FROM compact_games;')" -eq 1 ]]; then
    echo "skip $label: smoke game complete"
    return
  fi
  "$RUNNER" \
    --left "$left" \
    --right "$right" \
    --games 1 \
    --start-index 0 \
    --total-games 1 \
    --seed 0x13200001 \
    --model-root "$MODEL_ROOT" \
    --max-steps 10000 \
    --workers 1 \
    --out-dir "$directory" \
    --db "$database" \
    --run-id "model132-smoke-$label" \
    --matchup-id "13.0-vs-13.2-keep-pair-asset-only-smoke" \
    >> "$directory/sessions.jsonl" 2>&1
}

run_one "13.2-left" "$MODEL132" "$MODEL130"
run_one "13.0-left" "$MODEL130" "$MODEL132"
echo "complete: $OUT_DIR"
