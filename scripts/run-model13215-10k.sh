#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model13215/evaluation-20260904/13.215-vs-13.0-10k}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-2}"
SEED="${SEED:-0x13201300}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
MATRIX_SOURCE_SHA256="${MATRIX_SOURCE_SHA256:-unknown}"
MODEL130="schell_table-peg_table-13.0"
MODEL13215="schell_table-peg_table-13.215"
ASSET_DIR="${MODEL_ROOT}/rust/cribbage-shadow-engine/assets"
MATRIX_ASSET="${ASSET_DIR}/board-win-matrix.bin"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
for asset in \
  "$MATRIX_ASSET" \
  "$ASSET_DIR/model13-pairwise.bin" \
  "$ASSET_DIR/model13-hold.bin" \
  "$ASSET_DIR/crib-rank-score-by-discard-cut.json" \
  "$ASSET_DIR/crib-score-histogram-by-discard-cut.json"; do
  if [[ ! -f "$asset" ]]; then
    echo "Missing benchmark asset: $asset" >&2
    exit 1
  fi
done
if [[ "$GAMES_PER_ORIENTATION" -ne 5000 ]]; then
  echo "This benchmark requires exactly 5,000 games per orientation." >&2
  exit 1
fi
if [[ "$WORKERS" -ne 2 ]]; then
  echo "This benchmark reserves exactly two workers per orientation." >&2
  exit 1
fi
RUNNER_SHA256="$(shasum -a 256 "$RUNNER" | awk '{print $1}')"
MATRIX_ASSET_SHA256="$(shasum -a 256 "$MATRIX_ASSET" | awk '{print $1}')"

mkdir -p "$OUT_DIR"
if [[ ! -f "$OUT_DIR/manifest.txt" ]]; then
  {
    printf 'createdAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'sourceCommit=%s\n' "$SOURCE_COMMIT"
    printf 'candidate=%s\n' "$MODEL13215"
    printf 'baseline=%s\n' "$MODEL130"
    printf 'experiment=model13215-pooled-phase-seam-board-matrix-ablation\n'
    printf 'model13215KnownInformation=applied-before-lookup\n'
    printf 'model13215FutureBoard=pooled-phase-seam-board-win-matrix-direct-lookup\n'
    printf 'model13215LivePegging=model13.0-search-with-known-score-distributions-before-lookup\n'
    printf 'model13HandCache=per-player-per-hand-opponent-hidden-worlds\n'
    printf 'model13HandCachePruning=newly-public-opponent-cards\n'
    printf 'model13DecisionMemo=decision-local-transposition-arena\n'
    printf 'model13HandCacheActions=never-cached\n'
    printf 'matrixCohort=pooled\n'
    printf 'matrixFormat=BWM2\n'
    printf 'matrixSeams=discard,after_discard,after_pegging,after_pone\n'
    printf 'matrixGames=40000\n'
    printf 'matrixSeedClusters=10000\n'
    printf 'matrixSourceSha256=%s\n' "$MATRIX_SOURCE_SHA256"
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'totalWorkers=%s\n' "$((WORKERS * 2))"
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'crossBenchmarkPairing=same-seed-and-game-index-as-model13.2-vs-model13.0\n'
    printf 'matrixAssetSha256=%s\n' "$MATRIX_ASSET_SHA256"
    printf 'runnerSha256=%s\n' "$RUNNER_SHA256"
  } > "$OUT_DIR/manifest.txt"
else
  for expected in \
    "sourceCommit=$SOURCE_COMMIT" \
    "candidate=$MODEL13215" \
    "baseline=$MODEL130" \
    "model13HandCache=per-player-per-hand-opponent-hidden-worlds" \
    "matrixSourceSha256=$MATRIX_SOURCE_SHA256" \
    "matrixAssetSha256=$MATRIX_ASSET_SHA256" \
    "runnerSha256=$RUNNER_SHA256"; do
    if ! grep -Fqx "$expected" "$OUT_DIR/manifest.txt"; then
      echo "Refusing mixed-provenance resume; manifest is missing: $expected" >&2
      exit 1
    fi
  done
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
      SELECT game_index + 1 FROM expected
      WHERE game_index + 1 < ${GAMES_PER_ORIENTATION}
    ),
    missing AS (
      SELECT expected.game_index FROM expected
      LEFT JOIN compact_games USING (game_index)
      WHERE compact_games.game_index IS NULL
    ),
    grouped AS (
      SELECT game_index,
             game_index - ROW_NUMBER() OVER (ORDER BY game_index) AS run
      FROM missing
    )
    SELECT MIN(game_index), COUNT(*) FROM grouped
    GROUP BY run ORDER BY MIN(game_index);
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
      --run-id "model13215-$label" \
      --matchup-id "13.215-vs-13.0-board-matrix" \
      >> "$directory/sessions.jsonl" 2>&1
  done < <(missing_ranges "$directory/games.db")
  if [[ "$ran_range" -eq 0 ]]; then
    echo "skip $label: all $GAMES_PER_ORIENTATION indexes complete"
  fi
}

run_orientation "13.215-left" "$MODEL13215" "$MODEL130" &
candidate_pid=$!
run_orientation "13.0-left" "$MODEL130" "$MODEL13215" &
baseline_pid=$!

run_status=0
wait "$candidate_pid" || run_status=1
wait "$baseline_pid" || run_status=1
if [[ "$run_status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$run_status"
fi

if ! grep -q '^gamesCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'gamesCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
