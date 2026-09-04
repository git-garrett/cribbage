#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
RUN_QUIET="$ROOT_DIR/scripts/run-quiet.sh"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cribbage-quiet-test.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

SUCCESS_OUTPUT="$("$RUN_QUIET" "Example check" /usr/bin/true)"
[[ "$SUCCESS_OUTPUT" == "Example check passed." ]]

set +e
"$RUN_QUIET" "Example check" /bin/sh -c 'echo diagnostic; exit 7' \
  >"$TEMP_DIR/failure.out" 2>"$TEMP_DIR/failure.err"
FAILURE_STATUS=$?
set -e
[[ "$FAILURE_STATUS" -eq 7 ]]
grep -Fq "Example check failed; full output follows:" "$TEMP_DIR/failure.err"
grep -Fq "diagnostic" "$TEMP_DIR/failure.err"

"$RUN_QUIET" --show-warnings "Example build" /bin/sh -c \
  'echo routine; echo warning: example; echo context; echo; echo trailing' \
  >"$TEMP_DIR/warning.out"
grep -Fq "Example build passed with warnings:" "$TEMP_DIR/warning.out"
grep -Fq "warning: example" "$TEMP_DIR/warning.out"
grep -Fq "context" "$TEMP_DIR/warning.out"
if grep -Eq "routine|trailing" "$TEMP_DIR/warning.out"; then
  echo "Warning output included unrelated successful output" >&2
  exit 1
fi

echo "Quiet command wrapper passed."
