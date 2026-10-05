# Model 20.6 version boundary

Model 20.5 is frozen following its benchmark. New root-pruning and ordering work belongs to `schell_table-peg_table-20.6`; earlier benchmark rows, frozen binaries, assets, and model labels are unchanged.

## Initial implementation

20.6 uses the same immutable learning assets, posterior weights, executable legal-information continuation policy, final tie rules, and surviving outcome arithmetic as 20.5. It adds a separate root choice solver with direct maximum-utility bounds. The original 20.5 choice solver remains byte-for-byte unchanged and is still selected for 20.5 requests.

For each hypothetical world, the controller finds the maximum root utility among all rule-legal continuations. It may know both hypothetical hands to calculate that ceiling; each player's executable policy still receives only its legal observation. Only a candidate whose conservative weighted ceiling falls strictly below a fully evaluated incumbent is discarded. The existing floating-point allowance is preserved. No monotonicity of the empirical board utility is assumed.

Bounds are memoized only within the current decision. Remaining-hand variants can share a bound even when their discards differ, because discards cannot alter rule-legal pegging endpoints. There is no persistent action table or stored pegging-path graph. The first candidate needs no bound prepass. Selected-action and combined reviews retain full requested valuations.

Empirical-prior root ordering is now enabled after the independent held-out confirmation described below. Cheap ranges, endpoint storage, pairwise hints, immediate scoring orders, and the inner-policy hint are not enabled in this version.

## Model and build routing

The engine, API model list, web model type, forced-rank handling, and background opening eligibility recognize 20.6 separately. Existing immutable playing assets are shared with 20.5; 20.6 additionally embeds a fixed root-ordering prior table, parsed once and shared immutably. Bound caches are decision-local. Switching model IDs through the same hand cache must preserve results. The research package and default benchmark PGO training target are 20.6. Native Mac release builds still generate a fresh profile and rebuild automatically. Production Ace is unchanged.

## Validation

The full Rust suite passed 456 tests across 22 targets, including exhaustive compact-transition/direct-maximum checks below 2,048 roots, near-tie and unequal-weight pruning checks, cancellation, and model switching through shared caches and reviews. Release-build script tests, web tests, and TypeScript type checking also passed.

Release-mode validation completed under `/private/tmp/cribbage-model206-incorporation/job-v1.json`: all 64 comparisons across 32 saved positions matched frozen 20.5 choices and exact EV/WP bits for both model routes. All eight discard, selected/combined review, and whole-hand cases matched between versions, including both complete eight-card pegging hands. The canonical verification receipt and final report are synchronized to `benchmarks/model20/evaluation-20260930/model206-incorporation/`. These are parity checks; prior assessment timings are not relabeled as new 20.6 speed measurements.

This implementation is isolated in the `codex/model206-direct-bounds` worktree. The separate 20.5 research checkout and its concurrent pegging-policy experiments are untouched.

## Empirical ordering incorporation

Only the 20.6 root choice solver uses the fixed `prior-last1` traversal hint. It
starts with a uniform prior, then applies the tested 16-pseudocount smoothing
through role/phase, public last-card context, and legal-rank-set counts. Rank
ties are ascending. Returned forecasts are restored to ascending rank order
before final selection, preserving the existing physical-card and value ties.
Neither the prior nor an early guess can select a move or prune a candidate;
only exact valuation and conservative direct bounds do that. Inner policy
decisions, reviews, and 20.5 routes are unchanged.

The embedded asset is byte-for-byte the confirmed table, with SHA-256
`5543f601ebdf8a1b03f0a08e67edcae0d823dee2f9f6a6b80a37102a2f12e247`.
Its 19,286 aggregate context rows come from 33,240 attributable 20.4 decisions,
game indices 100–1499 of the 20.4-left orientation in the September 29 20.4 vs
20.3 benchmark. The earlier audit replayed 320 decisions exactly. No 15.x/16.x
actor decisions are included and no retraining occurred for incorporation.
These aggregate traversal hints are not an authoritative observation-to-action
policy or a stored pegging graph. The executable legal-information policy still
computes every surviving candidate. The source asset is fingerprinted by the
normal PGO build even when runtime playing assets come from another directory.

The independent confirmation used 64 fresh pone openings, 32 dealer first
decisions, 32 later decisions and 12 complete hands, with fresh balanced PGO
training and repeated hardware-instrumented measurements. Empirical ordering
reduced mean pone-opening CPU time from 5.7413 to 5.5286 seconds (3.71%; adjusted
97.5% interval 1.02–7.37%). Instructions fell 3.74%; hardware-matched gain was
3.84%. Complete-hand pegging totals improved 4.41% as pone and 11.10% as dealer.
All 1,024 decision trials and 72 hand replays retained exact choices and EV/WP
bits. These Mac workload results do not establish an AMD production speedup.
See `benchmarks/model20/evaluation-20260930/model206-ordering-confirmation/report.md`.

The incorporation adds an embedded-asset integrity test, all 128 measured
traversal-order regressions, fallback/single-action tests, and an external-root
PGO fingerprint regression. Release-mode integration validation passed all 128 held-out 20.6 decisions,
16 20.5 compatibility decisions, and eight discard/review/full-hand cases per
model with exact physical choices and EV/WP bits. The full suite passed 459
Rust tests across 22 targets and all 14 release-build tests. A normal Mac
benchmark build generated a fresh PGO profile and passed exact parity. Records
are archived under
`benchmarks/model20/evaluation-20260930/model206-empirical-incorporation/`. No strength benchmark restart or production deployment
is part of this change.

## Forced continuation loops

20.6 play and review preparation now opt into an iterative WP continuation path
for go transitions and a single physical legal card. Duplicate-rank weighting,
ascending accumulation order, score-out/31/last-card rules and decision-local
cache admission remain unchanged. Earlier model routes retain the original
recursive evaluator. The flag belongs to a newly created decision policy, so
it cannot carry into a subsequent request for another model. The loop also
preserves negative-zero normalization from skipped one-copy weighted averages.

The dedicated one-/two-card evaluator and prebound role variants were rejected.
Normal Mac benchmark builds independently generated fresh PGO profiles for the
old and final engines, with no CPU-native flags or build-process changes. On
12 pone openings excluded from the first screen, the final implementation
reduced mean CPU time from 5.152789 to 5.017498
seconds (2.63%; fixture-clustered 95% interval
2.23–2.99%). Instructions fell
6.71%. Complete eight-card pegging totals improved
0.77% as pone and -1.07% as dealer across six other
hands, two repeats per build. These are Mac measurements, not AMD estimates.

All 132 timed decision trials and 24 whole-hand replays retained exact choices
and EV/WP bits. The final release also matched all 128 saved 20.6 positions,
16 historical 20.5 positions and eight discard/review/whole-hand cases per
model. The Rust suite passed 460 tests; new coverage checks negative zero,
cache contents/clear behavior, invalid series and 128 randomized legal games.
Records are preserved in the main workspace under
`benchmarks/model20/evaluation-20261001/model206-forced-incorporation/`.
The existing scored benchmark binaries and production release are unchanged.

## Exact show suit classes

20.6 now counts compatible physical opponent show hands by integer flush/nobs
classes instead of materializing every suited hand. Known public opponent cards,
the cut, own cards and own discards impose the same legal constraints as before.
Each score bin and the total receive the original number and order of repeated
weight additions; no multiplication of a weight by its multiplicity or reuse of
discard-time floating distributions is introduced. Historical model routes keep
their existing enumeration. The experimental buffer-reuse path was declined.

The initial assessment found a 0.29% pone-opening CPU saving (about 15 ms), while
the isolated show forecast fell from 14.54 to 0.16 ms. The final normal Mac PGO
build was independently checked on 22 other saved positions and six other complete
hands. Pone-opening CPU time changed from 4.997020 to
4.964653 seconds (0.648% faster; 95% interval
-0.499 to 1.866%).

All timed trials, 128 additional 20.6 positions, 16 historical 20.5 positions,
and eight discard/review/full-hand cases per model retained exact physical
choices and EV/WP bits. Tests additionally compare 57,120 integer class counts
and 360 complete histogram bit patterns across direct, 20.6 and historical routes.
The initial final-build timing interval was wider than the assessment's, so a
supplemental hardware-controlled check preserved all original observations and
selected samples only by predeclared core share, frequency and scheduler waiting.
It measured 1.904% faster pone-opening CPU time (95% interval
1.248 to 2.458%) across
12 comparable positions using the unchanged binaries. The first confirmation pass
accepted only eight positions; the other four received a bounded repair using
identical application scheduling for both binaries. Every original and repair
attempt is preserved; hardware thresholds and the statistical guard were not
relaxed.

The shared rank-score table already survives from discard to pegging; no new
cross-phase cache is added. This is a Mac optimization assessment, not an AMD
production speed claim. Verified records are preserved under
`benchmarks/model20/evaluation-20261001/model206-suit-classes-incorporation/`.
