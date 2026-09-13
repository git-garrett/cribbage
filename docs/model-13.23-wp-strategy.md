# Model 13.23 playing-strategy correction

Status: correction-only distribution rebuild running; experimental WP runtime
built and contract-tested. Full-asset and playing-strength tests are pending.

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

Live inputs already contain only legal information. The policy boundary above
is about future-action forecasts inside hypothetical worlds, not an additional
filter on the real player's inputs. A forecast must not choose different future
actions merely because its simulator knows different hidden cards.

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

## Playing engine

The native experimental model ID is `schell_table-peg_table-13.23`. Ace remains
13.215. No production promotion or deployment is part of this correction.

Discard selection reads `model1323-corrections.bin`. The reader rejects partial,
means-only, malformed, or mismatched-input assets and validates all joint rows
against their exact u128 moments. All stored joint bins enter the same ordered
current-hand WP evaluator as 13.215. Means are used only for diagnostic EV and a
WP tie break. Diagnostic opening-lead masks are never executed.

Live pegging evaluates each legal candidate through `model1323::PolicyAssets`.
Future choices use the unchanged builder chooser, including its empirical
beliefs, go/scoring-decline evidence, and actor-owned discards. The runtime pins
those input files to the builder's SHA-256 identities. It draws opponent keeps
from the chooser's legal posterior and conditions opponent-private discards on
the frozen discard prior, the visible six cards, and known cut. Private cards
are used for simulation; only the acting player's observation reaches a chooser.
The live candidate with highest WP wins, even when another has higher net EV.
Before any opponent play, the chooser's root posterior uses physical card
weights, whereas the builder's outer aggregation uses calibrated keep priors.
This retains the chooser's established posterior; it is not an assertion that
the live outer population and offline aggregation have identical weights.

Large populations use 512 common deterministic stratified world samples across
all candidates. Four or fewer remaining cards use the full population. This is
a sampling approximation, not exhaustive live analysis or proof of playing
strength. All continuation/action/evidence memoization is decision-local. No
persistent observation-to-action table or exhaustive path graph is introduced.

As in 13.215, the discard evaluator combines terminal pegging totals with
separately forecast hand/crib outcomes; the asset does not retain cut/outcome
correlation or within-pegging scoring order. If both discard pegging totals cross
121, 13.215's neutral ambiguity rule is retained. Live simulations do resolve
pegging points in sequence and stop at the first winner. These inherited discard
approximations are not repaired by merely retaining a joint terminal histogram.
Live WP likewise inherits 13.215's separate hold-table hand and rank-cut crib
forecasts; it does not preserve their correlation with each simulated pegging
world or replace them with the chooser's posterior.

The engine can be compiled and contract-tested before the full asset exists.
A full-asset integration test and 13.23-versus-13.215 playing-strength benchmark
must follow successful asset verification; they must not be reported as already
completed.

### Engine validation, 2026-09-13

- Release engine and native runner compile successfully; 316 Rust tests pass.
- Contract coverage includes exact u128 joint rows, rejection of partial and
  means-only assets, exact BWM identity, WP-over-net selection, builder/runtime
  continuation agreement, invisible-card invariance, count-out termination,
  sparse-prior zero-support conditioning, and full late-state enumeration.
- Standards and spec review have no remaining findings. Review found and fixed
  the sparse-prior edge case before release verification.
- In one native opening fixture under concurrent correction-build load, 13.215
  took 0.99 s and 13.23 took 22.62 s. A two-versus-two exact forecast took 0.087 s;
  an immediate count-out fixture took 2.18 s. These are diagnostic probes, not a
  representative game-speed benchmark. Opening latency is not production-ready.
- The opening policy-only probe took 5.99/21.43/37.72 s at 128/512/1024 samples.
  The top net-points rank was stable across those three samples, but this does
  not establish WP-choice convergence or playing strength. The experimental
  default remains 512; a timed paired benchmark is required before promotion.

### Exact runtime optimization

The requested optimization must preserve the existing playing policy, root
posterior, 512-sample budget, deterministic sample identities and weights,
full late-state enumeration, scoring order, tie breaks, and WP evaluator. It
must not reduce search depth, prune low-probability alternatives, substitute a
heuristic policy, or introduce persistent observation/action storage.

An opt-in compact continuation evaluator replaces only the internal reference
average-continuation calculation for 13.23. The historical models and the
running frozen correction builder keep the reference implementation. Both
implementations remain executable so tests can compare complete weighted
results rather than just selected cards.

The compact evaluator uses a complete 124-bit semantic state as its cache key.
All active hands, sequence ranks/length, count, current player, go, and last
player are retained. Inactive bytes beyond the current sequence length are
discarded; they cannot affect the reference calculation. Hash collisions still
require full-key equality. Recursive rank traversal and floating-point operation
order are unchanged. Rank scoring and move enumeration avoid per-node heap
allocations. The continuation cache remains bounded and decision-local.

The full-budget differential matches every joint bin and weight bit-for-bit in
nine fixtures: opening, dealer reply, two-versus-two, count-out, paired fives,
low run, high cards, sparse discard-prior support, and a close endgame race.
Sample identities, population sizes, and evaluated policy-decision counts are
unchanged. In the opening, both implementations evaluate 5,549 policy decisions;
canonicalization and cache reuse reduce counted continuation-state evaluations
from 84,740,411 to 35,626,941. No branch is pruned.

The exact continuation tests also compare both weighted point totals and total
weight bit-for-bit through 64 complete physical deals, including every candidate
at each visited state. Scoring is checked against the existing card scorer for
all legal rank sequences through length five and targeted length-seven/eight
cases. Key tests cover every active field and inactive-tail canonicalization.
All 320 Rust tests pass. Standards and spec review have no findings.

Native comparisons against the saved pre-optimization `38c0aab` executable:

| Fixture | Before | Optimized | Speedup |
| --- | ---: | ---: | ---: |
| Opening | 22.373 s | 1.733 s | 12.91× |
| Dealer reply | 3.311 s | 0.356 s | 9.31× |
| Two-versus-two | 0.089 s | 0.082 s | 1.09× |
| Count-out | 2.076 s | 0.254 s | 8.19× |

Every native decision/EV matches. In a separate run of the original regression,
13.215 takes 1.014 s and optimized 13.23 takes 1.782 s. These are diagnostic
positions under concurrent build load, not representative paired-game timing
or a new playing-strength claim. Release engine and runner builds pass.

Reproduce the full-outcome check with `cargo test --release --offline -j 2
--manifest-path rust/Cargo.toml -p cribbage-shadow-engine
compact_full_budget_reference_equivalence -- --ignored`, wrapped through
`scripts/run-quiet.sh --show-warnings` as required by the compact-output guide.
The test writes `model1323-compact-equivalence.json` in the OS temporary directory.
The frozen correction job and its binary are unchanged; this runtime optimization
does not silently replace an active builder.

### Provisional correction ETA, 2026-09-13 20:48 UTC

Six workers have checkpointed 42,693 of 3,274,375 compatible pairs (1.30%), or
24 of 1,820 dealer keeps, after about 75 minutes. Raw pair-count extrapolation
suggests about four days remaining, but the initial shards are cheaper than
later shards in the completed 13.22 run.

Weighting current progress by each matching historical shard's cost, then
scaling the old total worker time by the observed speed ratio, gives 5.38 days
using pairs, 5.42 using actor screens, 6.44 using suffix rollouts, and 6.55 using
joint-world visits. Therefore the working estimate is **5–7 days remaining**
(September 18–20), not a completion guarantee. This assumes comparable work
mix within each shard and continued six-worker throughput; re-estimate after
more completed rows/shards. The micro core probe is not used as the full ETA.

The external export stages remain subject to the previously observed launchd
volume-permission failure. Internal computation and verification can finish;
the final durable copy still needs foreground completion if permissions remain
unchanged. Only a fully verified output may be installed as
`assets/model1323-corrections.bin`; preserve the old 13.22 asset separately.
