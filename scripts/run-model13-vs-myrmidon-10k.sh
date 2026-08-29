#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
ROOT_DIR="${BENCH_MODEL_ROOT:-${SCRIPT_ROOT}}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/benchmarks/myrmidon/13.0-vs-myrmidon5-10k-20260828}"
RUNNER="${RUNNER:-${ROOT_DIR}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-2}"
SEED="${SEED:-0x13a0d005}"
MODEL130="schell_table-peg_table-13.0"
MYRMIDON="myrmidon-5"
MODEL130_ASSET="${ROOT_DIR}/rust/cribbage-shadow-engine/assets/model13-pairwise.bin"
MYRMIDON_SOURCE="${ROOT_DIR}/rust/cribbage-shadow-engine/myrmidon.rs"
REFERENCE_COMMIT="2d6370b34aca7c81932fd0d483da763eb6c08994"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  echo "Run: cargo build --manifest-path rust/Cargo.toml --release -p cribbage-runner" >&2
  exit 1
fi
for required in "$MODEL130_ASSET" "$MYRMIDON_SOURCE"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing benchmark input: $required" >&2
    exit 1
  fi
done
if [[ "$GAMES_PER_ORIENTATION" -ne 5000 ]]; then
  echo "This benchmark contract requires exactly 5,000 games per orientation." >&2
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
    printf 'gitCommit=%s\n' "${BENCH_GIT_COMMIT:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
    printf 'candidate=%s\n' "$MODEL130"
    printf 'opponent=%s\n' "$MYRMIDON"
    printf 'experiment=model-13.0-vs-canonical-moulton-myrmidon-five-sample-policy\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'seed=%s\n' "$SEED"
    printf 'firstDealer=alternates-by-game-index\n'
    printf 'orientationPairing=same-seed-and-game-index-with-model-sides-swapped\n'
    printf 'myrmidonStarterSamples=5\n'
    printf 'myrmidonDecisionRng=independent-deterministic-SplitMix64\n'
    printf 'myrmidonReferenceUrl=https://github.com/richard-moulton/Cribbage\n'
    printf 'myrmidonReferenceCommit=%s\n' "$REFERENCE_COMMIT"
    printf 'myrmidonReferenceLicense=GPL-3.0\n'
    printf 'myrmidonParity=discard-and-pegging-fixtures-cross-checked-against-reference-source\n'
    printf 'model130AssetSha256=%s\n' "$(shasum -a 256 "$MODEL130_ASSET" | awk '{print $1}')"
    printf 'myrmidonSourceSha256=%s\n' "$(shasum -a 256 "$MYRMIDON_SOURCE" | awk '{print $1}')"
    printf 'runnerSha256=%s\n' "$(shasum -a 256 "$RUNNER" | awk '{print $1}')"
  } > "$OUT_DIR/manifest.txt"
fi

completed_games() {
  local directory="$1"
  local database="${directory}/games.db"
  if [[ ! -f "$database" ]]; then
    printf '0'
    return
  fi
  local prefix
  prefix="$(sqlite3 "$database" '
    WITH ordered AS (
      SELECT game_index, ROW_NUMBER() OVER (ORDER BY game_index) - 1 AS expected_index
      FROM compact_games
    )
    SELECT COALESCE(
      MIN(CASE WHEN game_index != expected_index THEN expected_index END),
      (SELECT COUNT(*) FROM compact_games)
    )
    FROM ordered;
  ')"
  printf '%s' "${prefix:-0}"
}

run_orientation() {
  local label="$1"
  local left="$2"
  local right="$3"
  local directory="${OUT_DIR}/${label}"
  local completed
  mkdir -p "$directory"
  completed="$(completed_games "$directory")"
  completed="${completed:-0}"
  if [[ "$completed" -ge "$GAMES_PER_ORIENTATION" ]]; then
    echo "skip ${label}: ${completed}/${GAMES_PER_ORIENTATION} complete"
    return
  fi
  local remaining=$((GAMES_PER_ORIENTATION - completed))
  echo "run ${label}: ${completed}/${GAMES_PER_ORIENTATION} complete, ${remaining} remaining"
  "$RUNNER" \
    --left "$left" \
    --right "$right" \
    --games "$remaining" \
    --start-index "$completed" \
    --total-games "$GAMES_PER_ORIENTATION" \
    --seed "$SEED" \
    --model-root "$ROOT_DIR" \
    --max-steps 10000 \
    --workers "$WORKERS" \
    --out-dir "$directory" \
    --db "$directory/games.db" \
    --run-id "model13-myrmidon-${label}" \
    --matchup-id "13.0-vs-myrmidon-5" \
    | tee -a "$directory/sessions.jsonl"
}

run_orientation "13.0-left" "$MODEL130" "$MYRMIDON" &
model130_left_pid=$!
run_orientation "myrmidon-left" "$MYRMIDON" "$MODEL130" &
myrmidon_left_pid=$!

status=0
wait "$model130_left_pid" || status=1
wait "$myrmidon_left_pid" || status=1
if [[ "$status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$status"
fi

if command -v node >/dev/null 2>&1 && [[ -f "$ROOT_DIR/scripts/analyze-ai-run.cjs" ]]; then
  node "$ROOT_DIR/scripts/analyze-ai-run.cjs" \
    model13-myrmidon-13.0-left \
    --db "$OUT_DIR/13.0-left/games.db" \
    --json > "$OUT_DIR/13.0-left-analysis.json"
  node "$ROOT_DIR/scripts/analyze-ai-run.cjs" \
    model13-myrmidon-myrmidon-left \
    --db "$OUT_DIR/myrmidon-left/games.db" \
    --json > "$OUT_DIR/myrmidon-left-analysis.json"
fi
printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
echo "complete: $OUT_DIR"
