#!/usr/bin/env bash
set -euo pipefail

runtime_root="${MODEL911_RUNTIME_ROOT:?MODEL911_RUNTIME_ROOT is required}"
output_root="${MODEL911_OUTPUT_ROOT:?MODEL911_OUTPUT_ROOT is required}"
workers="${MODEL911_WORKERS:-10}"
action_cache="${MODEL911_ACTION_CACHE_LIMIT:-100000}"
future_cache="${MODEL911_FUTURE_CACHE_LIMIT:-5000000}"
builder="${MODEL911_BUILDER:-${runtime_root}/bin/build_model911_pairs}"
beliefs="${MODEL911_BELIEFS:-${runtime_root}/assets/model91-pegging-beliefs.bin}"
factors="${MODEL911_FACTORS:-${runtime_root}/assets/model1322-decline-factors.json}"
keeps=1820

if [[ ! -x "$builder" ]]; then
  echo "missing Model 9.11 builder: $builder" >&2
  exit 1
fi
if [[ "$workers" -lt 1 || "$workers" -gt 10 ]]; then
  echo "MODEL911_WORKERS must be between 1 and 10" >&2
  exit 1
fi

mkdir -p "$output_root"
pids=()
terminate_children() {
  trap - TERM INT
  for pid in "${pids[@]:-}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  wait || true
  exit 130
}
trap terminate_children TERM INT

for ((worker = 0; worker < workers; worker += 1)); do
  dealer_start=$((worker * keeps / workers))
  dealer_end=$(((worker + 1) * keeps / workers))
  dealer_count=$((dealer_end - dealer_start))
  shard=$(printf '%s/shard-%02d' "$output_root" "$worker")
  args=(
    build
    --output "$shard"
    --beliefs "$beliefs"
    --factors "$factors"
    --dealer-start "$dealer_start"
    --dealer-count "$dealer_count"
    --pone-start 0
    --pone-count "$keeps"
    --status-every 1
    --action-cache-limit "$action_cache"
    --future-cache-limit "$future_cache"
  )
  if [[ -f "$shard/checkpoint.json" ]]; then
    args+=(--resume)
  fi
  "$builder" "${args[@]}" > "$shard.log" 2>&1 &
  pids+=("$!")
done

failed=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    failed=1
  fi
done
if [[ "$failed" -ne 0 ]]; then
  echo "one or more Model 9.11 pair shards failed" >&2
  exit 1
fi

/usr/bin/python3 "$runtime_root/scripts/summarize-model911-pairs.py" \
  --output "$output_root" --workers "$workers"
