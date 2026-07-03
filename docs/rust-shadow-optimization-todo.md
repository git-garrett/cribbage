# Rust Shadow Optimization Todo

## Goal

Improve the Rust shadow engine in two tracks:

- Keep `schell_table-peg_table-14.8.1` exact-parity behavior intact.
- Add non-parity strength experiments under a distinct Rust model so they do not corrupt 14.8.1 parity checks.

## Safe, Parity-Preserving Improvements

- [x] Cache `RuntimeTables` once per Rust process in `rust/cribbage-shadow-engine/model.rs`.
- [x] Replace process-per-request shadow execution in `server/rust-shadow.ts` with a persistent Rust worker.
- [x] Replace hot string memo keys with typed keys in `rust/cribbage-shadow-engine/model.rs`.
- [x] Replace linear outcome dedupe in `rust/cribbage-shadow-engine/model.rs` with indexed insertion-order maps.
- [x] Remove unnecessary clones and repeated `contains` scans in `rust/cribbage-shadow-engine/model.rs`.

## Non-Parity Strength Experiments

- [x] Add a distinct Rust model identity for strength experiments, leaving 14.8.1 exact-parity unchanged.
- [x] Remove the `pegLead` auto-play shortcut for the strength model and always run live WP pegging for first pone lead.
- [x] Stop using the pre-90 heuristic for the strength model and use recursive win probability from the beginning.
- [x] Stop score rounding that costs gameplay strength for the strength model, where feasible without exploding state size.

Notes:

- Strength experiments use `schell_table-peg_table-14.8.2-rust`.
- 14.8.1 still uses the original first-pone-lead `pegLead` shortcut and pre-90 heuristic.
- Current discard and pegging score outcomes are integer buckets by the time they call board WP, so the remaining board-state clamp is integer-state clamping rather than fractional outcome rounding.

## QA

- [x] Node typecheck/build.
- [x] Rust compile on host.
- [x] Rust self-tests on host.
- [x] Node-vs-Rust parity fixtures for 14.8.1.
- [x] Strength-model smoke fixtures showing non-parity behavior is isolated from 14.8.1.

QA Results:

- `npm run typecheck` passed.
- `npm run build:server` passed.
- `npm run package:server` passed and confirmed protected model assets are included.
- Temporary host Rust compile passed under `/tmp/cribbage-rust-opt-qa`.
- Worker-mode Rust self-tests passed: `self-test`, `pairwise-self-test`, `empirical-self-test`, `model13-hold-self-test`.
- Persistent-worker parity matched all 6 fixtures: 3 discard and 3 pegging fixtures for `schell_table-peg_table-14.8.1`.
- Strength smoke accepted `schell_table-peg_table-14.8.2-rust` and exercised the live pegging path without changing 14.8.1 parity behavior.
