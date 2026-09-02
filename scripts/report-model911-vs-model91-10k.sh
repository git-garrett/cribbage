#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model911/evaluation-20260901/9.11-vs-9.1-10k}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
MODEL91="schell_table-peg_table-9.1"
MODEL911="schell_table-peg_table-9.11"

node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model911-9.11-left \
  --db "$OUT_DIR/9.11-left/games.db" \
  --json > "$OUT_DIR/9.11-left-analysis.json"
node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model911-9.1-left \
  --db "$OUT_DIR/9.1-left/games.db" \
  --json > "$OUT_DIR/9.1-left-analysis.json"
python3 "$MODEL_ROOT/scripts/report_paired_benchmark.py" \
  --candidate-left-db "$OUT_DIR/9.11-left/games.db" \
  --opponent-left-db "$OUT_DIR/9.1-left/games.db" \
  --candidate "$MODEL911" \
  --opponent "$MODEL91" \
  --expected-games "$GAMES_PER_ORIENTATION" \
  --output "$OUT_DIR/paired-summary.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL911" \
  --opponent "$MODEL91" \
  --candidate-left 9.11-left \
  --opponent-left 9.1-left \
  --candidate-left-run-id model911-9.11-left \
  --opponent-left-run-id model911-9.1-left \
  --format json > "$OUT_DIR/full-report.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL911" \
  --opponent "$MODEL91" \
  --candidate-left 9.11-left \
  --opponent-left 9.1-left \
  --candidate-left-run-id model911-9.11-left \
  --opponent-left-run-id model911-9.1-left \
  --format markdown > "$OUT_DIR/full-report.md"
if ! grep -q '^reportsCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'reportsCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
