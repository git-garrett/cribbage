# Rust Model 15.3 Empirical Board Model Plan

## Goal

Build `schell_table-peg_table-15.3` after the current 30k `15.0` vs `15.2`
run finishes. The model should replace the current normal-approximation future
board phase distributions with empirical distributions derived from compact
Rust runner games that include available-event scoring.

The primary objective is better win-probability calibration and late-game play.
Any speed gain is secondary, but compact empirical cycle transitions may also
reduce future board recursion work in nonterminal positions.

## Source Data

Use only compact games with populated available-event fields:

- `left_available_pegging_points`
- `right_available_pegging_points`
- `left_available_hand_points`
- `right_available_hand_points`
- `available_crib_points`

Initial source set after the 30k run completes:

- central aggregate DB: `benchmarks/ai-db/cribbage-games.sqlite`
- current run DB:
  `benchmarks/ai-db/rust-15.0-vs-15.2-10k-timing-20260706.sqlite`
- prior available-event Rust runs, if not duplicated in the central DB

Exclude worker-probe games from the release artifact unless they are explicitly
needed for QA fixtures.

## Modeling Rules

Do not treat unreached phases as zero-point observations.

When a game ends in pegging, pone hand, dealer hand, or crib, later phases in
that same hand are not observed. They may be represented as "not reached" in
terminal-aware transition rows, but they must not be included as zeroes in
phase-score histograms.

Use available-event scoring for the scoring event that ends the game. This
keeps the full scoring value of the winning event instead of trimming it to
exactly 121, while still excluding later hypothetical events.

## Artifact Design

### 1. Empirical Reached-Phase Histograms

Build score histograms for phases actually reached:

- pone pegging
- dealer pegging
- pone hand
- dealer hand
- crib

Recommended conditioning keys:

- perspective role / dealer side
- broad score band
- optional holes-to-go band

Initial score bands:

- `<60`
- `60-89`
- `90-109`
- `110+`

Each histogram stores integer score buckets with integer counts. Runtime
normalizes counts to weights.

### 2. Empirical Cycle-Delta Distributions

For clearly nonterminal board positions, store joint cycle deltas instead of
walking independent phases:

- pone-cycle delta: pone pegging + pone hand
- dealer-cycle delta: dealer pegging + dealer hand + crib

This preserves covariance between phases. A snapshot of the current run showed
only 528 unique cycle-delta tuples for scores under 80 across roughly 98.5k
hands, so the artifact shape should be small.

Initial conditioning:

- dealer role
- score band or holes-to-go band
- only positions where a cycle cannot plausibly terminate, or where terminal
  handling is explicitly encoded

### 3. Terminal-Sensitive Ordered Phase Tables

Near 121, preserve phase order:

1. pone pegging
2. dealer pegging
3. pone hand
4. dealer hand
5. crib

This keeps `15.1+` simultaneous future pegging behavior intact. If both players
can cross 121 inside the aggregate pegging block, double-out outcomes remain
indeterminate at 50/50.

## Backoff Strategy

Avoid exact score-pair conditioning for the first version. Current data is too
sparse at exact score granularity.

Use hierarchical backoff:

1. exact key, if sample count is high enough;
2. 5-point score or holes-to-go bucket;
3. 10-point score or holes-to-go bucket;
4. broad band;
5. global phase/cycle distribution.

Recommended minimum sample thresholds:

- phase histogram key: at least 500 reached-phase samples
- cycle-delta key: at least 1,000 cycle samples
- lead-conditioned pegging key: at least 1,000 samples per lead bucket

These thresholds should be checked empirically after the 30k run finishes.

## Lead Conditioning

Add lead conditioning only after the base empirical board model is working.

Potential pegging conditioning keys:

- opening pone lead rank
- reset segment lead rank
- broad score band
- role

Use lead-conditioned distributions only when the lead is known or can be
weighted by a lead-frequency table. Do not use raw future lead conditioning at
discard time unless lead probabilities are modeled.

## Builder Work

- [ ] Freeze source DB list after the 30k run completes.
- [ ] Add a builder script for empirical board distributions.
- [ ] Count reached phases correctly and exclude unreached later phases.
- [ ] Build global reached-phase histograms.
- [ ] Build band-conditioned reached-phase histograms.
- [ ] Build nonterminal cycle-delta histograms.
- [ ] Add sample-count metadata and backoff metadata.
- [ ] Emit a compact artifact plus manifest.
- [ ] Add a validation report with sample counts, means, variances, and key
      sparsity.

## Rust Runtime Work

- [ ] Add model id `schell_table-peg_table-15.3`.
- [ ] Add artifact loader for empirical board distributions.
- [ ] Add a `BoardDistributions::empirical_15_3()` path.
- [ ] Preserve `15.2` behavior unchanged.
- [ ] Use empirical cycle deltas in nonterminal positions.
- [ ] Use ordered empirical phase distributions near terminal.
- [ ] Keep the exact joint pegging ambiguity rule from `15.2`.
- [ ] Add fallback to existing `15.2` static distributions if a key is missing.
- [ ] Add tests for backoff selection and terminal phase ordering.

## QA

- [ ] Builder determinism check: same inputs produce byte-identical artifact.
- [ ] Rust unit tests.
- [ ] Rust release build.
- [ ] One-game smoke: `15.3` vs `15.2`.
- [ ] Analyzer confirms available-event rows still work.
- [ ] Compare board probabilities for representative states:
  - early tied score
  - midgame dealer advantage
  - `90+` race states
  - `110+` pone/dealer count-first states
  - simultaneous future pegging double-out state
- [ ] Confirm runtime falls back cleanly for sparse keys.

## Benchmark Plan

After QA passes:

- [ ] Run worker-count probe if runtime shape changes materially.
- [ ] Start `15.2` vs `15.3` Rust AI-vs-AI run.
- [ ] Track:
  - win rate and confidence
  - final score and margin
  - phase means
  - available-event phase means
  - WP calibration and Brier by decision type
  - score-band WP calibration
  - per-decision timing

## Expected Risks

- Sparse conditioning can overfit or add noise.
- Full joint phase tuples are too sparse if conditioned aggressively.
- Late-game censoring can corrupt histograms if unreached phases are counted
  as zero.
- A calibration improvement may not translate to stronger head-to-head play.
- Empirical data from model-vs-model games may encode model-specific habits,
  not universal cribbage truth.

## Recommended First Release Scope

For `15.3`, keep the first implementation conservative:

- empirical reached-phase histograms;
- broad score-band or holes-to-go conditioning;
- compact nonterminal cycle-delta distributions;
- exact `15.2` terminal handling near 121;
- no lead-conditioned pegging until the base artifact is validated.
