# Model 20.5: broader validation of the owned/aligned solver

Assessment date: 2026-09-29 local time. **Complete; candidate not adopted.** The
native comparison does not establish a general >1% pone-opening gain. No engine
change has been applied. The user asked whether the previous 1.16% Mac pone-opening
gain generalizes, and authorized adding the candidate to 20.5 if it does.

The [earlier placement assessment](model205-layout-rounds.md) measured six
complete-hand pairs across three distinct hands after fresh PGO training.
That is evidence of a small local effect, not a general or universal >1%
estimate. This follow-up tests the benchmark's actual native decision path
over complete games and keeps first-decision and whole-hand timings separate.

## Fixed protocol

Use four new paired games, base seed `3940971898`, game indexes 0–3, with both
sides selecting 20.5. Compare retained 20.5 and the previous separately boxed,
128-byte-aligned modern owned candidate. Run one diagnostic worker at a time
and alternate launch order. Use equal-length executable/output paths and
identical startup conditions within each pair; unused environment-entry
counts 0, 1, 8 and 9 diversify startup layouts without selecting a fast one.

Reference native executable SHA-256 and candidate receipts are recorded in
`native-seed.json`. The candidate is the existing clean PGO build from the
preceding assessment, SHA-256
`7f656c9762af97115c44e974fbf63713043982821e7da7bafbac2a2ca80fbd62`.
All model assets remain frozen at the previous assessment's model root.
No diagnostic game is included in the active 20.3/20.4 benchmark.

Require exact canonical persisted game, hand, discard and pegging records,
excluding timestamps and durations. Native EV/WP fields are formatted to
12 decimal places, so these comparisons must not be called full floating-point
bit parity. The preceding 594 full-bit/decision comparisons and compiler corpus
provide separate regression coverage for the same candidate.

Native decision timings are wall time. Whole-process CPU time and the last
observed performance-core counters are additional scheduling diagnostics;
they do not supply per-decision CPU times. Report paired game effects and a
descriptive whole-game resampling interval. Hands within a game are correlated,
and four game clusters cannot establish a population lower bound above 1%.

## Source review

No findings in the candidate-specific source comparison. Only the 20.5 asset
constructor enables modern ownership. Earlier models retain their shared
solver. Mutable evaluator/likelihood caches remain decision-local; immutable
beliefs and the board matrix remain shared. Search order, weights, cache
capacities/admission, legal-information boundaries, validation, terminal rules,
tie handling and cancellation remain unchanged.

The prototype already contains tests for posterior/action/forecast parity,
mixed and reordered batches, independent decision caches, selected-action
review, repeated hand-cache use, invalid-input recovery and historical
ownership routing. If adopted, the canonical full Rust suite must pass in the
working checkout, and only the seven candidate-specific files may be copied.

Runtime evidence: `/private/tmp/cribbage-205-owned-generalization-20260930`.
The one-shot job is `model205-owned-generalization-v1`.

## Results

All four paired games complete, covering 36 hands in each implementation.
Canonical game and hand results match, as do all 389 pegging records and
74 discard records. This is exact persisted-record parity with the native
format's 12-decimal valuation precision, not an additional full-bit claim.

| Native Mac wall seconds | Retained 20.5 | Owned/aligned candidate | Reduction |
| --- | ---: | ---: | ---: |
| Pone first decision | 12.215434 | 12.694812 | -3.924% |
| Pone whole-hand pegging | 12.494152 | 12.993970 | -4.000% |
| Dealer first decision | 1.686692 | 1.720765 | -2.020% |
| Dealer whole-hand pegging | 1.711251 | 1.747050 | -2.092% |

The candidate improves only 9 of 36 individual pone openings. Per-game
opening changes and whole-process performance-core CPU shares are:

| Game index | Hands | Pone-opening reduction | Reference P-core share | Candidate P-core share |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 9 | -5.50% | 81.68% | 77.74% |
| 1 | 9 | -7.88% | 84.67% | 77.33% |
| 2 | 10 | +0.96% | 83.53% | 85.14% |
| 3 | 8 | -1.92% | 85.02% | 83.16% |

Core allocation differs, particularly in the first two pairs, despite reversed
launch order. Both variants record utility scheduling priority. Consequently,
the observed 3.9% slowdown is not a clean estimate of an intrinsic solver cost
increase. It nevertheless fails to demonstrate the proposed broad improvement.
Even the two pairs with closer whole-process core shares give mixed results.
Whole-process counters also show broadly similar instruction counts and higher
cycle costs for the candidate in the first two pairs; counters were sampled
before exit and are not exact per-decision measurements.

Descriptive resampling of the four whole paired games gives a pone-opening
reduction interval of -6.70% to -0.38%. Four clusters and unequal scheduling
conditions are insufficient for a causal or population-level guarantee. All
rows are retained; none is discarded to manufacture a favorable timing result.

These native wall times are not directly comparable to the earlier fixture
CPU-second averages: the callers, hands and measurement types differ. The
earlier 1.16% result remains accurate for its measured six pairs across three
hands, but should not be promoted to a general Mac performance estimate.

### Core scheduling limitation

Matching worker counts and reversing execution order do not ensure matching
performance/efficiency-core allocation. The native runner uses ordinary Rust
threads; the supervisor requests Standard process treatment, without assigning
core types. Historical optimization tests often used process CPU time while
six independent benchmark workers shared the Mac. CPU time excludes waiting
to run but still includes execution on either core type; it is not normalized
to performance-core work.

Recent diagnostic tests record the split, but the earlier fresh-PGO check's
within-five-percentage-point pairing is not sufficiently tight evidence by
itself for a 1.16% effect. This native comparison records whole-process rather
than per-opening core counters. Its unequal core mixes make the intrinsic
candidate effect unresolved, not proven negative. The original approximately
one-second startup discrepancy also occurred with closely matched core shares,
so scheduling does not explain every observed difference.

Before accepting another small gain, use isolated, paired native decision
measurements with verified effective scheduling priority, per-decision core
counters, balanced order and an unchanged-binary noise control. Define
acceptance criteria before collecting samples and retain all raw samples.
The existing results do not support retrospectively correcting durations with
a single assumed efficiency-core/performance-core speed ratio. This limitation
affects timing attribution, not the recorded decision/value equality checks.

## Decision and a plausible adaptation

Do not add this prototype to 20.5. The user's conditional performance criterion
has not been met. Integration is technically feasible, and playing behavior
matches the available checks; repeatable critical-path benefit is the missing
requirement. No production performance claim or deployment follows from these
tests.

A narrower adaptation is plausible in the current recursive WP evaluator.
The previous profiles localize excess sampled cycles to `WpMemo::future`, which
passes/copies continuation state and propagates fallible results through the
recursive calculation. Testing a more explicit representation and passing of
that state, or moving provably redundant internal checks to a validated entry
boundary, would target the measured cost directly while retaining the existing
policy interface. Such a change must preserve external validation, legal
information, rank order, arithmetic and results; its speed benefit remains a
hypothesis, not a result of this assessment. No such additional change was made.

The tested owned/aligned source delta is preserved as `candidate.patch` with
before/after file hashes. The working 20.5 ownership-boundary files remain
unchanged, and the three prototype modules remain absent. Since no implementation
is retained, the full Rust suite is not rerun just for diagnostic/reporting files.
Whitespace checks and final source/binary integrity checks pass. No commit,
push, production deployment or active benchmark restart is performed.

Durable evidence is retained under
`benchmarks/model20/evaluation-20260930/owned-generalization-assessment` in the
main repository, with native databases, exact canonical records, frozen runner
binaries, per-hand timings, counter snapshots, source review, job receipts and
a verified SHA-256 manifest. The four diagnostic game indexes are each present
once per implementation and contribute zero games to the active benchmark.
