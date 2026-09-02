#!/usr/bin/env bash
set -euo pipefail

job_spec="/private/tmp/cribbage-jobs/model911-baseline-20260901-v2/job.json"
queue="/Volumes/TerraMasterWDBlue/Dev/cribbage/scripts/cribbage_job_queue.py"
output_root="/private/tmp/cribbage-model911-build-output-20260901-v2/pair-shards"
case "${1:-status}" in
  status)
    /usr/bin/python3 "$queue" status "$job_spec"
    shopt -s nullglob
    status_files=("$output_root"/shard-*/status.json)
    if (( ${#status_files[@]} > 0 )); then
      /usr/bin/jq -s '
        {
          shards: length,
          completeShards: (map(select(.status == "complete")) | length),
          checkpointedDealerRows: (map(.completedDealerKeeps // 0) | add),
          totalDealerRows: (map(.dealerCount // 0) | add),
          validPairs: (map(.validPairs // 0) | add),
          aggregatePairsPerSecond: (map(.pairsPerSecond // 0) | add),
          etaSeconds: (
            map(select((.completedDealerKeeps // 0) > 0) | .etaSeconds)
            | if length > 0 then max else null end
          )
        }
      ' "${status_files[@]}"
    fi
    ;;
  pause|stop)
    /usr/bin/python3 "$queue" stop "$job_spec"
    ;;
  resume|start)
    /usr/bin/python3 "$queue" install "$job_spec"
    ;;
  *)
    echo "usage: $0 [status|pause|resume]" >&2
    exit 2
    ;;
esac
