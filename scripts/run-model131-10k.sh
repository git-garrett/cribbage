#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/benchmarks/model131/evaluation-20260828/13.0-vs-13.1-discard-only-legal-leads-10k}"
RUNNER="${RUNNER:-${ROOT_DIR}/rust/target/release/cribbage-runner}"
GAMES_PER_ORIENTATION="${GAMES_PER_ORIENTATION:-5000}"
WORKERS="${WORKERS:-4}"
SEED="${SEED:-0x13101301}"
MODEL130="schell_table-peg_table-13.0"
MODEL131="schell_table-peg_table-13.1"
MODEL130_ASSET="${ROOT_DIR}/rust/cribbage-shadow-engine/assets/model13-pairwise.bin"
MODEL131_ASSET="${ROOT_DIR}/rust/cribbage-shadow-engine/assets/model131-discard-histograms.bin"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  echo "Run: cargo build --manifest-path rust/Cargo.toml --release -p cribbage-runner" >&2
  exit 1
fi
for asset in "$MODEL130_ASSET" "$MODEL131_ASSET"; do
  if [[ ! -f "$asset" ]]; then
    echo "Missing benchmark asset: $asset" >&2
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
    printf 'gitCommit=%s\n' "$(git -C "$ROOT_DIR" rev-parse HEAD)"
    printf 'candidate=%s\n' "$MODEL131"
    printf 'baseline=%s\n' "$MODEL130"
    printf 'experiment=discard-time-pegging-histogram-only\n'
    printf 'model131LeadSelection=model13.0\n'
    printf 'model131LivePegging=model13.0\n'
    printf 'openingLeadSelection=post-cut-model13.0-live\n'
    printf 'gamesPerOrientation=%s\n' "$GAMES_PER_ORIENTATION"
    printf 'totalGames=%s\n' "$((GAMES_PER_ORIENTATION * 2))"
    printf 'workersPerOrientation=%s\n' "$WORKERS"
    printf 'seed=%s\n' "$SEED"
    printf 'model130AssetSha256=%s\n' "$(shasum -a 256 "$MODEL130_ASSET" | awk '{print $1}')"
    printf 'model131AssetSha256=%s\n' "$(shasum -a 256 "$MODEL131_ASSET" | awk '{print $1}')"
    printf 'runnerSha256=%s\n' "$(shasum -a 256 "$RUNNER" | awk '{print $1}')"
  } > "$OUT_DIR/manifest.txt"
fi

completed_games() {
  local directory="$1"
  local database="${directory}/games.db"
  if [[ -f "$database" ]]; then
    local count
    local minimum
    local maximum
    IFS='|' read -r count minimum maximum < <(
      sqlite3 "$database" \
        'SELECT COUNT(*), COALESCE(MIN(game_index), -1), COALESCE(MAX(game_index), -1) FROM compact_games;'
    )
    if [[ "$count" -eq 0 ]]; then
      printf '0'
      return
    fi
    if [[ "$minimum" -ne 0 || $((maximum + 1)) -ne "$count" ]]; then
      echo "Cannot resume ${directory}: game indexes are not a contiguous 0-based prefix." >&2
      return 1
    fi
    printf '%s' "$count"
    return
  fi
  local status="${directory}/status.json"
  if [[ ! -f "$status" ]]; then
    printf '0'
    return
  fi
  sed -nE 's/.*"completedGames": ([0-9]+).*/\1/p' "$status" | tail -n 1
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
    --run-id "model131-${label}" \
    --matchup-id "13.0-vs-13.1-discard-only-legal-leads" \
    | tee -a "$directory/sessions.jsonl"
}

run_orientation "13.1-left" "$MODEL131" "$MODEL130" &
model131_left_pid=$!
run_orientation "13.0-left" "$MODEL130" "$MODEL131" &
model130_left_pid=$!

status=0
wait "$model131_left_pid" || status=1
wait "$model130_left_pid" || status=1
if [[ "$status" -ne 0 ]]; then
  echo "At least one orientation failed; rerun this script to resume." >&2
  exit "$status"
fi

node "$ROOT_DIR/scripts/report-model131-benchmark.cjs" \
  "$OUT_DIR/13.1-left/games.db" \
  "$OUT_DIR/13.0-left/games.db" \
  > "$OUT_DIR/paired-summary.json"
printf 'completedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_DIR/manifest.txt"
echo "complete: $OUT_DIR"
