#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model1322/evaluation-20260913/13.22-vs-13.215-10k}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
MODEL13215="schell_table-peg_table-13.215"
MODEL1322="schell_table-peg_table-13.22"

node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model1322-13.22-left \
  --db "$OUT_DIR/13.22-left/games.db" \
  --json > "$OUT_DIR/13.22-left-analysis.json"
node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model1322-13.215-left \
  --db "$OUT_DIR/13.215-left/games.db" \
  --json > "$OUT_DIR/13.215-left-analysis.json"
python3 "$MODEL_ROOT/scripts/report_paired_benchmark.py" \
  --candidate-left-db "$OUT_DIR/13.22-left/games.db" \
  --opponent-left-db "$OUT_DIR/13.215-left/games.db" \
  --candidate "$MODEL1322" \
  --opponent "$MODEL13215" \
  --expected-games "$GAMES_PER_ORIENTATION" \
  --output "$OUT_DIR/paired-summary.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL1322" \
  --opponent "$MODEL13215" \
  --candidate-left 13.22-left \
  --opponent-left 13.215-left \
  --candidate-left-run-id model1322-13.22-left \
  --opponent-left-run-id model1322-13.215-left \
  --format json > "$OUT_DIR/full-report.json"
node --no-warnings "$MODEL_ROOT/scripts/report-paired-live-benchmark.cjs" \
  --root "$OUT_DIR" \
  --candidate "$MODEL1322" \
  --opponent "$MODEL13215" \
  --candidate-left 13.22-left \
  --opponent-left 13.215-left \
  --candidate-left-run-id model1322-13.22-left \
  --opponent-left-run-id model1322-13.215-left \
  --format markdown > "$OUT_DIR/full-report.md"
if ! grep -q '^reportsCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'reportsCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
