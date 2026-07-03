# Rust AI-vs-AI Runner Port Checklist

## Goal

Port AI-vs-AI simulation work from the current Node/TypeScript runner to Rust so long benchmark runs, model calibration, and future model development can run from one Rust engine path.

Initial target:

- Preserve existing compact game DB outputs closely enough that `scripts/analyze-ai-run.cjs` and leaderboard/import tooling continue to work.
- Support `schell_table-peg_table-13.0`, `schell_table-peg_table-14.8.1`, and Rust model `schell_table-peg_table-15.0`.
- Keep Node runner available until Rust runner parity and storage are proven.

## Current State

- [x] Local Rust toolchain installed and working.
- [x] Rust shadow sidecar compiles locally with `rust/cribbage-shadow-engine/build.sh`.
- [x] Rust 14.8.1 sidecar parity fixtures pass against Node for discard and pegging decisions.
- [x] Rust-only strength model is numbered `schell_table-peg_table-15.0`.
- [x] Rust shadow engine is organized as a Cargo workspace/member crate while preserving the existing `rustc` build path.
- [ ] Rust has decision logic but not full game lifecycle/scoring orchestration.
- [ ] Rust has no compact SQLite writer yet.
- [ ] Rust has no AI-vs-AI multi-worker runner yet.

## Phase 1: Crate And Module Structure

- [x] Create a Cargo workspace with the current shadow-engine crate.
- [x] Expose reusable sidecar code as library modules: `cards`, `artifacts`, `board`, `model`, `sidecar`.
- [x] Keep the current shadow binary as a thin wrapper over the library-compatible modules.
- [x] Add `cargo test` while preserving the existing `rustc` build path used by deploy scripts.
- [x] Add release profile settings appropriate for long-running benchmarks.
- [x] Decide dependency policy: keep the current crate dependency-free for parity/build safety; add small, stable crates only when needed by the runner (`rusqlite`, `serde_json`, CLI parsing, and worker concurrency are the likely first additions).

## Phase 2: Game State And Rules Port

- [ ] Port full `CribbageGame` state model from `web/src/engine.ts`.
- [ ] Port cut-for-deal, deal, discard, pegging, scoring, next-hand, and game-over transitions.
- [x] Port deterministic seeding/shuffling so Rust can reproduce Node fixtures where required.
- [ ] Port card serialization and snapshot-compatible state encoding.
- [ ] Add golden tests for scoring hands, crib scoring, pegging scoring, go/31/reset behavior, and game-over edge cases.
- [x] Add full-game smoke tests against fixed seeds.

Progress:

- [x] Added `game` module with deterministic shuffle/deal, discard-to-pegging transition, core pegging play/go/reset/last-card behavior, and hand/crib scoring transition.
- [x] Added Cargo tests for TypeScript-compatible LCG shuffle/deal order, discard transition, 31 reset, and last-card pegging.
- [x] Added fixed-seed naive-policy full-game smoke that reaches `GameOver`.
- [ ] Add cut-for-deal support.
- [ ] Add model-driven autoplay over the Rust decision API.
- [ ] Add compact analytics/event capture needed by the DB writer.
- [x] Added `playout` module that can drive full games through the existing Rust decision API for native Rust models only: 14.8, 14.8.1, and 15.0.
- [ ] Add artifact-backed smoke/parity tests for native model playout.
- [ ] Extend playout to 13.0 once the 13.0 Rust decision path is available.

## Phase 3: Model Dispatch

- [x] Define a Rust `ModelId` enum/string mapping for 13.0, 14.8.1, and 15.0.
- [ ] Implement 13.0 discard/pegging behavior or bind to existing Rust components where already ported.
- [ ] Keep 14.8.1 exact parity mode separate from 15.0 strength mode.
- [x] Add model-resource loading cache per process.
- [ ] Add model fixture tests: 13.0, 14.8.1, and 15.0 discard decisions.
- [ ] Add model fixture tests: 13.0, 14.8.1, and 15.0 pegging decisions.

Progress:

- [x] Added `model_id` module with typed IDs and labels for 13.0, 14.8, 14.8.1, and 15.0.
- [x] Marked native Rust decision support explicitly: 14.8, 14.8.1, and 15.0 supported; 13.0 parsed but still pending.
- [x] Confirmed existing `RuntimeTables` cache is process-global via `OnceLock`.
- [x] 14.8.1 parity mode and 15.0 strength mode remain separated in `model.rs`.
- [ ] Port or bind 13.0 discard behavior, which still uses the legacy Schell discard table rather than the empirical 14.8 discard path.

## Phase 4: Compact Game Storage

- [ ] Reproduce `benchmarks/ai-db/cribbage-games.sqlite` schema writes from Rust.
- [ ] Port compact rows for games, hands, discards, peg plays, and run metadata.
- [ ] Preserve decision EV fields used by `scripts/analyze-ai-run.cjs`.
- [ ] Preserve selected win-probability fields for discard and pegging decisions.
- [ ] Preserve score component fields and final-hand exclusion semantics.
- [ ] Add DB fixture tests comparing Rust-written rows to Node-written rows for a small fixed run.

## Phase 5: Runner CLI

- [ ] Add Rust runner command equivalent to `scripts/smoke-four-model-ai.cjs <outDir> <games> <workers> <oldMb> <batchGames>`.
- [ ] Support explicit model pair selection.
- [ ] Support run ID, output directory, seed, total games, worker count, batch size, and DB path flags.
- [ ] Write `status.json` with current fields used by `scripts/report-background-status.cjs`.
- [ ] Write batch files or a deliberate replacement artifact shape.
- [ ] Stream active games into DB so interrupted runs retain completed games.
- [ ] Support graceful stop/resume from existing status/DB state.

## Phase 6: Concurrency And Performance

- [ ] Benchmark single-thread Rust full-game simulation.
- [ ] Implement worker pool with deterministic seed partitioning.
- [ ] Measure optimal worker count on local hardware.
- [ ] Measure optimal worker count on production/server hardware.
- [ ] Add bounded memory/resource cache sizing.
- [ ] Profile discard path, pegging path, DB writes, and serialization separately.
- [ ] Compare Rust runner throughput against Node runner on identical model pairs.

## Phase 7: Analysis Compatibility

- [ ] Run `scripts/analyze-ai-run.cjs` unchanged against a Rust-generated smoke run.
- [ ] Run `scripts/report-background-status.cjs` unchanged against a Rust-generated active run.
- [ ] Verify EV tables, WP calibration, bucket tables, score components, and confidence rows are populated.
- [ ] Verify aggregate analysis across Node and Rust runs behaves correctly.
- [ ] Fix analyzer assumptions only when the Rust output is intentionally equivalent.

## Phase 8: Cutover Plan

- [ ] Run 100-game Rust vs Node parity smoke for 13.0 vs 14.8.1.
- [ ] Run 1k Rust runner benchmark for 15.0 vs 13.0.
- [ ] Compare win rates and score components to Node expectations for sanity.
- [ ] Stop current Node background runner only after Rust runner can persist and resume correctly.
- [ ] Start first official Rust background run: `15.0-vs-13.0-10k`.
- [ ] Keep Node runner scripts available as fallback until at least one Rust run completes.

## Open Questions

- [ ] Should the Rust runner preserve JSON batch artifacts, or should SQLite become the sole source of truth?
- [ ] Should Rust write the exact current compact schema, or should we version a new schema and adapt analysis scripts?
- [ ] Should `15.0` remove all parity constraints immediately, or should it have a `15.0-parity` mode for regression testing?
- [ ] Should production server use the same Rust crate directly, or continue to use sidecar/worker protocol until the web server is ported?
