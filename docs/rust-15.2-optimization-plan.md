# Rust Model 15.2 Optimization Plan

Goal: release `schell_table-peg_table-15.2` as a gameplay-preserving speed cleanup of 15.1, then run a timed 10k `15.0` vs `15.2` Rust AI-vs-AI benchmark.

15.2 should preserve the conceptual 15.1 improvement that aggregate future pegging treats simultaneous terminal pegging as indeterminate, but avoid paying that cost when simultaneous pegging terminal ambiguity is impossible.

## Ground Rules

- Keep 15.0 and 15.1 behavior available for comparison.
- Do not change discard/crib/empirical model logic except for model-id routing to 15.2.
- Prefer exact, gameplay-preserving optimizations.
- Skip broad pegging-simulation memo sharing for this release.
- Add tests around every board-evaluator rewrite because off-by-one score-state errors are easy.
- Restart long-running benchmarks only after QA passes.

## Checklist

### 1. Exact Joint-Pegging Gate

- [x] Add `BoardModel` logic to use joint pone/dealer pegging only when both players can potentially cross 121 inside the same aggregate pegging phase.
- [x] If both players cannot go out in the aggregate pegging block, bypass joint/cycle logic and use normal sequential phase evaluation.
- [x] Retire broad 99.9th-percentile cycle fast path for 15.2.
- [x] Keep tests proving:
  - [x] double-out future pegging returns `0.5`;
  - [x] single-side future pegging terminal outcomes are awarded correctly;
  - [x] non-ambiguous single-side pegging terminals bypass joint ambiguity.

Status: implemented in `BoardModel::exact_joint_pegging_without_early_heuristic`; not routed to a public model until the 15.2 wiring step.

Files:
- `rust/cribbage-shadow-engine/board.rs`
- `rust/cribbage-shadow-engine/model.rs`

### 2. Static Board Distributions

- [x] Move deterministic phase score distributions out of per-`BoardModel` state.
- [x] Replace `HashMap<ScorePhase, Vec<(u8, f64)>>` lookups/clones with static/precomputed slices.
- [x] Remove distribution cloning from recursive board evaluation.
- [x] Keep `BoardModel` focused on mutable memo/state.

Status: standard phase distributions and cycle delta distributions are precomputed once per process through `BoardDistributions`. Recursive board evaluation now borrows static slices.

Files:
- `rust/cribbage-shadow-engine/board.rs`

### 3. Indexed Board Memo

- [x] Replace `HashMap<(u8, u8, Role, ScorePhase), f64>` with indexed memo storage.
- [x] Use fixed score bounds `0..=121`, 2 roles, 5 phases.
- [x] Use sentinel state or explicit visitation state so recursive cycles still break safely.
- [x] Add tests for representative score/role/phase positions to catch index mistakes.

Status: `BoardMemo` uses a fixed `Vec<f64>` with `NaN` for empty and `0.5` for recursive in-progress states, matching the previous sentinel behavior.

Files:
- `rust/cribbage-shadow-engine/board.rs`

### 4. Remove Unused Known-Card BoardModel Construction

- [x] Stop constructing the outer `PeggingWinEvaluator.board` for known-card strength-model pegging.
- [x] Move board ownership into the historic mode variant or make the outer board optional.
- [x] Confirm 15.1/15.2 pegging decisions still use the `PostPeggingWinContext.board`.

Status: `PeggingWinMode::HistoricPhase` now owns the outer board. Known-card pegging constructs only the `PostPeggingWinContext.board`.

Files:
- `rust/cribbage-shadow-engine/model.rs`

### 5. Skip Broader Optimal-Pegging Memo Sharing

- [x] Intentionally skip this for 15.2.
- Rationale: likely useful, but hidden-context mistakes could affect decisions. Revisit after 15.2 run if pegging remains too slow.

### 6. Pack Pegging Simulation Keys

- [x] Replace heap-backed `plays: Vec<u8>` in pegging simulation keys with compact fixed storage.
- [x] Pack or simplify small key fields where safe.
- [x] Avoid changing pegging simulation semantics.
- [x] Add parity/smoke tests covering pegging decisions with non-empty play prefixes, go/reset states, and near-terminal scores.

Status: pegging memo keys now pack hand rank counts and played-rank prefixes into fixed `u64` fields. Simulation state is unchanged; only memo-key representation changed. Unit tests cover count packing, order-sensitive play packing, and distinct pegging-state keys.

Files:
- `rust/cribbage-shadow-engine/model.rs`

### 7. Lazy-Load Model-Specific Artifacts

- [x] Split eager `RuntimeTables` loading into model-specific `OnceLock`s.
- [x] Load 15.x tables without loading unused 13/14 crib/peg artifacts.
- [x] Keep 13.0 and 14.3 Rust support working for production fallback/history.
- [x] Confirm server package still includes required assets.

Status: `RuntimeTables` now stores the repo root and per-artifact `OnceLock`s. Each model path requests only the artifacts it needs; existing package assets remain unchanged.

Files:
- `rust/cribbage-shadow-engine/model.rs`
- `rust/cribbage-shadow-engine/artifacts.rs` if needed
- `scripts/deploy-nanode.sh` if model lists/assets change
- `package.json` package command if bundled assets change

### 8. Add Model 15.2

- [x] Add Rust model id `schell_table-peg_table-15.2`.
- [x] Route 15.2 to the optimized 15.1 board evaluator.
- [x] Add web/server model constants and metadata.
- [x] Add `web/src/models/schell_table-peg_table-15.2/model.md`.
- [x] Decide whether production public model remains 15.1 until benchmark results, or moves to 15.2 after QA.

Status: 15.2 is wired as a distinct Rust-supported model. Production public
selection remains on the existing 15.1 alias until benchmark results justify a
cutover.

Files:
- `rust/cribbage-shadow-engine/model_id.rs`
- `rust/cribbage-shadow-engine/model.rs`
- `server/ai-constants.ts`
- `server/ai-server.ts`
- `server/rust-shadow.ts`
- `web/src/engine.ts`
- `web/src/main.ts`
- `web/src/models/model-info.ts`
- `web/src/models/schell_table-peg_table-15.2/model.md`
- `scripts/deploy-nanode.sh`

### 9. QA

- [x] `cargo fmt`
- [x] `cargo test`
- [x] `cargo build --release`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run build:server`
- [x] Rust one-game smoke: `15.0` vs `15.2`.
- [x] Analyzer confirms timing columns still work.
- [x] If feasible, compare selected 15.1 vs 15.2 board fixture outputs where simultaneous pegging is relevant.

Status: broad QA passed. A one-game smoke completed, and a two-game
DB-backed smoke analyzed successfully with decision timing, EV calibration, WP
calibration, and available-event scoring rows.

### 10. Benchmark Run

- [x] Stop the current `rust-15.0-vs-15.1-10k-timing-20260706` run after recording status/results.
- [x] Start a new timed 10k run:
  - left: `schell_table-peg_table-15.0`
  - right: `schell_table-peg_table-15.2`
  - workers: start with current known-good `8` unless quick worker test says otherwise
  - per-decision timing enabled by current runner schema
- [x] Report run id, pid, DB path, status path, early timing, and early strength metrics.

Status: stopped the 15.0-vs-15.1 timing run at 1002 saved games and marked it
`stopped`. Started `rust-15.0-vs-15.2-10k-timing-20260706` as PID `38377`.
At the first analyzer check it had 23 games saved at 0.204 games/sec.

## Open Follow-Ups After 15.2

- Broader optimal-pegging memo sharing.
- More aggressive packed state keys if 15.2 pegging is still slow.
- Optional model-specific production lazy-load hardening if startup/memory still matters.
