#!/usr/bin/env bash
set -euo pipefail

RUNTIME_ROOT="${MODEL132_RUNTIME_ROOT:?MODEL132_RUNTIME_ROOT is required}"
MODE="${MODEL132_BUILD_MODE:?MODEL132_BUILD_MODE is required}"
OUT_DIR="${MODEL132_OUT_DIR:?MODEL132_OUT_DIR is required}"
SAMPLES="${MODEL132_SAMPLES:-18}"
SEED="${MODEL132_SEED:-0x13200001}"
STATUS_EVERY="${MODEL132_STATUS_EVERY:-1}"
KEEP_START="${MODEL132_KEEP_START:-}"
KEEP_COUNT="${MODEL132_KEEP_COUNT:-}"
BUILDER="${RUNTIME_ROOT}/bin/build_model132_histograms"
BELIEFS="${RUNTIME_ROOT}/rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin"
KEEP_PRIOR="${MODEL132_KEEP_PRIOR:?MODEL132_KEEP_PRIOR is required}"

if [[ ! -x "$BUILDER" ]]; then
  echo "missing executable Model 13.2 builder: $BUILDER" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
args=(
  --mode "$MODE"
  --output "$OUT_DIR"
  --beliefs "$BELIEFS"
  --keep-prior "$KEEP_PRIOR"
  --samples "$SAMPLES"
  --seed "$SEED"
  --status-every "$STATUS_EVERY"
)
if [[ -f "$OUT_DIR/checkpoint.json" ]]; then
  args+=(--resume)
fi
if [[ -n "$KEEP_START" ]]; then
  args+=(--keep-start "$KEEP_START")
fi
if [[ -n "$KEEP_COUNT" ]]; then
  args+=(--keep-count "$KEEP_COUNT")
fi

exec "$BUILDER" "${args[@]}"
