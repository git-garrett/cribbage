#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${MODEL_ROOT}/benchmarks/model1321/evaluation-20260831/13.0-vs-13.21-dealer-asset-pone-baseline-10k}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-5}"
SEED="${SEED:-0x13201300}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
SOURCE_PATCH_SHA256="${SOURCE_PATCH_SHA256:-unknown}"
MODEL130="schell_table-peg_table-13.0"
MODEL1321="schell_table-peg_table-13.21"
ASSET_DIR="${MODEL_ROOT}/rust/cribbage-shadow-engine/assets"
MODEL130_ASSET="${ASSET_DIR}/model13-pairwise.bin"
MODEL132_ASSET="${ASSET_DIR}/model132-keep-pairs.bin"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
for asset in \
  "$MODEL130_ASSET" \
  "$MODEL132_ASSET" \
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
if [[ "$WORKERS" -le 0 ]]; then
  echo "WORKERS must be positive." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
if [[ ! -f "$OUT_DIR/manifest.txt" ]]; then
  {
    printf 'createdAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'sourceCommit=%s\n' "$SOURCE_COMMIT"
    printf 'sourcePatchSha256=%s\n' "$SOURCE_PATCH_SHA256"
    printf 'candidate=%s\n' "$MODEL1321"
    printf 'baseline=%s\n' "$MODEL130"
    printf 'experiment=model1321-dealer-keep-pair-pone-model130-discard-forecast\n'
    printf 'model1321DealerDiscardPeggingForecast=model13.2-keep-pair-asset\n'
    printf 'model1321PoneDiscardPeggingForecast=model13.0\n'
    printf 'model1321HandScoring=model13.0\n'
    printf 'model1321CribScoring=model13.0\n'
    printf 'model1321BoardObjective=model13.0\n'
    printf 'model1321DiscardTieBreak=model13.0\n'
    printf 'model1321OpeningLead=model13.0-post-cut\n'
    printf 'model1321LivePegging=model13.0\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'crossBenchmarkPairing=same-seed-and-game-index-as-model13.2-vs-model13.0\n'
    printf 'model130AssetSha256=%s\n' "$(shasum -a 256 "$MODEL130_ASSET" | awk '{print $1}')"
    printf 'model132AssetSha256=%s\n' "$(shasum -a 256 "$MODEL132_ASSET" | awk '{print $1}')"
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
      --run-id "model1321-$label" \
      --matchup-id "13.0-vs-13.21-dealer-asset-pone-baseline" \
      >> "$directory/sessions.jsonl" 2>&1
  done < <(missing_ranges "$directory/games.db")
  if [[ "$ran_range" -eq 0 ]]; then
    echo "skip $label: all $GAMES_PER_ORIENTATION indexes complete"
  fi
}

run_orientation "13.21-left" "$MODEL1321" "$MODEL130" &
model1321_pid=$!
run_orientation "13.0-left" "$MODEL130" "$MODEL1321" &
model130_pid=$!

run_status=0
wait "$model1321_pid" || run_status=1
wait "$model130_pid" || run_status=1
if [[ "$run_status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$run_status"
fi

if ! grep -q '^gamesCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'gamesCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
