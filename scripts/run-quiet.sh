#!/usr/bin/env bash
set -euo pipefail

SHOW_WARNINGS=false
if [[ "${1:-}" == "--show-warnings" ]]; then
  SHOW_WARNINGS=true
  shift
fi

if [[ "$#" -lt 2 ]]; then
  echo "Usage: $0 [--show-warnings] LABEL COMMAND [ARG ...]" >&2
  exit 2
fi

LABEL="$1"
shift
LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/cribbage-quiet-command.XXXXXX")"
trap 'rm -f "$LOG_FILE"' EXIT

set +e
"$@" >"$LOG_FILE" 2>&1
STATUS=$?
set -e

if [[ "$STATUS" -ne 0 ]]; then
  echo "${LABEL} failed; full output follows:" >&2
  sed -n '1,$p' "$LOG_FILE" >&2
  exit "$STATUS"
fi

if [[ "$SHOW_WARNINGS" == true ]] && grep -Eiq '(^|[^[:alpha:]])(warning|warn|deprecated)([^[:alpha:]]|$)|^\(!\)' "$LOG_FILE"; then
  echo "${LABEL} passed with warnings:"
  awk '
    {
      lowered = tolower($0)
      starts_warning = lowered ~ /(^|[^[:alpha:]])(warning|warn|deprecated)([^[:alpha:]]|$)/ || $0 ~ /^\(!\)/
      if (starts_warning) {
        showing = 1
      }
      if (showing) {
        print
        if ($0 == "") {
          showing = 0
        }
      }
    }
  ' "$LOG_FILE"
else
  echo "${LABEL} passed."
fi
