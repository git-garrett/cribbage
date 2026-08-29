#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL132_RUNTIME_ROOT:?MODEL132_RUNTIME_ROOT is required}"
OUT_DIR="${MODEL132_OUT_DIR:?MODEL132_OUT_DIR is required}"
KEEP_PRIOR="${MODEL132_KEEP_PRIOR:?MODEL132_KEEP_PRIOR is required}"
WORKERS="${MODEL132_WORKERS:-10}"
SEED="${MODEL132_SEED:-0x13200002}"
STATUS_EVERY="${MODEL132_STATUS_EVERY:-10}"
BUILDER="${RUNTIME_ROOT}/bin/build_model132_histograms"
BELIEFS="${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin"
MERGER="${RUNTIME_ROOT}/scripts/merge_model132_pair_shards.py"
KEEP_COUNT=1820

if [[ ! -x "$BUILDER" ]]; then
  echo "missing executable Model 13.2 builder: $BUILDER" >&2
  exit 1
fi
if [[ ! -f "$MERGER" ]]; then
  echo "missing Model 13.2 shard merger: $MERGER" >&2
  exit 1
fi
if [[ "$WORKERS" -lt 1 || "$WORKERS" -gt "$KEEP_COUNT" ]]; then
  echo "MODEL132_WORKERS must be between 1 and $KEEP_COUNT" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
base=$((KEEP_COUNT / WORKERS))
remainder=$((KEEP_COUNT % WORKERS))
start=0
pids=()
shard_assets=()

for ((worker = 0; worker < WORKERS; worker += 1)); do
  count=$base
  if ((worker < remainder)); then
    count=$((count + 1))
  fi
  shard_dir=$(printf '%s/shard-%02d' "$OUT_DIR" "$worker")
  mkdir -p "$shard_dir"
  args=(
    --mode exhaustive
    --output "$shard_dir"
    --beliefs "$BELIEFS"
    --keep-prior "$KEEP_PRIOR"
    --samples 1
    --seed "$SEED"
    --keep-start "$start"
    --keep-count "$count"
    --status-every "$STATUS_EVERY"
  )
  if [[ -f "$shard_dir/checkpoint.json" ]]; then
    args+=(--resume)
  fi
  "$BUILDER" "${args[@]}" > "$shard_dir/build.log" 2>&1 &
  pids+=("$!")
  shard_assets+=("$shard_dir/model132-keep-pairs.bin")
  start=$((start + count))
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done
if [[ "$failed" -ne 0 ]]; then
  echo "At least one Model 13.2 exhaustive shard failed; rerun to resume." >&2
  exit 1
fi

merge_args=(--output "$OUT_DIR" --expected-keep-count "$KEEP_COUNT")
for asset in "${shard_assets[@]}"; do
  merge_args+=(--shard "$asset")
done
python3 "$MERGER" "${merge_args[@]}"
