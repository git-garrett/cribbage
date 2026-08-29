#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL132_RUNTIME_ROOT:?MODEL132_RUNTIME_ROOT is required}"
REPORT_PATH="${MODEL132_REPORT_PATH:?MODEL132_REPORT_PATH is required}"
CARGO_BIN="${CARGO_BIN:-/Users/garrett/.cargo/bin/cargo}"
RUSTFMT_BIN="${RUSTFMT_BIN:-/Users/garrett/.cargo/bin/rustfmt}"

mkdir -p "$(dirname "$REPORT_PATH")" "$RUNTIME_ROOT/target"
python3 "$RUNTIME_ROOT/scripts/test_build_model132_keep_prior.py"
python3 "$RUNTIME_ROOT/scripts/test_merge_model132_pair_shards.py"
bash -n "$RUNTIME_ROOT/scripts/run-model132-parallel-exhaustive.sh"
"$RUSTFMT_BIN" --edition 2021 --check \
  "$RUNTIME_ROOT/rust/cribbage-shadow-engine/model132.rs" \
  "$RUNTIME_ROOT/rust/cribbage-policy-trainer/src/bin/build_model132_histograms.rs"
CARGO_TARGET_DIR="$RUNTIME_ROOT/target" \
  "$CARGO_BIN" test \
  --manifest-path "$RUNTIME_ROOT/rust/Cargo.toml" \
  -p cribbage-shadow-engine \
  model132
CARGO_TARGET_DIR="$RUNTIME_ROOT/target" \
  "$CARGO_BIN" test \
  --manifest-path "$RUNTIME_ROOT/rust/Cargo.toml" \
  -p cribbage-policy-trainer \
  --bin build_model132_histograms

temporary_report="${REPORT_PATH}.tmp"
printf '{\n  "status": "complete",\n  "completedAt": "%s",\n  "scope": "Model 13.2 legal-observation foundation"\n}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$temporary_report"
mv "$temporary_report" "$REPORT_PATH"
