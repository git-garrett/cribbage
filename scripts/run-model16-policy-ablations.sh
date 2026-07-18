#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:?usage: scripts/run-model16-policy-ablations.sh OUT_DIR}"
GAMES_PER_SIDE="${GAMES_PER_SIDE:-500}"
WORKERS="${WORKERS:-4}"
RUNNER="${RUNNER:-${ROOT_DIR}/rust/target/release/cribbage-runner}"
MODEL16="schell_table-peg_table-16.0"
MODEL13="schell_table-peg_table-13.0"
POLICY="${ROOT_DIR}/rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin"

if [[ ! -x "$RUNNER" ]]; then
  echo "Missing release runner: $RUNNER" >&2
  exit 1
fi
if [[ ! -f "$POLICY" ]]; then
  echo "Missing Model 16 policy: $POLICY" >&2
  exit 1
fi
if [[ "$GAMES_PER_SIDE" -le 0 || "$WORKERS" -le 0 ]]; then
  echo "GAMES_PER_SIDE and WORKERS must be greater than zero" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

run_matchup() {
  local mode="$1"
  local label="$2"
  local left="$3"
  local right="$4"
  local seed="$5"
  local matchup_dir="${OUT_DIR}/${mode}-${label}"
  local status="${matchup_dir}/status.json"
  local completed=0
  mkdir -p "$matchup_dir"
  if [[ -f "$status" ]]; then
    completed="$(sed -nE 's/.*"completedGames": ([0-9]+).*/\1/p' "$status" | tail -n 1)"
    completed="${completed:-0}"
  fi
  if [[ "$completed" -ge "$GAMES_PER_SIDE" ]]; then
    echo "skip ${mode}-${label}: ${completed}/${GAMES_PER_SIDE} complete"
    return
  fi
  local remaining=$((GAMES_PER_SIDE - completed))
  echo "run ${mode}-${label}: ${completed}/${GAMES_PER_SIDE} complete, ${remaining} remaining"
  "$RUNNER" \
    --left "$left" \
    --right "$right" \
    --games "$remaining" \
    --start-index "$completed" \
    --total-games "$GAMES_PER_SIDE" \
    --seed "$seed" \
    --model-root "$ROOT_DIR" \
    --max-steps 10000 \
    --workers "$WORKERS" \
    --out-dir "$matchup_dir" \
    --db "${matchup_dir}/games.db" \
    --run-id "model16-${mode}-${label}" \
    --matchup-id "$label" \
    --model16-policy-mode "$mode" \
    | tee -a "${matchup_dir}/sessions.jsonl"
}

for mode in sample fallback; do
  run_matchup "$mode" "16-vs-13" "$MODEL16" "$MODEL13" "0x16001300"
  run_matchup "$mode" "13-vs-16" "$MODEL13" "$MODEL16" "0x16001300"
done

echo "complete: ${OUT_DIR}"
