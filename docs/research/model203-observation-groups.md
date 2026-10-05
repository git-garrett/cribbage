# Model 20.3 complete-observation grouping assessment

Baseline: `115d3b5` (posterior batching already applied). Status: complete; **not adopted**. The experimental engine change was removed
after mixed final PGO results; the committed posterior-batching implementation
remains unchanged.

## Scope and hypothesis

The first-decision rollout already batches 32 worlds. Its policy layer aliases
identical queries after each world reconstructs and validates its observation,
converts it to the Model 9.1 representation, computes or looks up behavioral
likelihoods, and checks its action memo. Earlier grouping can save that preparation
and lookup work. It cannot eliminate another full solve for each duplicate:
posterior batching and the action memo already avoid those solves.

The candidate compares the acting player's remaining ranks and own discards,
exact board scores, role/current actor, cut, count, ordered current series, go and
last player, and complete ordered public history. It reconstructs one observation
per equivalent group, evaluates representatives in first-occurrence order, and
applies the selected action independently to every original world. Opposing hidden
cards and discards never enter the equality test. All states, weights, terminal
scores, and pruning/accumulation order remain independent and unchanged.

Grouping is bounded by the existing 32-world chunk; it adds no persistent action
table or pegging-path graph. It is enabled by the existing Model 20.3 opening-only
batching gate. This is a shared engine path for Model 20.3 play and benchmarks,
not benchmark-runner overhead. Current production Ace 13.23 does not use this gate.
Older offline builders already have complete-information-set grouping, but their
packing/conversion path itself reconstructs history and physical rank cards.

## Initial screen

Six discovery positions, twice in alternating order, with ordinary release builds:
12 paired decisions matched exactly. Pone first-decision CPU fell from 15.344801
to 15.201534 seconds (0.93%); dealer from 2.037718 to 1.972135 seconds (3.22%).
The prototype avoided 38.93% of modeled observation reconstructions in pone opening
analysis and 49.85% in dealer opening analysis. Some later decisions, outside the
grouping gate, varied in either direction. These are screening results, not the
final adoption evidence.

The diagnostic counters were removed before the final PGO builds. The full Rust
suite passed 435 tests across 22 targets. New focused tests verify exclusion of
hidden cards, inclusion of every legal observation field, one policy call per
group, and bit-identical weighted outcomes for both roles and near-121 positions.
Existing batching tests cover pruning boundaries and scalar error fallback.

## Artifacts

`/private/tmp/cribbage-203-world-groups` holds frozen screening sources, counts,
paired timings, source preparation, and supervised PGO build/comparison artifacts.
The ongoing 10,000-game benchmark has not been restarted or modified.

## Final matched PGO results

Both variants received fresh PGO profiles from the same corpus, used identical
frozen assets and default CPU targeting, and passed their own scalar-versus-PGO
training and held-out parity checks. Workers were warmed, execution order
alternated, and the second repetition reversed the order. CPU seconds are used
because the long game benchmark shares the Mac. These are controlled Mac fixture
measurements, not production-server latency or population-wide benchmark timing.

Eighteen decision positions, twice:

| Role / decision | Reference mean CPU | Grouped mean CPU | CPU reduction |
| --- | ---: | ---: | ---: |
| pone first | 11.650374 s | 11.750757 s | -0.86% |
| pone later | 0.104835 s | 0.104071 s | 0.73% |
| dealer first | 1.847789 s | 1.830657 s | 0.93% |
| dealer later | 0.025286 s | 0.025405 s | -0.47% |

Held-out first decisions alone showed 0.75% **more** pone CPU and 0.93% less dealer
CPU. Three complete hands (including a close race), each repeated twice, differed:

| Role | Measure | Reference mean CPU | Grouped mean CPU | CPU reduction |
| --- | --- | ---: | ---: | ---: |
| pone | first | 10.722070 s | 10.549143 s | 1.61% |
| pone | whole-hand pegging | 10.910240 s | 10.744053 s | 1.52% |
| dealer | first | 1.379682 s | 1.386568 s | -0.50% |
| dealer | whole-hand pegging | 1.406508 s | 1.414035 s | -0.54% |

All **100 paired decisions** (36 isolated positions plus 64 decisions through six
complete-hand runs) matched selected physical cards/actions, EVs, and WPs exactly.
All six terminal game states matched. Whole-hand totals above were measured
directly, never inferred from partial-hand fixtures. The candidate passed all
435 Rust tests, including its two new grouping tests. Those experimental tests
remain in the frozen candidate artifacts, not in the retained engine.

Maximum sampled post-decision RSS was 60,736 KiB for the reference and 56,880 KiB
for the candidate; this does not measure peak RSS or establish a memory saving.

## Decision

Do not adopt this version. It reduces observation preparation substantially but
shows small, inconsistent net speed changes with the actual PGO build. The
critical pone first-decision suite regressed while the small complete-hand sample
improved; neither supports a dependable general improvement. Group matching adds
work to a path where expensive policy solves are already shared or cached.
The experiment found no playing-quality regression, but no reliable throughput
benefit sufficient to justify adding the grouping layer.

This does not prove that every possible grouping architecture is unhelpful. It
assesses a simple bounded implementation on top of the current batching and cache
optimizations. Full-population reordering or a shared continuation graph was not
implemented: it would change memory use and speculative work before pruning, and
would need a separate case and assessment under the pegging-policy ADR.

`pgo-job-v1.json` completed all three supervised stages. `pgo-summary.json`,
`pgo-decisions.json`, `pgo-hands.json`, and `provenance.json` retain the results and
exact source identities. Only this assessment document remains as a working-tree
change; no new engine change, benchmark restart, or Model 20.3 production promotion
was made by this experiment.

Version note: this assessment was run under the development 20.3 name after the
benchmark froze. The retained baseline optimizations are now assigned to 20.4;
see [the version boundary](model204-version-boundary.md). The rejected grouping
prototype remains excluded.
