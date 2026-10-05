# Model 20.5: reject zero weights before arithmetic

**Complete; not adopted.** The prototype was removed; Model 20.5 still inherited
20.4 behavior at the end of this assessment. Baseline was 20.4; neither rejected root preparation nor
invariant-evidence filtering is present. The ongoing 20.3–20.4 benchmark and
production Ace use their existing frozen builds.

The scalar reference walks each evidence hand's ranks for the depletion product,
then compatibility, then likelihoods. Compatibility can be checked while forming
the product, and a hard-zero likelihood makes the result zero before the
remaining arithmetic. This keeps evidence entries, cache keys/capacity, hand
order, and all positive weight calculations unchanged.

Model 20.3 and later preserve soft behavioral support with a minimum likelihood
of one. A zero can still arise from a public opponent go. The prototype checks
exact zeros only; small positive likelihoods retain every original operation.
It uses the acting player's existing availability and likelihoods, without
introducing another source of private information.

The tested prototype enabled early rejection only for 20.5. Surviving scalar weights
retain ascending rank order, the original base-times-ratio expression, and a
separate likelihood loop with the original multiply-then-divide order. No
reciprocal, normalization change, or reassociation is used. Zero denominators
retain positive zero; synthetic bases outside ordinary nonnegative count data
fall back when needed to preserve signed zeros and exceptional arithmetic.

The final batched candidate computes the intersection of hard-zero rank masks
across queries. If that intersection is empty, it dispatches to the unchanged
reference kernel. Otherwise, a hand containing any rank in the intersection
produces an all-zero row and needs no arithmetic. All other rows use the existing
vector-friendly loops. It does not treat a zero in one query as a zero in another.
Individual count compatibility remains in the reference batched loop.

An initial active-lane design also filtered counts before products, but its
indexed inner loops regressed dense 32-query batches by 112% in the microtest.
It was excluded. The shared-zero design avoids that cost without allocating
another lane buffer or changing matrix shape.

Weight-bit tests cover every rank hand of size zero through four, physical and
empirical modes, depletion denominators including zero, impossible counts,
hard-zero and tiny positive likelihoods, non-neutral factors through u32::MAX,
signed zero, underflow-scale and large bases, and several batch widths.
Policy tests compare exact choices for both roles, private-card variants,
board-score variants, ties, duplicate queries, cache clearing, zero-support
errors, and physical fallback.

## Kernel screening

The release microbenchmark covers hand sizes one through four, batch widths
1/8/32, known-card depletion, and either no hard zeros or a shared go excluding
ranks ace through six. It alternates four kernels over eight repetitions, using
Mac process CPU. The latter is deliberately zero-heavy (about 86% of weights),
so its savings must not be presented as normal opening latency improvements.
All generated weight vectors match exactly.

| Case | Scalar reduction | 32-query batch reduction |
| --- | ---: | ---: |
| no hard zeros | 3.6–6.2% | 0.07% |
| shared-go, zero-heavy | 50.5–51.8% | 83.43% |

The full Rust suite passes 436 tests across 22 targets. A fresh PGO build trained
both 20.4 and 20.5, checked each against ordinary release, then ran 36 alternating
isolated decision comparisons and six complete-hand comparisons. Timing excludes
microbenchmark diagnostic counters. Production and the head-to-head benchmark
are not modified by these local experiments.

## Work avoided in actual openings

A separate instrumented release replayed the two pone and two dealer discovery
openings. These counters are not in the timed PGO source. Scalar counts refer to
calls to the early scalar kernel; batched counts refer to hand/query weight
cells requested by the candidate batch entry point, including fallback to the
unchanged kernel. They are arithmetic counts, not unique hidden worlds.

| Role | Scalar weights | Rejected counts | Rejected hard zeros | Batched weights | Skipped batch weights |
| --- | ---: | ---: | ---: | ---: | ---: |
| pone | 788,171 | 2.42% | 3.01% | 587,384,481 | 0.603% |
| dealer | 138,372 | 2.60% | 3.81% | 127,292,893 | 1.134% |

The two pone openings individually skipped 0.039% and 1.368% of batched weights.
The kernel has a real opportunity after shared go evidence, but that case is a
small share of the opening workload. Most weighting uses batches, which already
avoid the scalar kernel's separate compatibility pass. End-to-end validation is
therefore needed even though the isolated zero-heavy microtest improved strongly.

## PGO gameplay comparison

Both model paths used the same newly trained PGO binary with default CPU tuning.
All **100 paired decisions** matched exact actions/cards and integer EV/WP bits:
36 isolated comparisons and 64 decisions from six complete-hand runs. All six
terminal states matched. These are Mac process-CPU timings, not production wall
latency. The independent six-worker benchmark continued on the host.

| Isolated first decision | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | ---: | ---: | ---: |
| pone, all | 11.606789 s | 11.657283 s | -0.44% |
| dealer, all | 1.885098 s | 1.827695 s | 3.05% |
| pone, held-out | 9.701032 s | 9.687525 s | 0.14% |
| dealer, held-out | 1.960138 s | 1.863036 s | 4.95% |

Three complete-hand fixtures, each repeated twice. Whole-hand totals were
measured through pegging completion, including scoring out in the close-race
fixture; no totals were inferred from partial hands.

| Role | Measure | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | --- | ---: | ---: | ---: |
| pone | first | 10.578500 s | 10.513477 s | 0.61% |
| pone | whole-hand pegging | 10.775792 s | 10.701208 s | 0.69% |
| dealer | first | 1.448414 s | 1.398305 s | 3.46% |
| dealer | whole-hand pegging | 1.477741 s | 1.425957 s | 3.50% |

Pone results are effectively mixed: isolated openings regressed 0.44%, while
complete-hand pone first decisions improved 0.61%. Dealer results were more
promising (3.05% isolated-first, 4.95% held-out-first, 3.46% complete-hand-first),
so a separate six-repeat confirmation of the four dealer opening fixtures was
started before deciding whether a dealer-only version is justified. It uses
fresh warmed processes and alternating order with the same frozen PGO binary.

## Dealer confirmation and adoption decision

The independent six-repeat dealer confirmation completed 24 more exact
comparisons, bringing gameplay parity to **124 paired decisions**, plus the
six matched terminal states. Mean dealer first-decision CPU was **1.829325 to
1.825763 seconds**, only **0.19% faster**. Held-out dealer openings changed from
1.870644 to 1.883008 seconds, **0.66% slower**. The largest apparent initial win
changed from 6.97% faster to 1.50% slower in this confirmation. The earlier
3–5% dealer gain was not reproducible, so it does not justify a dealer-only gate.

Do not retain this implementation. Its zero-weight shortcuts are valid, and the
kernel and gameplay tests found no decision/value changes. However, the existing
batching already bypasses most repeated scalar work, while common hard-zero
rows account for only 0.60% of measured pone-opening batch weights. Strong
zero-heavy microbenchmark gains did not translate into a dependable opening
improvement. The small mixed runtime changes are within the variation observed
on this shared host; they establish neither a dependable speedup nor a reliable
systematic regression.

The rejected active-lane variant, the refined prototype, all tests, diagnostics,
PGO source/build receipt, and both timing comparisons remain under
`/private/tmp/cribbage-205-early-weights`. A durable copy is saved at
`benchmarks/model20/evaluation-20260929/early-weight-rejection-assessment`.
The instrumented diagnostic source is separate from both the timed PGO source
and the noninstrumented kernel microbenchmark source.

Final retained-code verification after removing the prototype: **434 Rust tests
across 22 targets passed**; `git diff --check` passed. The three modified engine
files exactly match their saved pre-experiment versions. All 190 frozen PGO
input hashes were reverified, and the ongoing benchmark binary hash remained
unchanged. No production deployment or benchmark restart was performed.
