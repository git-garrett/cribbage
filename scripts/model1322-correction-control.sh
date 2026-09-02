#!/usr/bin/env bash
set -euo pipefail

job_spec="${MODEL1322_CORRECTION_JOB_SPEC:-/private/tmp/cribbage-jobs/model1322-correction-20260901-v3/job.json}"
queue="${MODEL1322_CORRECTION_QUEUE:-/private/tmp/cribbage-model1322-correction-runtime-20260901-v3/scripts/cribbage_job_queue.py}"
action="${1:-status}"

case "$action" in
  status)
    /usr/bin/python3 "$queue" status "$job_spec"
    ;;
  pause|stop)
    /usr/bin/python3 "$queue" stop "$job_spec"
    ;;
  resume|start)
    /usr/bin/python3 "$queue" validate "$job_spec"
    /usr/bin/python3 "$queue" install "$job_spec"
    ;;
  *)
    echo "usage: $0 {status|pause|resume}" >&2
    exit 2
    ;;
esac
