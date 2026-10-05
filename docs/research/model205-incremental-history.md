# Model 20.5: incremental observations and likelihoods

**Complete; rejected and removed from the working engine.** Reference: retained 20.5 with prepared continuation bases
and reusable outer-rollout storage. Candidate is enabled only for 20.5; no learning
asset, board matrix, posterior weight, sampled world, candidate order or policy
heuristic changes.

The proposed observation state keeps a separate public-history vector and played
rank counts for each actor in each active rollout lane. On a query it interprets
only events appended since that actor's preceding query. Scores, remaining cards,
actor-owned discards, current series and turn metadata are read from the current
state. The full observation validation remains. Every lane resets both histories
when prepared for another world/candidate/root, including after a failed batch.

The proposed likelihood cache stores a resumable summary beside a queried public
history: likelihoods, series, count, public rank counts (including the known cut),
opponent-card ordinal and self-go state. An exact hit returns the existing answer;
on a miss it searches shorter prefixes, resumes the nearest cached one, and
processes the suffix. It has the same 4,096-entry clear limit and remains local to
one decision policy. No private opponent card enters it. No observation/action
asset or full path graph is built.

Checks compare complete observations and integer likelihood arrays over 512
randomized legal hands, 4,584 positions, 499 resets and 797 go events. Every split
point is tested with and without known-cut information and with both soft-zero
modes. Additional tests cover zero/one/fractional multipliers, reverse query order,
cut branching, cache clears, exact hits, scalar/batched forecasts, pruning,
malformed roots/worlds and recovery from speculative batch errors. All 440 Rust
tests across 22 targets pass. An initial new test expected more than 500 resets;
the deterministic fixture produced 499, with all parity assertions passing. Its
coverage threshold was corrected to more than 400.

Performance method: independent PGO reference/candidate executables, identical
20.5 inputs, warmed separate processes, alternating/reversed order, 18 isolated
fixtures twice and three complete hands twice. Compare physical choices and
EV/WP integer bits, plus final hand states. Timings are benchmark-Mac process CPU,
not production-server wall latency. A separate ordinary-release diagnostic counts
avoided history events and prefix lookup attempts; its counters are absent from
the timed and working engines and its CPU timings are not used for retention.

## PGO results

All 36 isolated comparisons and 64 decisions in six complete-hand comparisons
matched physical choices and EV/WP integer bits exactly. All six final hand
states matched. The six complete hands repeat three fixtures twice.

Isolated first decisions (Mac process CPU seconds):

| Role | Prior 20.5 | Prototype | CPU change | Held-out CPU change |
| --- | ---: | ---: | ---: | ---: |
| Pone | 11.070631 | 11.096084 | +0.23% | -0.64% |
| Dealer | 1.695030 | 1.688039 | -0.41% | -0.17% |

Positive changes mean slower. Only two of eight paired pone openings improved;
three of the four distinct pone fixtures were slower on average. The small
held-out aggregate gain came from one fixture and did not generalize. Dealer's
isolated gain also did not persist in the full-hand workload. Later isolated
decisions were 0.38% slower for pone and 0.79% faster for dealer.

Whole-hand fixture averages:

| Role / measure | Prior 20.5 CPU seconds | Prototype CPU seconds | CPU increase |
| --- | ---: | ---: | ---: |
| Pone / first decision | 9.977493 | 10.052336 | +0.75% |
| Pone / whole-hand pegging | 10.125030 | 10.209760 | +0.84% |
| Dealer / first decision | 1.247751 | 1.274629 | +2.15% |
| Dealer / whole-hand pegging | 1.267833 | 1.295339 | +2.17% |

Maximum post-decision RSS snapshots were 64.23 MiB for the reference and 65.59 MiB for the prototype; these are not peak RAM measurements.

## Decision

Do not retain the combined incremental-history prototype. The critical pone lead
has no repeatable gain, and complete-hand averages regress for both roles. These
small fixture-based differences are not a claim of a universal slowdown or proof
that every possible incremental design would fail. They do not justify the extra
per-lane state and cache machinery. The two components were timed together; no
standalone speed claim is made for either component.

The exact pre-experiment copies of all three modified engine files were restored,
and the newly created prototype module was removed. Earlier 20.5 gains from
prepared continuation bases and reduced outer allocations remain intact. The
candidate's tests/source remain in the archived experiment. This assessment does
not change the frozen 20.3–20.4 benchmark or deploy production.

## Work-count diagnostic

The separate instrumented diagnostic completed after the timed PGO job. Four
additional opening decisions/EV/WP comparisons matched exactly: **104 paired
comparisons total** across both jobs. Only the prototype diagnostic executable
contains these counters; it runs in ordinary release mode and contributes no
reported timing results.

| Role / fixture | Likelihood queries | Exact-hit rate | Observation event processing avoided | Likelihood-miss event processing avoided |
| --- | ---: | ---: | ---: | ---: |

| Dealer / 20.1-left-g0-h1-s1 | 413,862 | 99.9089% | 32.05% | 57.17% |
| Dealer / 20.1-left-g0-h7-s1 | 468,151 | 99.8622% | 26.31% | 44.16% |
| Pone / 20.0-left-g0-h1-s0 | 2,672,638 | 99.9566% | 33.34% | 46.76% |
| Pone / 20.0-left-g0-h7-s0 | 1,809,086 | 99.9552% | 26.41% | 38.68% |

The pone fixtures make 1.81–2.67 million likelihood queries, but only 810–1,160
miss the existing exact-history cache. Incremental prefix evaluation saves just
2,095–2,739 interpreted likelihood events over the entire pone decision. Its
38.7–46.8% reduction in miss work therefore affects a tiny remainder of this
already-cached operation. Exact hits still require history hashing/lookup.

Observation processing does avoid 1.63–2.60 million history-event visits in the
pone fixtures. However, the incremental path maintains two actor views, transfers
buffers and resets per-lane metadata while still copying current-series data and
validating observations. The measured end-to-end result shows those changes do
not earn a reliable gain here. This is an interpretation of the measured work
counts and total timings, not an isolated timing attribution to each instruction.

## Final verification and artifacts

After removal, all **438 baseline Rust tests across 22 targets pass** and
`git diff --check` passes. The restored files match their pre-experiment hashes.
Both experimental jobs completed; the prototype passed 440 tests and all 104
paired decision/value comparisons without an observed play difference. The
active frozen benchmark executable hash is unchanged. No deployment, benchmark
restart, commit or push was performed by this assessment.

Frozen reference/candidate/diagnostic source, source hashes, exact pre-edit files,
proposal diff, tests, fixture inputs, worker adapters, PGO receipts, supervisor
summaries, work counts and timing results are archived with verified hashes at
`benchmarks/model20/evaluation-20260929/incremental-history-assessment`.
The internal working assessment root is `/private/tmp/cribbage-205-incremental-history`.
