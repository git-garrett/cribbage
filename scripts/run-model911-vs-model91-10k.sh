#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model911/evaluation-20260901/9.11-vs-9.1-10k}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-2}"
SEED="${SEED:-0x09110911}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
SOURCE_PATCH_SHA256="${SOURCE_PATCH_SHA256:-unknown}"
MODEL91="schell_table-peg_table-9.1"
MODEL911="schell_table-peg_table-9.11"
ASSET_DIR="${MODEL_ROOT}/rust/cribbage-shadow-engine/assets"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
for asset in \
  model91-discard-ev.bin \
  model911-discard-ev.bin \
  model91-pegging-beliefs.bin \
  model1322-decline-factors.json; do
  if [[ ! -f "$ASSET_DIR/$asset" ]]; then
    echo "Missing Model 9.x asset: $asset" >&2
    exit 1
  fi
done
if [[ "$GAMES_PER_ORIENTATION" -ne 5000 ]]; then
  echo "This benchmark requires exactly 5,000 games per orientation." >&2
  exit 1
fi
if [[ "$WORKERS" -ne 2 ]]; then
  echo "This concurrent benchmark reserves exactly two workers per orientation." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
if [[ ! -f "$OUT_DIR/manifest.txt" ]]; then
  {
    printf 'createdAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'sourceCommit=%s\n' "$SOURCE_COMMIT"
    printf 'sourcePatchSha256=%s\n' "$SOURCE_PATCH_SHA256"
    printf 'candidate=%s\n' "$MODEL911"
    printf 'baseline=%s\n' "$MODEL91"
    printf 'experiment=model911-evidence-aware-pair-forecast-and-live-pegging-vs-model91\n'
    printf 'model911ContinuationPolicy=model91-average-continuation\n'
    printf 'model911LiveEvidence=own-discards-cut-public-go-and-scoring-declines\n'
    printf 'model911ContinuationCache=bounded-actor-relative-exact-descendant-states\n'
    printf 'model911CacheOwner=game-session-shared-across-request-threads-cleared-after-pegging\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'totalBenchmarkWorkers=%s\n' "$((WORKERS * 2))"
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'model91DiscardAssetSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model91-discard-ev.bin" | awk '{print $1}')"
    printf 'model911DiscardAssetSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model911-discard-ev.bin" | awk '{print $1}')"
    printf 'beliefAssetSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model91-pegging-beliefs.bin" | awk '{print $1}')"
    printf 'declineFactorAssetSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model1322-decline-factors.json" | awk '{print $1}')"
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
  local range_start
  local range_games
  local ran_range=0
  mkdir -p "$directory"
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
      --run-id "model911-$label" \
      --matchup-id "9.11-vs-9.1" \
      >> "$directory/sessions.jsonl" 2>&1
  done < <(missing_ranges "$directory/games.db")
  if [[ "$ran_range" -eq 0 ]]; then
    echo "skip $label: all $GAMES_PER_ORIENTATION indexes complete"
  fi
}

run_orientation "9.11-left" "$MODEL911" "$MODEL91" &
model911_pid=$!
run_orientation "9.1-left" "$MODEL91" "$MODEL911" &
model91_pid=$!

run_status=0
wait "$model911_pid" || run_status=1
wait "$model91_pid" || run_status=1
if [[ "$run_status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$run_status"
fi

if ! grep -q '^gamesCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'gamesCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
