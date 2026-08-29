#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/myrmidon/9.1-vs-myrmidon5-10k-20260829}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-5}"
SEED="${SEED:-0x091d0005}"
MODEL91="schell_table-peg_table-9.1"
MYRMIDON="myrmidon-5"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
for asset in \
  model91-discard-ev.bin \
  model91-pair-outcomes.bin \
  model91-pegging-beliefs.bin \
  model91-pone-leads.bin; do
  if [[ ! -f "$MODEL_ROOT/rust/cribbage-shadow-engine/assets/$asset" ]]; then
    echo "Missing Model 9.1 asset: $asset" >&2
    exit 1
  fi
done
if [[ "$GAMES_PER_ORIENTATION" -ne 5000 ]]; then
  echo "This benchmark requires exactly 5,000 games per orientation." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
if [[ ! -f "$OUT_DIR/manifest.txt" ]]; then
  {
    printf 'createdAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'candidate=%s\n' "$MODEL91"
    printf 'opponent=%s\n' "$MYRMIDON"
    printf 'experiment=model-9.1-vs-canonical-moulton-myrmidon-five-sample-policy\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'myrmidonStarterSamples=5\n'
    printf 'myrmidonDecisionRng=independent-deterministic-SplitMix64\n'
    printf 'myrmidonReferenceCommit=2d6370b34aca7c81932fd0d483da763eb6c08994\n'
    printf 'runnerSha256=%s\n' "$(shasum -a 256 "$RUNNER" | awk '{print $1}')"
  } > "$OUT_DIR/manifest.txt"
fi

missing_ranges() {
  local database="$1"
  if [[ ! -f "$database" ]]; then
    printf '0 %s\n' "$GAMES_PER_ORIENTATION"
    return
  fi
  sqlite3 -separator ' ' "$database" "
    WITH RECURSIVE expected(game_index) AS (
      SELECT 0
      UNION ALL
      SELECT game_index + 1
      FROM expected
      WHERE game_index + 1 < ${GAMES_PER_ORIENTATION}
    ),
    missing AS (
      SELECT expected.game_index
      FROM expected
      LEFT JOIN compact_games USING (game_index)
      WHERE compact_games.game_index IS NULL
    ),
    grouped AS (
      SELECT game_index,
             game_index - ROW_NUMBER() OVER (ORDER BY game_index) AS run
      FROM missing
    )
    SELECT MIN(game_index), COUNT(*)
    FROM grouped
    GROUP BY run
    ORDER BY MIN(game_index);
  "
}

run_orientation() {
  local label="$1"
  local left="$2"
  local right="$3"
  local directory="$OUT_DIR/$label"
  mkdir -p "$directory"
  local range_start
  local range_games
  local ran_range=0
  while read -r range_start range_games; do
    if [[ -z "${range_start:-}" ]]; then
      continue
    fi
    ran_range=1
    echo "run $label: missing indexes $range_start..$((range_start + range_games - 1))"
    "$RUNNER" \
      --left "$left" \
      --right "$right" \
      --games "$range_games" \
      --start-index "$range_start" \
      --total-games "$GAMES_PER_ORIENTATION" \
      --seed "$SEED" \
      --model-root "$MODEL_ROOT" \
      --max-steps 10000 \
      --workers "$WORKERS" \
      --out-dir "$directory" \
      --db "$directory/games.db" \
      --run-id "model91-myrmidon-$label" \
      --matchup-id "9.1-vs-myrmidon-5" \
      >> "$directory/sessions.jsonl" 2>&1
  done < <(missing_ranges "$directory/games.db")
  if [[ "$ran_range" -eq 0 ]]; then
    echo "skip $label: all $GAMES_PER_ORIENTATION indexes complete"
  fi
}

run_orientation 9.1-left "$MODEL91" "$MYRMIDON" &
model91_pid=$!
run_orientation myrmidon-left "$MYRMIDON" "$MODEL91" &
myrmidon_pid=$!

run_status=0
wait "$model91_pid" || run_status=1
wait "$myrmidon_pid" || run_status=1
if [[ "$run_status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$run_status"
fi

node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model91-myrmidon-9.1-left \
  --db "$OUT_DIR/9.1-left/games.db" \
  --json > "$OUT_DIR/9.1-left-analysis.json"
node --no-warnings "$MODEL_ROOT/scripts/analyze-ai-run.cjs" \
  model91-myrmidon-myrmidon-left \
  --db "$OUT_DIR/myrmidon-left/games.db" \
  --json > "$OUT_DIR/myrmidon-left-analysis.json"
python3 "$MODEL_ROOT/scripts/report_paired_benchmark.py" \
  --candidate-left-db "$OUT_DIR/9.1-left/games.db" \
  --opponent-left-db "$OUT_DIR/myrmidon-left/games.db" \
  --candidate "$MODEL91" \
  --opponent "$MYRMIDON" \
  --expected-games "$GAMES_PER_ORIENTATION" \
  --output "$OUT_DIR/paired-summary.json"
printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
echo "complete: $OUT_DIR"
