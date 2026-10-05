# Model 28.3: future hand counting and 20.x strength audit

## Scope

Implement the requested hand-aware future valuation inside the existing
four-card score-block policy. Compare against the immediately preceding 28.3,
then audit the integrated 20.0–20.7 line at base commit
`e8098cc828793bcc1faf46fae3eb113f3124a13c`. This changes experimental 28.3 only;
no learning refresh, production promotion, model-default change or commit was
requested. Earlier assessments remain historical records.

## Implemented valuation

Each initial four-rank hold receives its rank-only show score for the known cut
once, before the sweep. Removing a played card preserves that initial show.
Each candidate's already selected pegging endpoint remains associated with the
opposing hold until utility calculation. Pegging wins stop first; otherwise
pone counts, then dealer. The remaining unknown crib uses the engine's existing
`BoardModel` generic crib distribution, followed by the same rebuilt 20.2 board
matrix at the next hand's discard seam with roles reversed. No rounded mean
crib score is added and no hand is counted twice.

A decision-local 128 × 128 scalar table stores WP after both shows and before
the crib. This is 128 KiB of values, not another hand-context dimension. The
actor averages these values over its legal opposing holds before selecting one
action. Both players use the same rule. The uncontested suffix uses the same
valuation; an empty opponent's original keep has become public by then.

Production directly sums weighted conditional values, removing per-candidate
`BTreeMap` histograms from future selection. This keeps the hold/counting
association without constructing larger joint histograms. The complete child
score cells still contain **pegging endpoints**, so counting is never propagated
back as if it were pegging. The historical histogram calculation and board-only
utility exist only behind a test-build ablation flag. Normal production code
always uses hand-aware valuation.

This is deliberately **rank-hand-aware**, not a claim of exact full private
counting at every future choice. Future groups still omit their own private
discards and suit bonuses. The future crib remains a generic distribution,
independent of the particular hold and cut; it is the existing standard phase distribution, not the 20.7 conditional empirical crib model. Actual live-root valuation retains
exact known suited show plus the previously implemented hold-conditioned joint
opponent-show/crib forecast. Fixing that remaining future/live mismatch requires
another measured strategy change, not silently passing actual hidden cards.

## Strength audit by version

| Existing feature | Source | Status in 28.3 |
|---|---|---|
| 20.0: role-specific empirical holds, known-card depletion, empirical conditional discard ranks and suited-discard rates | `model1323.rs::load_model20`, `model.rs::model20_discard_context` | Retained through the newer 20.3 assets. Live decisions use all their legal known cards. Future own-discard conditioning is the exception below. |
| 20.1: prefer WP rather than only net pegging points; observe race-to-121 endings | `model91.rs::choose_action_by_wp`, `model91_compact.rs::terminal` | Retained. Future 20.1–20.7 valuation itself ends at generic `AfterPegging` WP. The new rank-hand-aware 28.3 goes beyond that baseline. |
| 20.2: rebuilt board matrix, shared by live and continuation decisions | `model1323.rs::load_model202`, `model.rs::board_for_model1323` | Same verified asset. Future counting ultimately rejoins this matrix after the crib. |
| 20.3: complete positive hold support, smoothed qualified decline evidence, physical/Go exclusions, conditioned discard fallback | `model1323.rs::load_model203`, `model91.rs::load_binary`, `model132.rs::rank_likelihoods_for_history` | Retained. Complete support is validated on load. 28.3 uses the same cut-aware likelihood kernel with positive soft support; Go remains hard evidence. |
| 20.3: live opponent-show forecast from the current posterior; exact own show and counting order | `model.rs::model1323_pegging_win_evaluator` | Retained and strengthened at the root by keeping opposing hold, pegging endpoint, show and crib associated. |
| 20.4 and 20.5: batching, prepared continuation bases, buffer/cache changes | `model1323.rs::load_model204`, `load_model205` | These are execution changes with the same assets/strategy, not missing strength features. 28.3 has a different solver and should port only measured applicable ideas. |
| 20.6: exact score bounds, empirical candidate traversal ordering, forced-continuation loops, integer suit classes | `model206_bounds.rs`, `docs/research/model206-version-boundary.md` | Bounds/ordering are speed-only and cannot select or discard a potentially better move. Their absence does not omit a strategic alternative. Root suit-class arithmetic is retained. |
| 20.7: short legal-rank check | `model91.rs`, `model1323.rs` preparation flags | Speed-only. 28.3 uses rank masks and skips already forced row selection. |
| 20.7: current-posterior conditional crib forecast with within-keep normalization and empirical suit allocation | `model1323.rs::opponent_discard_weights`, `model283_counting.rs::joint` | Retained at the root, including late tails. Joint counting additionally preserves show/crib and pegging/hold correlation that 20.7's separate marginals lose. |
| All recent 20.x: full discard candidate/cut evaluation, correction histogram, suited counting, WP selection and tie rules | `model.rs::recommend_discard_model1323_with_assets` | Same path and assets; existing native test pins 28.3 discard decisions to 20.7. No new discard strategy introduced. |
| Legal-information boundary and full legal pegging horizon | `decision.rs::decision_input`, `model283.rs::prepare/solve` | Preserved: no actual opposing private cards enter live input; one action per legal-information group. No sampling, timeout policy substitution or deliberately shortened horizon. |

## Remaining strength opportunities, ranked

1. **Future actors' own discards — a real loss relative to 20.x.**
   `model1323.rs::world_state` gives each simulated 20.x actor its own two
   discards; `model132.rs::model91_observation` passes them to depletion. In
   28.3 `Hand` identifies only the four-card keep. The current live decision
   knows its discards, but its forecast of its own future decisions forgets
   them. This can change inferred opponent holds and expected responses.
   The earlier dense keep-plus-discard expansion failed the speed gate;
   that failure does not prove a compact correction impossible. Do not subtract
   the actual root discards from both players' hypothetical domains.
2. **Remaining future/live valuation mismatch.** Rank counting is now included,
   but flush/nobs and hold/cut/discard-conditioned crib values still are not.
   20.7 has these at its live root, not its inner after-pegging policy; this is
   a shared modeling limitation rather than a newly discovered missing 20.7
   inner feature. A future suit-aware choice needs sufficient private suit
   context, not merely a correct suit scorer. A generic crib can misprice
   whether to chase pegs or survive to counting, especially near 121.
3. **Beliefs calibrated to the new policy.** Both models use the inherited
   empirical soft decline factors rather than action likelihoods generated by
   28.3's chosen strategy. Go and card impossibilities are exact, but mutual
   best-response selection does not make these beliefs an equilibrium.
   Recalibration is a separate strength experiment. Preserve positive support
   and ADR-0002/0003 learning-source restrictions.
4. **Discard/board calibration for the new pegging strategy.** Discard selection
   still uses the old finite correction histogram, and longer-term WP uses
   the retained board matrix. These are retained strengths, not missing code;
   their predictions may need retraining if 28.3 changes the value of keeping
   particular hands. No existing asset was reclassified or retrained here.

Do not restore the old innermost averaging of legal continuations as a purported
strength feature. 20.x's WP continuation averages physical legal plays in
`model91_compact.rs::future`; 28.3 deliberately replaces that strategic
approximation with the information-group backward selection. Neither architecture
is proven stronger just because it performs more strategic calculation.

## Earlier experimental 20.5.pegging variants

The integrated checkout also retains the abandoned research variants; their
source is included in this audit, without restarting their impractical jobs.
`model205_pegging.rs` has two relevant ideas beyond the normal 20.x baseline:

- It conditions future reach weights on the **fixed opponent policy's selected
  actions**. Consequently it does not reapply independent empirical soft
  likelihoods to those hypothetical choices. This is an internally consistent
  feature for that fixed-opponent problem which 28.3's empirical-history
  reweighting does not reproduce. Extending it to two simultaneously optimized
  players is not a free posterior substitution: earlier action probabilities
  and later beliefs have to agree. It is a credible further research item,
  not an authorization to rebuild the rejected recursive world machinery.
- The root's subsequent decisions use the same counting-aware objective as the
  initial decision. Its fixed-opponent best-response formulation admits the old
  root policy as an available strategy, yielding an in-model nondecreasing-WP
  check. The symmetric 28.3 model has no corresponding dominance guarantee over
  20.7. The rank-counting change narrows its live/future mismatch, but does not
  eliminate private discard, suit and crib differences.

`model205_pegging2.rs` models both actors with full own-discard observations,
but still uses generic after-pegging WP internally and explicitly does not
solve equilibrium reach probabilities. The information completeness is relevant;
the massive recursive posterior construction is not itself a strength feature
to restore. None of these experimental properties establishes higher real
playing strength or justifies reviving the failed full-world architecture.

## Verification design

- Independent bounded backward reference retains each original hold, scores
  counting with the native rank scorer, and applies sequential counting via
  `BoardModel`; compare actions and endpoints with compact/uncompressed blocks
  and reuse enabled/disabled, plus the old-policy ablation.
- Direct witnesses cover pegging wins before counting, pone-first score-outs,
  correlated show/pegging endpoints, preservation of the initial show after
  plays, and all selected pre-crib table entries against the standard evaluator.
- Native posterior/history tests, physical scoring, joint root counting,
  live/review agreement and hidden-card mutations protect the information and
  integration boundaries.
- Same release test binary, eight serial matched opening trials, reversed
  order across fixtures and repeated first fixture. Old mode must reproduce
  preserved old full forecasts exactly. New mode intentionally may select
  different moves; posterior weights and public tree sizes must remain equal.
- Three fresh native complete-hand replays of the saved deals using the final
  production-form library. Each move is legal; a hand ends after eight cards or
  a legitimate score-out. CPU/wall and first/whole-hand timings are reported
  separately, along with core share and sampled peak footprint.
- One background/nice-20 worker alongside the unrelated six-worker workload.
  No PGO or CPU-native tuning in this matched diagnostic. This does not replace
  a paired playing-strength benchmark or a fresh production PGO assessment.

Evidence run: `/private/tmp/cribbage-model283-future-counting-20261004`.
The release assessment passed. Verified results follow.


## Verified results

**Retain the change in experimental 28.3.** The corrected valuation does not
expand the public tree, hand populations or score-block storage. The old test
ablation reproduces the preserved preceding 28.3 forecasts exactly. Repeated
runs reproduce both the full new forecasts and root WPs bit-for-bit. All 115
frozen source/asset/harness inputs and all three binaries remained unchanged.

Release correctness includes the independent backward reference with compact
and uncompressed tables, reuse on/off, counting-order/correlation witnesses,
physical scoring, native posterior/history checks, discard parity with 20.7,
and live/selected/combined-review consistency. The native hidden-information
audit passed 10 positions across both roles/seats with 80 legally consistent
hidden-card/discard/RNG alterations; card, EV and WP bits never changed.
Production-form native opening ranks and EV/WP bits match the test binary on
all three fixtures. No new runtime fallback was introduced.

### Matched opening timings

Each row has equal weight in overall means. Fixture 1 averages two trials per
mode in old/new then new/old order; fixtures 2 and 3 have one matched pair each,
with reversed order on fixture 2. Both modes run in the same release test binary
with reuse enabled. Counts include a small common setup for the test ablation;
raw search times and whole-process instruction/cycle samples are separate fields.

| Fixture | Old CPU s | New CPU s | Old wall s | New wall s | Fewer instructions | Fewer cycles |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 70.558 | 60.275 | 93.657 | 88.384 | 3.38% | 5.37% |
| 2 | 91.074 | 93.091 | 111.516 | 186.505 | 3.43% | 6.86% |
| 3 | 125.373 | 118.670 | 140.797 | 126.503 | 3.63% | 5.57% |

Equal-deal mean search CPU falls 5.22%, while wall time rises 16.02% because
fixture 2's new run spends far more time off CPU. All eight trials have zero
performance-core CPU share, but that does not hold frequency or scheduling
constant. The first fixture's individual CPU pairs are 73.109 → 51.017 seconds
and, in reverse order, 68.008 → 69.533 seconds. These observations must not be
turned into a guaranteed latency percentage. Sampled cycles divided by sampled
CPU time also vary, confirming that matching core type alone does not remove
timing noise.

The more stable evidence is **3.50% fewer instructions and 6.01% fewer cycles**
across equal-deal means; every deal's aggregated counts decrease. The acceptance
is a hand-counting correction with reduced measured computation and no new
world dimension, not a claim that every elapsed-time trial is faster. This
small screen does not replace controlled production-hardware measurements.

All public block/group/choice counts, prior-cache counts, forced-selection
counts and peak score-cell bytes are identical between policies on each deal.
For example fixture 1 retains 840,990 blocks, 5,303,828 groups, 3,117,976 actual
choice groups and 6,145,044 peak score-cell bytes. The new scalar WP table is
128 KiB. There is no keep-plus-discard Cartesian expansion.

### Decision effects

All three live leads remain K, 8 and 2. Conditional pegging endpoints change in
108/3,450, 293/5,373 and 1,667/7,252 candidate/hold outcomes respectively, with
identical legal posterior weights. Estimated root WPs change from
0.6056459376 → 0.6054370428, 0.3409439355 → 0.3416194245, and
0.8521528044 → 0.8591259726. These are model predictions, not measured win rates.
Both players' future behavior changes, so predicted root WP need not rise.

### Actual complete native hands

These use the final production-form release library, a distinct binary from
the diagnostic test harness. Do not use their difference from the diagnostic
or earlier-day timings as a causal speedup estimate. They are fresh complete
pegging replays of the same saved deals, with both actors using updated 28.3.
All three play eight cards legally, reproduce the preceding joint-counting
28.3 rank-action lines, and finish at 16–15, 68–73 and 119–119.

Times below are **wall / CPU seconds**, summing every actual pegging decision
for whole-hand columns. Pone/dealer first means the first decision of the whole
hand, not a later count-to-31 restart.

| Hand | Pone first | Pone whole hand | Dealer first | Dealer whole hand | Peak physical footprint MB |
|---|---:|---:|---:|---:|---:|
| 1 | 67.367 / 65.475 | 67.824 / 65.929 | 9.263 / 8.945 | 9.352 / 9.032 | 19.94 |
| 2 | 72.753 / 70.626 | 73.115 / 70.983 | 5.494 / 5.254 | 5.569 / 5.326 | 18.76 |
| 3 | 64.885 / 62.002 | 65.290 / 62.400 | 5.514 / 5.239 | 5.566 / 5.290 | 18.32 |
| **Mean** | 68.335 / 66.034 | 68.743 / 66.437 | 6.757 / 6.479 | 6.829 / 6.549 | — |

All complete-hand runs also report zero performance-core share. These background
Mac timings are not production-server estimates. Three unchanged play sequences,
reference agreement and hidden-state invariance establish implementation
correctness on the tested cases; they cannot establish playing-strength
nonregression or superiority. That remains a separate paired-games question.

Durable evidence: `benchmarks/model28/model283-future-counting-20261004/` in the
main workspace. It includes old/final source snapshots, exact frozen input and
binary hashes, all raw timings and full conditional forecasts, verification,
complete-hand records, `analysis.json` and this report.

## Known-only continuation correction (2026-10-04)

The later [known-discard continuation assessment](model283-known-discards-continuations-20261004.md) retains the actual live actor’s two supplied discards throughout its own future choices, without enumerating unknown opponent discard pairs. The earlier large context counts apply to expanding every hypothetical actor’s possible private discards, not this narrow correction. The shared opposing policy remains private-information independent. Native and fresh-PGO checks found the narrow correction inexpensive; historical full-context costs above remain preserved.
