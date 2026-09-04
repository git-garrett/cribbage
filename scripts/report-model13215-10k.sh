#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model13215/evaluation-20260904/13.215-vs-13.0-10k}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
MODEL130="schell_table-peg_table-13.0"
MODEL13215="schell_table-peg_table-13.215"

node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model13215-13.215-left \
  --db "$OUT_DIR/13.215-left/games.db" \
  --json > "$OUT_DIR/13.215-left-analysis.json"
node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model13215-13.0-left \
  --db "$OUT_DIR/13.0-left/games.db" \
  --json > "$OUT_DIR/13.0-left-analysis.json"
python3 "$MODEL_ROOT/scripts/report_paired_benchmark.py" \
  --candidate-left-db "$OUT_DIR/13.215-left/games.db" \
  --opponent-left-db "$OUT_DIR/13.0-left/games.db" \
  --candidate "$MODEL13215" \
  --opponent "$MODEL130" \
  --expected-games "$GAMES_PER_ORIENTATION" \
  --output "$OUT_DIR/paired-summary.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL13215" \
  --opponent "$MODEL130" \
  --candidate-left 13.215-left \
  --opponent-left 13.0-left \
  --candidate-left-run-id model13215-13.215-left \
  --opponent-left-run-id model13215-13.0-left \
  --format json > "$OUT_DIR/full-report.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL13215" \
  --opponent "$MODEL130" \
  --candidate-left 13.215-left \
  --opponent-left 13.0-left \
  --candidate-left-run-id model13215-13.215-left \
  --opponent-left-run-id model13215-13.0-left \
  --format markdown > "$OUT_DIR/full-report.md"
if ! grep -q '^reportsCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'reportsCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
