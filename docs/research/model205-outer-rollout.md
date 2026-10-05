# Model 20.5: reduce outer rollout allocations

**Complete; retained in 20.5.** The reference is the retained 20.5 engine including
[prepared compact continuation bases](model205-continuation-bases.md). Both reference and candidate keep the same
learning assets, board matrix, posterior arithmetic and executable policy.

## Scope and design

A five-second sampled pone-opening profile found continuation search and
posterior work dominant, with visible allocator activity. The outer simulator
still constructs legal-action vectors on every move, converts rank series into
Card vectors for scoring, and recreates states and observation buffers for every
world batch. This is live forecast work used by both normal play and benchmarking.

The prototype enables these changes only for 20.5:

- A forecast-local pool retains state, history, series, observation, pending-lane,
  step-counter and returned-score vector capacity across worlds and candidates.
- A 13-bit rank mask replaces temporary legal-action vectors for forced-action
  detection and returned-action validation in the optimized outer loop.
- Direct rank scoring avoids Card-vector materialization. The same RankPegState
  transition implementation still handles score-outs, go, reset, 31 and last card;
  a compile-time parameter selects scoring and legal-check implementations.

Ordinary Vec storage remains behind the pool. Reserving space for eight series
cards and 32 public events is an initial capacity, not a new input restriction.
This removes repeated allocation without introducing a second fixed-capacity
simulator or changing historical struct interfaces. The old rollout path remains
available to historical models. Rule mutation logic is shared, not duplicated.

This is not a claim that the complete decision is allocation-free. Policy query
results, posterior evidence and forecast histograms still allocate. Outer buffers
also allocate when first populated or when capacity must grow. They are released
at the end of the forecast; none becomes a persistent observation/action cache.

## Correctness safeguards

Root reconstruction/equality and physical-deck compatibility are still checked
for every world/candidate, using reusable validation buffers. Actor observations
are rebuilt and validated at every policy boundary. Every state field, including
private discards, score, actor, go, last player, history, winner and completion,
is reset when a slot is reused. Only the acting player's legal observation reaches
the policy. World order, pending-lane order, batch size, policy query order,
pruning arithmetic and histogram accumulation order remain unchanged. A failed
speculative batch still falls back to canonical scalar evaluation, and leftover
observation buffers are reclaimed before reuse.

New tests compare direct scoring against card scoring for all rank sequences
through length five within count 31 and physical multiplicities, plus longer
runs/pairs. Across 512 randomized complete hands, every legal and illegal
candidate transition is checked against the original simulator, including exact
full state equality and terminal errors. Forecast tests cover both actor
perspectives, changing worlds, partial batches, scalar/batched execution,
near-terminal scores, history prefixes, exact/near ties, pruning, invalid roots,
invalid worlds and recovery after speculative batch errors. **438 Rust tests
across 22 targets pass.**

## Measurement

The reference PGO binary is the exact frozen candidate from the prior retained
continuation-base assessment. All four modified engine files were checked
byte-for-byte against that source before this experiment. The candidate receives
a fresh PGO build using the same compiler settings, default CPU target, training
corpus and model list. Both worker processes receive identical model-20.5
requests. Fresh warmed processes alternate and reverse execution order across
18 discovery/held-out positions twice, plus three complete-hand fixtures twice.
EV/WP bits, physical choices and final states must match exactly. Reported timing
is process CPU on the shared benchmark Mac, not production-server wall latency.

A separate ordinary-release diagnostic installs an allocation-counting adapter
and toggles only the outer optimization. Its counters and environment toggle are
absent from the timed PGO and working engine sources. It compares two pone and
two dealer discovery openings. Requested byte totals are cumulative allocation
requests, not peak or retained RAM. Diagnostic CPU times are not performance data.

## Allocation diagnostic

All four opening decisions and EV/WP bit patterns matched. Allocation counts
include the complete warmed decision, not just the outer loop:

| Role / fixture | Before heap calls | Candidate heap calls | Reduction | Requested-byte reduction |
| --- | ---: | ---: | ---: | ---: |

| dealer / 20.1-left-g0-h1-s1 | 4,627,495 | 633,056 | 86.32% | 9.59% |
| dealer / 20.1-left-g0-h7-s1 | 5,553,349 | 646,963 | 88.35% | 9.71% |
| pone / 20.0-left-g0-h1-s0 | 26,236,812 | 4,790,256 | 81.74% | 8.30% |
| pone / 20.0-left-g0-h7-s0 | 20,300,189 | 3,510,516 | 82.71% | 8.55% |

Heap calls combine allocations and reallocations. These are instrumented
ordinary-release counts, not a claim about PGO timing or peak RAM. The diagnostic
adapter initially failed to compile due to misplaced module comments; correcting
those comments completed the same job without changing engine/timed source.

## PGO results

All 36 isolated decision comparisons and all 64 decisions within the six
complete-hand comparisons matched exact physical choices and EV/WP bits. All
six final hand states matched. Including the four allocation-diagnostic pairs,
**104 paired decisions/valuations matched exactly**. The six complete-hand
comparisons repeat three fixtures twice.

Isolated first-decision averages (Mac process CPU seconds):

| Role | Prior 20.5 | Candidate 20.5 | Reduction | Held-out reduction |
| --- | ---: | ---: | ---: | ---: |

| Pone | 11.536407 | 11.059100 | 4.14% | 3.60% |
| Dealer | 1.801627 | 1.669378 | 7.34% | 8.12% |

All 16 paired isolated openings were faster. Later isolated decisions averaged
19.36% lower CPU for pone and 27.57% for dealer; both held-out later-decision
averages also improved. These are tested-fixture averages, not guarantees for
every possible position.

Separate complete-hand fixture averages:

| Role / measure | Prior 20.5 CPU seconds | Candidate 20.5 CPU seconds | Reduction |
| --- | ---: | ---: | ---: |
| Pone / first decision | 10.510855 | 9.976996 | 5.08% |
| Pone / whole-hand pegging | 10.699618 | 10.127092 | 5.35% |
| Dealer / first decision | 1.372247 | 1.249556 | 8.94% |
| Dealer / whole-hand pegging | 1.399592 | 1.269438 | 9.30% |

Maximum observed post-decision RSS was 55.98 MiB before and
61.31 MiB afterward. These are snapshots after a decision, not peak
RAM measurements. Fewer allocations do not imply a lower resident footprint.

## Retained result and limits

Keep the 20.5-only storage reuse, rank-mask legality and direct rank scoring.
The gains stack on the prior packed-base optimization; they do not include its
previous improvement again. The critical pone-opening gain is about 4% on the
isolated positions, with larger gains in dealer and later decisions. This does
not replace continuation search or posterior arithmetic, which remain the
largest costs. No production-server speed claim is made from Mac CPU timings.

Fixed-capacity arrays were not necessary to obtain this improvement. Growable
buffers preserve existing accepted-input behavior while amortizing their
allocation over the forecast. There is no new persistent memo, hidden-information
policy input, changed probability weight, candidate/world reordering or playing
heuristic. The shared transition implementation and exact comparison tests provide
the basis for unchanged play.

The main PGO job and separate allocation job both completed. **438 Rust tests
across 22 targets passed**, and the working engine matches the frozen timed
candidate. The active 20.3–20.4 head-to-head runner hash was verified unchanged;
production Ace was not rebuilt or deployed. This assessment does not commit or
push the working changes.

The source snapshots, prior file copies, proposal diff, fixture inputs, adapters,
PGO receipts, profile, allocation counts, job summaries and results are archived
with verified hashes at
`benchmarks/model20/evaluation-20260929/outer-rollout-assessment`.
The working assessment root is `/private/tmp/cribbage-205-outer-rollout`.
