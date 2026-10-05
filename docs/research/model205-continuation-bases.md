# Model 20.5: prepare packed continuation bases once

**Complete; retained in 20.5.** This is a small, repeatable improvement, with exact
play/value parity in all measured cases. Reference is 20.4. Previously rejected 20.5 prototypes
(root preparation, invariant evidence filtering, early weight rejection) are absent.

The active WP evidence builder iterates candidate ranks first, evidence hands
second. For every cell it constructs AverageState and packs it into 124 bits.
The state before applying the candidate is identical across candidates for the
same evidence hand. The prototype constructs and packs that base during the
first action and retains it in a temporary vector for later actions. Evaluation
remains action-major, including continuation memo lookups and clears; it does not
group or reorder worlds or change posterior weighting.

Only load_model205 enables the option. The opaque packed state exposes no mutable
fields. Both entry points use the same absent-rank, count, and series-limit
checks, and the same recursive continuation implementation. Scores and role are
supplied unchanged for every candidate. Reuse adds no information to either
player's observation. A copied base cannot be modified by applying an action.
All existing caches keep their keys, capacities, scope, and admission policies.
The old EV evaluator is unchanged: 20.5's relevant playing path uses WP.

Single-candidate evidence allocates no base vector. For two to four candidate
ranks, construction/packing calls fall by 50–75%. At most 1,820 four-card rank
hands require 29,120 bytes of temporary packed bases. This is a reduction in
preparation work, not a prediction of overall latency savings; continuation
recursion and posterior arithmetic are unchanged, and allocation/storage have
costs of their own.

Tests compare every evidence outcome bit and hand order with physical/empirical
support, both roles, board-score changes and score-out positions, cache reuse and
clears, no/single/multiple candidates, and first/later-action errors. Random full
hand continuation tests compare the prepared path with the existing entry point
bit for bit and an independent scoring oracle. The full suite passes 435 tests
across 22 targets.

The isolated source is frozen under /private/tmp/cribbage-205-continuation-bases.
A fresh default-CPU PGO build trains both 20.4 and 20.5 and checks each against
ordinary release. Separate warmed processes then alternate/reverse model order
for 18 isolated positions twice and three complete-hand fixtures twice. Results
include exact physical choices, EV/WP bits and final states. Timings are process
CPU seconds; six independent head-to-head benchmark workers share this Mac.
Whole-hand totals are measured directly and separated by role.

## Initial PGO results

All 100 paired decisions/valuations (36 isolated plus 64 within complete hands)
matched exactly. All six terminal hand states matched. Among isolated openings,
pone CPU time was 11.773570 to 11.640412 seconds (1.13% lower); dealer was
1.865759 to 1.815180 (2.71% lower). Held-out reductions were 1.20% and 2.82%.

Measured complete-hand fixtures:

| Role / measure | 20.4 CPU seconds | Candidate CPU seconds | Reduction |
| --- | ---: | ---: | ---: |

| Pone / first decision | 10.540407 | 10.378587 | 1.54% |
| Pone / whole-hand pegging | 10.729526 | 10.563941 | 1.54% |
| Dealer / first decision | 1.398244 | 1.355353 | 3.07% |
| Dealer / whole-hand pegging | 1.425090 | 1.381598 | 3.05% |

Maximum observed post-decision RSS was 53.42 MiB for the reference and
56.12 MiB for the candidate. These are snapshots after a decision, not peak
working memory measurements.

A separate confirmation repeated all eight opening positions four more times
with fresh warmed processes and reversed model order. All 32 pairs matched
exactly. Pone openings were 11.758772 to 11.637100 seconds (1.03% lower);
dealer first decisions were 1.867911 to 1.816081 (2.77% lower). Held-out gains
were 0.66% and 3.31%, respectively.

## Clean before/after control

The initial comparison selects the reference/candidate path within one binary.
The prototype necessarily changes surrounding code and entry-point layout, so
the small gain also needs comparison with the actual pre-experiment engine.
The four touched engine files are restored byte-for-byte into a separate frozen
source tree. Both that tree and the candidate receive independent fresh PGO
builds, using the same compiler, CPU flags, corpus and model list. Timing then
alternates the untouched 20.4 binary against the candidate 20.5 binary in separate
warmed processes, covering the same 36 isolated and six complete-hand pairs.
The clean control passed all 100 paired decision/valuation checks and all six
terminal-state comparisons. Isolated opening means were:

| Role | Untouched 20.4 CPU seconds | 20.5 CPU seconds | Reduction |
| --- | ---: | ---: | ---: |

| Pone | 11.681901 | 11.558861 | 1.05% |
| Dealer | 1.845409 | 1.812409 | 1.79% |

Held-out opening reductions were 1.36% for pone and 1.77% for dealer.
Clean before/after complete-hand fixture timings:

| Role / measure | Untouched 20.4 CPU seconds | 20.5 CPU seconds | Reduction |
| --- | ---: | ---: | ---: |
| Pone / first decision | 10.799232 | 10.364612 | 4.02% |
| Pone / whole-hand pegging | 10.987915 | 10.559627 | 3.90% |
| Dealer / first decision | 1.408581 | 1.353327 | 3.92% |
| Dealer / whole-hand pegging | 1.434724 | 1.381460 | 3.71% |

These complete-hand fixtures are a different sample from the isolated opening
positions; their roughly 4% improvement is not a universal latency claim.
The repeated isolated openings support a conservative expectation of about 1%
for pone and roughly 2% for dealer on this Mac. This is not a server measurement.
Later isolated decisions are noisier and mixed: pone improved 1.00%; dealer
averaged 25.326 to 25.366 ms (0.16% slower), despite an improvement in the held-out
subset. There is no claim that every individual decision becomes faster.
Whole-hand averages improved for both roles in both full-hand runs.

## Retained result

Keep the 20.5-only packed-base reuse. No new persistent cache, information source,
probability approximation, or floating-point reassociation is introduced. The
existing reference path remains available for historical model settings. The
same frozen candidate was used throughout; no code was changed between timing
runs. The 20.3–20.4 head-to-head runner hash was verified unchanged, and production
Ace was not rebuilt or deployed.

Validation totals: **232 paired decisions/valuations bit-identical**, all **12
complete-hand comparison endings identical**, and **435 Rust tests across 22
targets passed**. The 12 hand comparisons repeat three fixtures, rather than
representing 12 distinct hands. These checks establish exact equivalence on the
tested positions; preserving the packed state and all continuation arithmetic
also provides the structural basis for unchanged play.

The source snapshots, original file copies, proposal-only diff, fixtures,
measurement adapters, PGO receipts, job summaries, results and hash manifest are
archived at `benchmarks/model20/evaluation-20260929/continuation-base-assessment`.
The working assessment root is `/private/tmp/cribbage-205-continuation-bases`.
