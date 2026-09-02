#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL1322_RUNTIME_ROOT:?MODEL1322_RUNTIME_ROOT is required}"
OUT_DIR="${MODEL1322_OUT_DIR:?MODEL1322_OUT_DIR is required}"
WORKERS="${MODEL1322_WORKERS:-12}"
SEED="${MODEL1322_SEED:-0x13220001}"
OPPONENT_DISCARD_MODE="${MODEL1322_OPPONENT_DISCARD_MODE:-conditional-histogram}"
BUILDER="${RUNTIME_ROOT}/bin/build_model1322_calibration"
FACTORS="${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model1322-decline-factors.json"
KEEP_PRIOR="${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model132-keep-prior.json"
DISCARD_HISTOGRAMS="${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model1322-opponent-discard-histograms.json"
CANONICAL_ROOTS=18395

if [[ ! -x "$BUILDER" ]]; then
  echo "missing Model 13.22 fast builder: $BUILDER" >&2
  exit 1
fi
if [[ "$WORKERS" -lt 1 || "$WORKERS" -gt 12 ]]; then
  echo "MODEL1322_WORKERS must be between 1 and 12" >&2
  exit 1
fi

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

mkdir -p "$OUT_DIR"
started=$(date +%s)
pids=()
for ((worker = 0; worker < WORKERS; worker += 1)); do
  start=$((worker * CANONICAL_ROOTS / WORKERS))
  end=$(((worker + 1) * CANONICAL_ROOTS / WORKERS))
  count=$((end - start))
  shard=$(printf '%s/shard-%02d' "$OUT_DIR" "$worker")
  mkdir -p "$shard"
  "$BUILDER" \
    --output "$shard" \
    --factors "$FACTORS" \
    --keep-prior "$KEEP_PRIOR" \
    "${opponent_discard_args[@]}" \
    --six-start "$start" \
    --six-count "$count" \
    --all-opponent-keeps \
    --seed "$SEED" \
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
  echo "one or more Model 13.22 fast-build shards failed" >&2
  exit 1
fi
finished=$(date +%s)
printf '%s\n' "$((finished - started))" > "$OUT_DIR/wall-seconds.txt"
