#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:?usage: scripts/run-model16-weekend-training.sh OUT_DIR CORPUS_TSV}"
CORPUS="${2:?usage: scripts/run-model16-weekend-training.sh OUT_DIR CORPUS_TSV}"
TRAINER="${TRAINER:-${ROOT_DIR}/rust/target/release/cribbage-policy-trainer}"
ITERATIONS="${ITERATIONS:-300000000}"
WORKERS="${WORKERS:-1}"
MAX_INFORMATION_SETS="${MAX_INFORMATION_SETS:-8000000}"
CHECKPOINT_EVERY="${CHECKPOINT_EVERY:-10000000}"
STATUS_EVERY="${STATUS_EVERY:-10000}"
WALL_BUDGET_SECONDS="${WALL_BUDGET_SECONDS:-216000}"
MAX_REFERENCE_EQUIVALENTS="${MAX_REFERENCE_EQUIVALENTS:-5}"
SEED="${SEED:-0x16c0ffee}"
WAIT_FOR_LOG="${WAIT_FOR_LOG:-}"
CHECKPOINT="${OUT_DIR}/model16-realistic-300m.cfr"
STATUS="${OUT_DIR}/status.json"
SUPERVISOR_STATUS="${OUT_DIR}/supervisor-status.json"

if [[ ! -x "$TRAINER" ]]; then
  echo "Missing release trainer: $TRAINER" >&2
  exit 1
fi
if [[ ! -f "$CORPUS" ]]; then
  echo "Missing training corpus: $CORPUS" >&2
  exit 1
fi
if [[ "$ITERATIONS" -le 0 || "$WORKERS" -le 0 || "$MAX_INFORMATION_SETS" -le 0 ]]; then
  echo "ITERATIONS, WORKERS, and MAX_INFORMATION_SETS must be greater than zero" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

write_supervisor_status() {
  local state="$1"
  local temporary="${SUPERVISOR_STATUS}.tmp"
  printf '{\n  "state": "%s",\n  "updatedAt": "%s",\n  "waitForLog": "%s",\n  "checkpoint": "%s",\n  "trainerStatus": "%s"\n}\n' \
    "$state" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$WAIT_FOR_LOG" \
    "$CHECKPOINT" \
    "$STATUS" > "$temporary"
  mv "$temporary" "$SUPERVISOR_STATUS"
}

if [[ -n "$WAIT_FOR_LOG" ]]; then
  write_supervisor_status "waiting_for_ablations"
  until [[ -f "$WAIT_FOR_LOG" ]] && grep -q '^complete:' "$WAIT_FOR_LOG"; do
    sleep 60
    write_supervisor_status "waiting_for_ablations"
  done
fi

write_supervisor_status "training"
args=(
  --iterations "$ITERATIONS"
  --seed "$SEED"
  --workers "$WORKERS"
  --checkpoint "$CHECKPOINT"
  --status "$STATUS"
  --checkpoint-every "$CHECKPOINT_EVERY"
  --status-every "$STATUS_EVERY"
  --wall-budget-seconds "$WALL_BUDGET_SECONDS"
  --max-reference-equivalents "$MAX_REFERENCE_EQUIVALENTS"
  --max-information-sets "$MAX_INFORMATION_SETS"
  --freeze-at-information-set-limit
  --corpus "$CORPUS"
)
if [[ -f "$CHECKPOINT" ]]; then
  args+=(--resume)
fi

"$TRAINER" "${args[@]}"
write_supervisor_status "complete"
