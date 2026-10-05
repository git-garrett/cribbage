# Model 20.5: bounded score-pair maps

Assessment date: 2026-09-29 local time. **Complete; not retained.** Direct
indexing accelerates these map operations, but their cost is too small to
justify an engine change for the measured workloads. No working engine code,
production release or running benchmark was changed.

## Applicable work

The live forecast in `model1323.rs::forecast_worlds_for_choice` maintains a
`BTreeMap<(u8, u8), f64>` outcome histogram for each candidate and a second
tree of utility values shared across candidates. These maps are updated or
looked up for every visited world. Selected-action forecasting uses the same
kind of outcome histogram. Direct indexing is technically appropriate here.

`model.rs::PostPeggingWinContext` separately memoizes utility by absolute board
scores in a HashMap. Nonterminal legal board scores fit a 121-by-121 array.
However, the outer utility memo already prevents repeated calls into this
context for the same score pair during rollout; later candidate selection
looks up only the aggregated outcomes. It is not a large per-world hash cost.

Two apparent candidates already use arrays: `board.rs::BoardMemo` directly
indexes scores, role and phase, while `model91_compact.rs::SeriesScoreMemo`
uses a packed, direct-mapped cache with complete-key collision checking.
The large continuation memo is keyed by the complete compact game state,
scores and role; it is not a small score-pair domain suitable for this change.

Four existing complete-opening CPU profiles attribute 0.072–0.133% of sampled
self cycles to the outer choice-forecast function. That includes inlined tree
work, but does not establish a strict ceiling for separate allocation/callee
costs. It motivated a targeted operation-cost measurement.

## Trace and replay protocol

Freeze the retained 20.5 working source in an isolated directory. Add trace
capture after utility lookup, recording each visited world’s score pair,
weight bits and utility bits in original order, plus exact pruning stops.
Replay 18 saved discovery/held-out decisions: four first decisions and five
later decisions for each role. Compare the diagnostic physical choice, EV
bits and WP bits against the retained PGO reference. Diagnostic capture times
are not performance evidence.

The standalone release-mode replay compares the original tree/hash operations
against a direct-index prototype. The latter covers all 65,536 possible u8
pairs, plus the 14,641 nonterminal utility-context score pairs. It reuses a
touched-entry list, resets only touched histogram slots, and sorts touched
indexes before final traversal. Each key’s addition order and the final
lexicographic sum order remain unchanged. Allocation, initialization, final
histogram export and sorting are included. Its three value arrays occupy
1,165,704 bytes, approximately 1.11 MiB, before touched/output vectors.

Recorded utility values replace the unchanged utility calculation; captured
scores replace continuation solving. The experiment therefore measures map
work, not complete-decision speed. It checks final histogram, WP and EV bits.
Additional synthetic cases cover score 255, score zero, zero weights and
utilities, duplicate keys, pruned-candidate clearing and sorted output.

Run one replay process with all six orders of two identical tree controls
and the indexed implementation. Each chunk targets about 60 ms of process CPU.
Retain all samples and record performance/efficiency-core counters around
each chunk. The separate six-worker benchmark continues unchanged.

## Measurements

All 18 diagnostic decisions match exact choices and EV/WP bits. All 18 trace
replays match histograms and final numerical results exactly; synthetic edge
cases pass. The source and binaries used for this screen are preserved.

| Decision | Fixtures | Current map work | Indexed map work | Estimated saving | Estimated share of full decision saved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pone first | 4 | 5.126 ms | 1.522 ms | 3.604 ms | 0.030% |
| Dealer first | 4 | 1.191 ms | 0.449 ms | 0.742 ms | 0.042% |
| Pone later | 5 | 0.284 ms | 0.138 ms | 0.146 ms | 0.169% |
| Dealer later | 5 | 0.063 ms | 0.048 ms | 0.015 ms | 0.082% |

These are means across fixtures, not whole-hand totals. Percentages compare
the aggregate replay savings with the aggregate retained-reference decision
CPU time. They are estimates, not a measured integrated engine speedup.
Initialization makes the array prototype about 11–12 microseconds slower on
two of the smallest later decisions.

All 24 pone-opening replay blocks happened to have at least 95% performance-core
time in every chunk, with at most one percentage point of spread within each
three-variant block. Thus no pone-opening samples need filtering for that
post-hoc scheduling sensitivity check, and their means are unchanged. Across
the entire experiment core usage varies more; some short-decision estimates
are noisier. All raw blocks remain in the main result. A post-hoc sensitivity
table is descriptive only, not a new acceptance test. Neither CPU seconds nor
these core checks make this a production-server latency measurement.

Even eliminating the measured map work entirely would save only about 5 ms
per tested pone opening. The actual array replay saves roughly 3.6 ms. This
agrees with the sampled profile’s indication that the outer maps are a very
small part of the cost; the expensive continuation work is unchanged.

## Decision

Do not integrate the prototype into 20.5. A reduction of roughly 70% in these
map operations translates to an estimated 0.03% opening benefit, with smaller
absolute savings elsewhere and additional scratch memory. A fresh full PGO
build and noisy whole-game comparison are not justified by this cost screen.
The utility HashMap alone offers still less potential because the outer memo
already limits its call count.

This does not rule out direct indexing for another demonstrably hot bounded
domain, or revisiting these maps after the continuation cost falls greatly.
It does establish that this particular proposal is not a useful next step
for the current pone-opening bottleneck. Historical models remain unchanged.

The one-shot trace job completed both build and capture stages. The replay
and edge-case checks completed successfully. No engine implementation was
retained, so the full Rust regression suite was not rerun for diagnostic-only
source and reporting. Final working-source and active-benchmark binary hashes
were verified unchanged; whitespace checks pass. No commit or push was made.

Working evidence: `/private/tmp/cribbage-205-bounded-maps-20260930`.
Durable archive: `benchmarks/model20/evaluation-20260930/bounded-map-assessment`,
including frozen diagnostic source, binaries, exact traces, all replay rows,
core counters, job completion receipts and a verified SHA-256 manifest.
