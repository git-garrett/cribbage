#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
LOG_FILE="$(mktemp "${TMPDIR:-/tmp}/cribbage-rust-tests.XXXXXX")"
trap 'rm -f "$LOG_FILE"' EXIT

if cargo test --manifest-path "$ROOT_DIR/rust/Cargo.toml" >"$LOG_FILE" 2>&1; then
  awk '
    /^test result:/ {
      targets += 1
      for (field = 1; field <= NF; field += 1) {
        if ($field == "passed;") {
          passed += $(field - 1)
        }
      }
    }
    END {
      printf "Rust tests passed: %d tests across %d targets.\n", passed, targets
    }
  ' "$LOG_FILE"
else
  echo "Rust tests failed; full output follows:" >&2
  sed -n '1,$p' "$LOG_FILE" >&2
  exit 1
fi
