#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model1321/smoke}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
MODEL130="schell_table-peg_table-13.0"
MODEL1321="schell_table-peg_table-13.21"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
if [[ ! -f "$MODEL_ROOT/rust/cribbage-shadow-engine/assets/model132-keep-pairs.bin" ]]; then
  echo "Missing Model 13.2 keep-pair asset required by Model 13.21." >&2
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
    --seed 0x13210001 \
    --model-root "$MODEL_ROOT" \
    --max-steps 10000 \
    --workers 1 \
    --out-dir "$directory" \
    --db "$database" \
    --run-id "model1321-smoke-$label" \
    --matchup-id "13.0-vs-13.21-dealer-asset-pone-baseline-smoke" \
    >> "$directory/sessions.jsonl" 2>&1
}

run_one "13.21-left" "$MODEL1321" "$MODEL130"
run_one "13.0-left" "$MODEL130" "$MODEL1321"
echo "complete: $OUT_DIR"
