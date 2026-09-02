#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: $0 OUTPUT WORKERS ACTION_CACHE EVIDENCE_CACHE FUTURE_CACHE" >&2
  exit 2
fi

output="$1"
workers="$2"
action_cache="$3"
evidence_cache="$4"
future_cache="$5"
binary="${MODEL1322_CORRECTION_BINARY:-/Volumes/TerraMasterWDBlue/Dev/cribbage/rust/target/release/build_model1322_corrections}"
root="${MODEL1322_CORRECTION_ROOT:-/Volumes/TerraMasterWDBlue/Dev/cribbage}"
prior="${MODEL1322_KEEP_PRIOR:-/private/tmp/model132-keep-prior-recovered-20260901/model132-keep-prior.json}"

if [[ ! "$workers" =~ ^[0-9]+$ ]] || (( workers < 1 || workers > 10 )); then
  echo "WORKERS must be between 1 and 10" >&2
  exit 2
fi

run_task() {
  local task="$1"
  local dealer_start=$((task * 182))
  local pone_start=$(((task * 173 + 37) % 1788))
  "$binary" build \
    --output "$output/task-$task" \
    --beliefs "$root/rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin" \
    --factors "$root/rust/cribbage-shadow-engine/assets/model1322-decline-factors.json" \
    --keep-prior "$prior" \
    --discard-histograms "$root/rust/cribbage-shadow-engine/assets/model1322-opponent-discard-histograms.json" \
    --baseline-pairs "$root/benchmarks/model911/full-20260901-v2/merged-pairs/pair-outcomes.bin" \
    --dealer-start "$dealer_start" --dealer-count 1 \
    --pone-start "$pone_start" --pone-count 32 \
    --action-cache-limit "$action_cache" \
    --evidence-cache-outcome-limit "$evidence_cache" \
    --future-cache-limit "$future_cache"
}

export output binary root prior action_cache evidence_cache future_cache
export -f run_task
started=$(date +%s)
printf '%s\n' {0..9} | xargs -n 1 -P "$workers" /bin/bash -c 'run_task "$1"' _
finished=$(date +%s)
echo "wallSeconds=$((finished - started)) workers=$workers actionCache=$action_cache evidenceCache=$evidence_cache futureCache=$future_cache"
