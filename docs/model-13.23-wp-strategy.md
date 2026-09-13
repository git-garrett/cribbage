# Model 13.23 playing-strategy correction

Status: correction-only distribution rebuild and WP runtime implementation in progress.

## Required board evaluator

Model 13.23 must use the verified BWM2 board-position asset used by Model
13.215: `rust/cribbage-shadow-engine/assets/board-win-matrix.bin`, SHA-256
`099715bc3aed5b296c39fb3edfd8fa30e0dad13239dede1c8963e344dfe8d679`.
It must use the Model 13.215 ordered current-hand evaluation, including heels,
pegging, pone hand, dealer hand, and crib. Live pegging must retain the exact
known own hand and legally conditioned opponent-hand and crib forecasts before
consulting the applicable board seam. Missing or invalid board data must fail
closed; there must be no fallback to Model 13.0's heuristic board model.

## Audit of the frozen 13.22 implementation

The audited runtime is commit `157c4ba2c7922a62411b8c47281787d3a246d6de`.
The correction builder is
`rust/cribbage-policy-trainer/src/bin/build_model1322_corrections.rs`.

1. The builder instantiates `Model911Policy` for both the sparse pass and the
   direct-replay verifier. Each actor receives a `Model132Observation` containing
   only legally available information. Go and scoring-decline evidence updates
   opponent-hand likelihoods. Sparse replay agreement verifies consistency with
   that policy, not playing strength or a WP objective.
2. `Model911Policy` adapts that observation into `Model91Observation`, which has
   no board-score fields. `Model91Policy::best_rank_for_hands` maximizes net
   pegging points. Its `average_future` combines future legal branches by their
   multiplicities; it does not choose future actions by board win probability.
3. The outer builder rollout does repeatedly invoke this legal-information
   chooser for both players. It does not use the hidden opponent hand to select
   the actor's move. This addresses the hidden-information problem while
   retaining the points-based strategy.
4. Each `M1322C01` row retains only own weighted points, opponent weighted
   points, and total weight. The accumulator merges away terminal score
   distributions and their cut conditioning. Pone opening-lead masks also have
   no board-score dimension. The retained shard accumulators have the same
   limitation; merging them differently cannot recover the lost distribution.
5. Runtime 13.22 selects discards by hand EV plus/minus Schell crib EV plus net
   pegging EV. Opening pone leads use the masks; later moves call
   `recommend_peg_model911`. It returns no WP forecasts. Thus the builder and
   runtime share the points-based strategy, but neither preserves the intended
   Model 13.x WP objective.

## Why the asset cannot simply be relabeled

With the actual 13.215 matrix at the after-pegging seam, consider a board of
dealer 100, pone 111. Two equally weighted outcome distributions both have
mean pegging increments `(2, 2)`:

- `(0, 0)` or `(4, 4)` gives dealer WP `0.17044501324344652`.
- `(0, 4)` or `(4, 0)` gives dealer WP `0.21785388603677494`.

The difference is 4.7409 percentage points despite identical means. This is a
counterexample about representation, not an estimate of the benchmark loss.
It was reproduced by `/private/tmp/audit-model1322-wp-contract.py`, which checks
the BWM2 header and exact asset checksum before calculating the probabilities.

## Implementation decision

The offline legal-information, net-points policy is retained unchanged. Board
position is deliberately not a builder input. Repeat only the correction pass,
reusing the completed Model 9.11 keep-pair baseline, empirical beliefs, keep
priors, opponent discard histograms, and scoring-decline factors. Preserve exact
joint own/opponent terminal pegging distributions for every six-card/discard
candidate and role, including their integer weights. Means are retained as
integrity checks, not as substitutes for distributions.

At game time, evaluate alternatives with the actual board scores and the
verified Model 13.215 board matrix. Live pegging forecasts must execute the same
legal-information continuation policy, never optimize separately against each
hidden opponent hand. Live root selection uses WP; the offline continuation
policy uses points. These different objectives are intentional. No fixed-board
or WP-aware offline rebuild is required.

The full new distribution's weight and both first moments must exactly match
every retained 13.22 row. This uses the faulty build as an independent checksum
of the regenerated outcomes; it does not reconstruct distributions from means.

## Required verification

- Same legal observation and objective produce the same builder/runtime action.
- Changing actor-invisible cards cannot change the actor's chosen action.
- WP, not net points, determines contested choices, including endgame fixtures.
- Board evaluation matches Model 13.215 for the same ordered outcome inputs.
- Probability calculation integrates joint outcomes, not just their means.
- No persistent observation-to-action table or exhaustive pegging-path graph.
- Existing 13.22 and 13.215 behavior remains frozen for controlled comparisons.

The old 13.22 asset, baseline, and Model 13.215 remain unchanged.

## Correction build execution

The correction builder supports opt-in `--joint-distributions`; its default
13.22 format and points policy remain unchanged. `M1323C01` retains the old
128-byte header and fixed moment/mask prefix, then appends one sorted sparse
joint histogram per dealer row followed by each pone row. Each histogram has a
u32 bin count followed by `(u16 score pair, u128 weight)` bins. The score-pair
high byte is own points and the low byte is opponent points. Every read and
merge validates the histogram's exact weight and both first moments.

Frozen builder revision: `920ab3c`. Runtime and inputs:
`/private/tmp/cribbage-model1323-correction-20260913-v2/runtime`.
`scripts/model1323-correction.py` provides freeze, smoke, core probe, full shard
run, and independent verification. Existing output is bound to the frozen
runtime manifest and exact shard ranges. JSON-only zero-progress interruption
and binary-authoritative resume are both exercised by the smoke test.

The pilot reproduced all retained 13.22 moments/masks on a 12-pair sample and
verified restart. The representative core test selected six workers: 4/6/8/10
workers delivered 8.69/12.36/10.00/1.92 compatible pairs per second respectively.
These are microbenchmark measurements, not a full-build ETA. The policy caches
retain the established 250,000 action, 300,000 evidence-outcome, and 3,000,000
continuation-entry limits. Forty fixed contiguous dealer shards cover all
3,274,375 compatible keep pairs. No foundational asset is regenerated.

This builder change does not yet register a Model 13.23 playing engine. Runtime
WP integration and playing-strength benchmarking remain separate work; a
completed correction asset must not be reported as a completed playing engine.
