#!/usr/bin/env bash
set -euo pipefail

runtime_root="${MODEL1322_CORRECTION_RUNTIME_ROOT:?MODEL1322_CORRECTION_RUNTIME_ROOT is required}"
output_root="${MODEL1322_CORRECTION_OUTPUT_ROOT:?MODEL1322_CORRECTION_OUTPUT_ROOT is required}"
workers="${MODEL1322_CORRECTION_WORKERS:-10}"
action_cache="${MODEL1322_CORRECTION_ACTION_CACHE_LIMIT:-250000}"
evidence_cache="${MODEL1322_CORRECTION_EVIDENCE_CACHE_LIMIT:-300000}"
future_cache="${MODEL1322_CORRECTION_FUTURE_CACHE_LIMIT:-3000000}"
builder="${MODEL1322_CORRECTION_BUILDER:-${runtime_root}/bin/build_model1322_corrections}"
beliefs="${MODEL1322_CORRECTION_BELIEFS:-${runtime_root}/assets/model91-pegging-beliefs.bin}"
factors="${MODEL1322_CORRECTION_FACTORS:-${runtime_root}/assets/model1322-decline-factors.json}"
keep_prior="${MODEL1322_CORRECTION_KEEP_PRIOR:-${runtime_root}/assets/model132-keep-prior.json}"
discard_histograms="${MODEL1322_CORRECTION_DISCARD_HISTOGRAMS:-${runtime_root}/assets/model1322-opponent-discard-histograms.json}"
baseline_pairs="${MODEL1322_CORRECTION_BASELINE_PAIRS:-${runtime_root}/assets/model911-pair-outcomes.bin}"
keeps=1820

if [[ ! -x "$builder" ]]; then
  echo "missing Model 13.22 correction builder: $builder" >&2
  exit 1
fi
if [[ "$workers" -lt 1 || "$workers" -gt 10 ]]; then
  echo "MODEL1322_CORRECTION_WORKERS must be between 1 and 10" >&2
  exit 1
fi
for asset in "$beliefs" "$factors" "$keep_prior" "$discard_histograms" "$baseline_pairs"; do
  if [[ ! -f "$asset" ]]; then
    echo "missing frozen Model 13.22 correction input: $asset" >&2
    exit 1
  fi
done

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
    --keep-prior "$keep_prior"
    --discard-histograms "$discard_histograms"
    --baseline-pairs "$baseline_pairs"
    --dealer-start "$dealer_start"
    --dealer-count "$dealer_count"
    --pone-start 0
    --pone-count "$keeps"
    --action-cache-limit "$action_cache"
    --evidence-cache-outcome-limit "$evidence_cache"
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
  echo "one or more Model 13.22 correction shards failed" >&2
  exit 1
fi

/usr/bin/python3 "$runtime_root/scripts/summarize-model1322-corrections.py" \
  --shards "$output_root" --output "$output_root/status.json" --workers "$workers" \
  --require-complete
