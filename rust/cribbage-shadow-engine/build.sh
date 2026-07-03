#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
rustc -O "$SCRIPT_DIR/main.rs" -o "$SCRIPT_DIR/cribbage-shadow-engine"
