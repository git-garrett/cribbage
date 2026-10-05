# Model 20.1 structural cache admission experiments

Baseline: `dc2f3e3`, including fast hashing, one/two-card-tail bypass, and 32-byte full-key cache entries. All caches remain decision-local. The frozen 20.1-versus-20.0 benchmark was not changed or restarted.

## Result

Retain the simplest rule: cache a WP continuation only when the running count is zero and more than two cards remain. It reduced CPU time by 27.0% in discovery and 24.9% on the separate validation corpus, beyond the previously accepted optimizations. Validation peak process RSS fell from 213 MB to 82 MB (61.6%). The other admission and retention policies helped less and are not retained. These measurements cover decision replays, not full-match throughput.

## Timing and memory

Positive savings mean less time than the baseline in that comparison. RSS is the full worker process peak in decimal MB.

| Corpus and variant | CPU saving | Elapsed saving | Peak RSS: baseline → candidate |
| --- | ---: | ---: | ---: |
| Discovery: Only 3–4 cards remaining | 4.6% | 4.9% | 201 → 182 MB |
| Discovery: 3–4 cards, plus larger zero-count states | 5.4% | 5.6% | 201 → 202 MB |
| Discovery: Separate zero-count pool (200k / 800k) | 7.1% | 7.1% | 201 → 118 MB |
| Discovery: Only zero-count states, with >2 cards | 27.0% | 26.7% | 201 → 87 MB |
| Validation: Separate zero-count pool (200k / 800k) | 8.0% | 7.7% | 213 → 114 MB |
| Validation: Only zero-count states, with >2 cards | 24.9% | 25.0% | 213 → 82 MB |

The separate-pool prototype kept the total one-million-entry limit, assigning 200,000 entries to zero-count states and 800,000 to interior states. Each pool cleared independently; there was no per-hit promotion or extra lookup in another pool. HashMap allocation tiers differ when a capacity is split, so the experiment measures the complete tradeoff, not retention in isolation.

## Structural explanation and counters

While a series is active, its complete ordered ranks distinguish many paths. Resetting the count to zero removes that series, allowing different paths to reach the same remaining hands, board scores, role, and turn state. Storing intermediate nodes also competes with those shared boundary values; a boundary hit bypasses its descendants. These are reasons to test admission by state structure, not proofs that an interior state is impossible to revisit.

The zero-count variant keeps the existing bypass for one/two-card tails and the existing one-million-entry maximum. Cache omission only recomputes a value. The recursive arithmetic, rank order, first-winner handling, board lookup, observations, beliefs, candidate order, and full state/score/role keys are unchanged.

Counters below come from separate instrumented binaries, excluded from timing comparisons.

| Position / variant | Recursive calls | Memo lookups | Hits | Admissions | Full clears |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20.1-left-g0-h1-s1 / baseline | 12,380,651 | 4,581,640 | 717,427 | 3,864,213 | 3 |
| 20.0-left-g0-h1-s0 / baseline | 184,020,597 | 84,244,039 | 14,964,417 | 69,279,622 | 69 |
| 20.1-left-g0-h1-s1 / reset_only | 12,740,456 | 685,299 | 671,995 | 13,304 | 0 |
| 20.0-left-g0-h1-s0 / reset_only | 184,814,330 | 15,489,584 | 15,340,468 | 149,116 | 0 |

In the expensive pone opening, baseline interior lookups hit only 0.91% of the time, while zero-count lookups hit 94.92%. Restricting admission to zero-count states reduced cumulative admissions from 69,279,622 to 149,116 and full clears from 69 to zero. Eligible cache lookups then hit 99.04%; this is not the hit rate across all recursive calls. Recursive calls increased only 0.43%, while useful boundary hits increased from 14,337,246 to 15,340,468. The fraction of admitted entries never reused fell from 98.19% to 13.42%.

## Method and correctness

The discovery corpus contains 12 recorded contested decisions from game 0, hands 1 and 7, in both orientations. The separate validation corpus contains 12 different decisions from game 1, hands 1 and 6. Each contains six dealer and six pone positions. These are controlled replays of retained observations, not a new randomly seeded game benchmark.

The discovery screen uses two repetitions; validation uses three. Candidate order rotates for each position and repetition. The harness warms asset loading, records process CPU time using `clock()` and elapsed time using `Instant`, and checks exact serialized selected card, EV, and WP against the baseline. It also checks the selected card against the original game record. All variants share the same frozen Model 20.1 assets. The original twelve-worker paired benchmark continued running, so the replay timings are not claims about measured full-benchmark throughput.

Profiling covers the most expensive dealer and pone opening in the discovery corpus. Counters classify eligible lookups, hits, admissions, used/unused evictions, and final live entries by remaining-card count and whether the running count is zero. Full-key equality is always checked; no approximate cache values or persistent action tables are introduced.

## Verification

All 168 paired candidate comparisons produced identical selected cards, EVs, and WPs, including 60 comparisons of the retained rule across 24 distinct positions. All four separate profiling evaluations also preserved decisions. Release WP oracle/key regression checks and Model 20 live cache/review integration checks passed. `git diff --check` passed. The existing unused `WeightedEntry` field warning remains unchanged. Timing and profiling instrumentation were removed from the retained source.

## Evidence

Frozen source variants, corpora, scripts, results, binary hashes, counters, and supervised job specifications are archived under `benchmarks/model20/structural-cache-20260926`. Binaries and runtime jobs remain under `/private/tmp/model201-structural-cache-20260926`. The implementation branch is `work/model201-fast-hash`, in `/private/tmp/cribbage-model201-fast-hash`.
