#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL1322_RUNTIME_ROOT:?MODEL1322_RUNTIME_ROOT is required}"
OUT_DIR="${MODEL1322_OUT_DIR:?MODEL1322_OUT_DIR is required}"
WORKERS="${MODEL1322_WORKERS:-10}"
ROOTS_PER_WORKER="${MODEL1322_ROOTS_PER_WORKER:-3}"
OPPONENT_KEEPS_PER_ROLE="${MODEL1322_OPPONENT_KEEPS_PER_ROLE:-1}"
SEED="${MODEL1322_SEED:-0x13220001}"
POLICY="${MODEL1322_POLICY:-fast}"
ACTION_CACHE_LIMIT="${MODEL1322_ACTION_CACHE_LIMIT:-100000}"
FUTURE_CACHE_LIMIT="${MODEL1322_FUTURE_CACHE_LIMIT:-5000000}"
OPPONENT_DISCARD_MODE="${MODEL1322_OPPONENT_DISCARD_MODE:-conditional-histogram}"
DISCARD_INDEX="${MODEL1322_DISCARD_INDEX:-}"
CUT_RANK="${MODEL1322_CUT_RANK:-}"
BUILDER="${MODEL1322_BUILDER:-${RUNTIME_ROOT}/bin/build_model1322_calibration}"
BELIEFS="${MODEL1322_BELIEFS:-${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin}"
FACTORS="${MODEL1322_FACTORS:-${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model1322-decline-factors.json}"
KEEP_PRIOR="${MODEL1322_KEEP_PRIOR:-${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model132-keep-prior.json}"
DISCARD_HISTOGRAMS="${MODEL1322_DISCARD_HISTOGRAMS:-${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model1322-opponent-discard-histograms.json}"
CANONICAL_ROOTS=18395

if [[ ! -x "$BUILDER" ]]; then
  echo "missing Model 13.22 calibration binary: $BUILDER" >&2
  exit 1
fi
if [[ "$WORKERS" -lt 1 || "$WORKERS" -gt 12 ]]; then
  echo "MODEL1322_WORKERS must be between 1 and 12" >&2
  exit 1
fi
if [[ "$ROOTS_PER_WORKER" -lt 1 ]]; then
  echo "MODEL1322_ROOTS_PER_WORKER must be positive" >&2
  exit 1
fi

case "$POLICY" in
  fast)
    policy_args=(--policy fast)
    ;;
  complete-hand)
    policy_args=(
      --policy complete-hand
      --beliefs "$BELIEFS"
      --action-cache-limit "$ACTION_CACHE_LIMIT"
      --future-cache-limit "$FUTURE_CACHE_LIMIT"
    )
    ;;
  *)
    echo "MODEL1322_POLICY must be fast or complete-hand" >&2
    exit 1
    ;;
esac

case "$OPPONENT_DISCARD_MODE" in
  conditional-histogram)
    opponent_discard_args=(--discard-histograms "$DISCARD_HISTOGRAMS")
    ;;
  keep-only)
    opponent_discard_args=(--keep-only-opponent-discards)
    ;;
  *)
    echo "MODEL1322_OPPONENT_DISCARD_MODE must be conditional-histogram or keep-only" >&2
    exit 1
    ;;
esac

selector_args=(--seed "$SEED")
if [[ -n "$DISCARD_INDEX" ]]; then
  selector_args+=(--discard-index "$DISCARD_INDEX")
fi
if [[ -n "$CUT_RANK" ]]; then
  selector_args+=(--cut-rank "$CUT_RANK")
fi

mkdir -p "$OUT_DIR"
started=$(date +%s)
pids=()
for ((worker = 0; worker < WORKERS; worker += 1)); do
  start=$((worker * CANONICAL_ROOTS / WORKERS))
  shard=$(printf '%s/shard-%02d' "$OUT_DIR" "$worker")
  mkdir -p "$shard"
  "$BUILDER" \
    --output "$shard" \
    "${policy_args[@]}" \
    --factors "$FACTORS" \
    --keep-prior "$KEEP_PRIOR" \
    "${opponent_discard_args[@]}" \
    --six-start "$start" \
    --six-count "$ROOTS_PER_WORKER" \
    --opponent-keeps-per-role "$OPPONENT_KEEPS_PER_ROLE" \
    "${selector_args[@]}" \
    > "$shard/build.log" 2>&1 &
  pids+=("$!")
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done
if [[ "$failed" -ne 0 ]]; then
  echo "one or more Model 13.22 calibration shards failed" >&2
  exit 1
fi
finished=$(date +%s)
printf '%s\n' "$((finished - started))" > "$OUT_DIR/wall-seconds.txt"
