#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:?Set the frozen benchmark output directory}"
RUNNER="${RUNNER:-${MODEL_ROOT}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-6}"
if [[ -z "${SEED:-}" ]]; then
  if [[ -f "$OUT_DIR/manifest.txt" ]]; then
    SEED="$(awk -F= '$1 == "seed" { print $2; exit }' "$OUT_DIR/manifest.txt")"
  else
    SEED="$(python3 -c 'import secrets; print(hex(secrets.randbelow(2**32 - 5000)))')"
  fi
fi
: "${SEED:?Benchmark seed is missing}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
EXPECTED_RUNNER_SHA256="${EXPECTED_RUNNER_SHA256:-unknown}"
EXPECTED_CORRECTION_SHA256="${EXPECTED_CORRECTION_SHA256:-unknown}"
PRIOR20="schell_table-peg_table-20.0"
FROZEN_ENGINE="${FROZEN_ENGINE:?Set the frozen 20.0 decision worker}"
FROZEN_MODEL_ROOT="${FROZEN_MODEL_ROOT:?Set the frozen 20.0 model root}"
MODEL20="schell_table-peg_table-20.1"
ASSET_DIR="${MODEL_ROOT}/rust/cribbage-shadow-engine/assets"
CORRECTION_ASSET="${ASSET_DIR}/model1323-corrections.bin"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
for asset in \
  "$CORRECTION_ASSET" \
  "$ASSET_DIR/model1322-decline-factors.json" \
  "$ASSET_DIR/model1322-opponent-discard-histograms.json" \
  "$ASSET_DIR/model91-pegging-beliefs.bin" \
  "$ASSET_DIR/board-win-matrix.bin" \
  "$ASSET_DIR/model132-keep-prior.json" \
  "$ASSET_DIR/model20-opponent-discards.bin" \
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
if [[ "$WORKERS" -ne 6 ]]; then
  echo "This frozen benchmark uses six workers per orientation." >&2
  exit 1
fi

export FROZEN_ENGINE_SHA256="$(shasum -a 256 "$FROZEN_ENGINE" | awk '{print $1}')"
RUNNER_SHA256="$(shasum -a 256 "$RUNNER" | awk '{print $1}')"
CORRECTION_SHA256="$(shasum -a 256 "$CORRECTION_ASSET" | awk '{print $1}')"
OPPONENT_DISCARDS_SHA256="$(shasum -a 256 "$ASSET_DIR/model20-opponent-discards.bin" | awk '{print $1}')"
if [[ "$EXPECTED_RUNNER_SHA256" != "unknown" && "$RUNNER_SHA256" != "$EXPECTED_RUNNER_SHA256" ]]; then
  echo "Runner checksum differs from the frozen job specification." >&2
  exit 1
fi
if [[ "$EXPECTED_CORRECTION_SHA256" != "unknown" && "$CORRECTION_SHA256" != "$EXPECTED_CORRECTION_SHA256" ]]; then
  echo "Model 13.23 correction checksum differs from the frozen job specification." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
if [[ ! -f "$OUT_DIR/manifest.txt" ]]; then
  {
    printf 'createdAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'sourceCommit=%s\n' "$SOURCE_COMMIT"
    printf 'candidate=%s\n' "$MODEL20"
    printf 'opponent=%s\n' "$PRIOR20"
    printf 'experiment=model201-wp-continuation-vs-frozen-model200\n'
    printf 'model20DiscardForecast=joint-pegging-asset-conditioned-keep-and-suit-aware-show-wp\n'
    printf 'model20OpeningPrior=empirical-model132-keep-prior\n'
    printf 'model20LivePegging=exhaustive-world-rollouts-with-wp-selected-continuation-actions\n'
    printf 'durableObservationActionTable=false\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'totalWorkers=%s\n' "$((WORKERS * 2))"
    printf 'workerSelection=prior-paired-benchmark-allocation-12-logical-cpus\n'
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'crossBenchmarkPairing=fresh-random-sequence-independent-of-earlier-benchmarks\n'
    printf 'correctionAssetSha256=%s\n' "$CORRECTION_SHA256"
    printf 'keepPriorSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model132-keep-prior.json" | awk '{print $1}')"
    printf 'opponentDiscardsSha256=%s\n' "$OPPONENT_DISCARDS_SHA256"
    printf 'declineFactorsSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/model1322-decline-factors.json" | awk '{print $1}')"
    printf 'boardMatrixSha256=%s\n' "$(shasum -a 256 "$ASSET_DIR/board-win-matrix.bin" | awk '{print $1}')"
    printf 'runnerSha256=%s\n' "$RUNNER_SHA256"
    printf 'frozenOpponentEngineSha256=%s\n' "$FROZEN_ENGINE_SHA256"
    printf 'frozenOpponentRoot=%s\n' "$FROZEN_MODEL_ROOT"
    printf 'continuationEvaluator=expected-terminal-wp-over-card-order-continuations-after-pegging-board-seam\n'
    printf 'correctionNormalizationActive=false\n'
  } > "$OUT_DIR/manifest.txt"
else
  for expected in \
    "sourceCommit=$SOURCE_COMMIT" \
    "frozenOpponentEngineSha256=$FROZEN_ENGINE_SHA256" \
    "frozenOpponentRoot=$FROZEN_MODEL_ROOT" \
    "candidate=$MODEL20" \
    "opponent=$PRIOR20" \
    "opponentDiscardsSha256=$OPPONENT_DISCARDS_SHA256" \
    "gamesPerOrientation=$GAMES_PER_ORIENTATION" \
    "workersPerOrientation=$WORKERS" \
    "seed=$SEED" \
    "correctionAssetSha256=$CORRECTION_SHA256" \
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
      --frozen-engine "$FROZEN_ENGINE" \
      --frozen-model-root "$FROZEN_MODEL_ROOT" \
      --frozen-model "$PRIOR20" \
      --max-steps 10000 \
      --workers "$WORKERS" \
      --out-dir "$directory" \
      --db "$directory/games.db" \
      --run-id "model20-$label" \
      --matchup-id "20.1-vs-20.0" \
      >> "$directory/sessions.jsonl" 2>&1
  done < <(missing_ranges "$directory/games.db")
  if [[ "$ran_range" -eq 0 ]]; then
    echo "skip $label: all $GAMES_PER_ORIENTATION indexes complete"
  fi
}

run_orientation "20.1-left" "$MODEL20" "$PRIOR20" &
candidate_pid=$!
run_orientation "20.0-left" "$PRIOR20" "$MODEL20" &
opponent_pid=$!

run_status=0
wait "$candidate_pid" || run_status=1
wait "$opponent_pid" || run_status=1
if [[ "$run_status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$run_status"
fi

if ! grep -q '^gamesCompletedAt=' "$OUT_DIR/manifest.txt"; then
  printf 'gamesCompletedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
fi
echo "complete: $OUT_DIR"
