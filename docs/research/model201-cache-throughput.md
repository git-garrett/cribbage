# Model 20.1 cache hit and miss throughput

Baseline: `9084dcc`, including fast hashing, 32-byte entries, zero-count-only admission with more than two cards remaining, and checking zero count first. The verified optimization branch was pushed before this experiment.

## Result

Retain the fused state/score/role hash in the existing standard-library HashMap. It reduces complete-decision CPU time by 4.13% in discovery and 2.38% in validation. The change removes a demonstrated clustering problem without changing admission, entry size, capacity, stored values, or full-key equality. The small lookup helper, alternative map, and reuse of a miss hash do not provide a consistent full-decision benefit and are not retained. No dependency change is retained.

## Scope

Every variant keeps the one-million-entry maximum, the same admission predicate, complete state/score/role equality, decision-local lifetime, and recursive arithmetic. Neither what is cached nor how many entries may be retained is changed. The historical EV memo is unchanged.

The fused hash combines score/role bits with the packed state before the existing multiply/fold mixer, instead of appending them afterward. Its full key and 32-byte entry layout stay unchanged. The split variant moves recursive miss work into a separate non-inlined helper. The hashbrown control uses its ordinary get/insert API with the original hash. The hash-reuse variant computes the same hash once, then uses hashbrown raw-entry APIs for lookup and insertion. It repeats the slot search after recursion, because recursive work can resize or clear the map; it never retains a bucket pointer across that work. Hashbrown 0.14.5 was already present in the workspace lockfile and available locally; prototypes explicitly use the existing custom hasher.

## Full-decision timing

Positive percentages mean lower cost than the baseline. RSS is full worker peak memory in decimal MB.

| Corpus and variant | CPU saving | Elapsed saving | Peak RSS: baseline → candidate |
| --- | ---: | ---: | ---: |
| Discovery: Mix state, scores, and role in one hash | 4.13% | 3.47% | 84.4 → 83.7 MB |
| Discovery: Separate lookup from recursive miss calculation | 0.64% | -0.30% | 84.4 → 77.8 MB |
| Discovery: Hashbrown map control | 0.68% | 0.00% | 84.4 → 84.0 MB |
| Discovery: Hashbrown with hash reuse on misses | 0.01% | -0.30% | 84.4 → 84.7 MB |
| Validation: Mix state, scores, and role in one hash | 2.38% | 2.49% | 88.8 → 79.7 MB |
| Validation: Separate lookup from recursive miss calculation | -0.86% | -0.83% | 88.8 → 77.5 MB |
| Validation: Hashbrown map control | 0.15% | 0.08% | 88.8 → 81.1 MB |
| Validation: Hashbrown with hash reuse on misses | 0.00% | -0.08% | 88.8 → 79.3 MB |

## Hash and lookup work

The original hash leaves board-score variants clustered: for 81 score pairs and fixed remaining hands, both roles select one initial bucket and one seven-bit fingerprint. The fused hash selects 81 different initial buckets and 35 fingerprints. These are table-index/fingerprint collisions; the original full-key equality checks still returned correct values. The standalone probe compiles the actual key and hasher implementations.

Across the four profiled decisions, full-key comparisons fall from 161,878,691 to 30,352,079 (81.25% fewer). Recursive calls (352,092,612), eligible lookups (30,427,482), hits (30,115,743), insertions (311,739), clears, and final live entries are identical. The hash changes lookup work rather than cache effectiveness. Counter binaries are excluded from timing, so their atomic accounting cost cannot inflate the reported CPU savings.

Hash reuse reduces hash calls from 31,154,945 to 30,843,210, only 1.00%, and leaves full-key comparisons essentially unchanged. The memo already hits on 98.98% of eligible lookups. Saving work on the remaining insertion path is too small here to justify the extra retained key/hash bookkeeping and dependency.

| Position / variant | Lookups | Hits | Insertions | Hash calls | Full-key comparisons |
| --- | ---: | ---: | ---: | ---: | ---: |
| 20.1-left-g0-h1-s1 / baseline | 685,299 | 671,995 | 13,304 | 712,934 | 4,737,741 |
| 20.0-left-g0-h1-s0 / baseline | 15,489,584 | 15,340,468 | 149,116 | 15,868,071 | 85,206,725 |
| 20.1-left-g1-h6-s1 / baseline | 1,260,402 | 1,218,446 | 41,956 | 1,359,697 | 3,752,227 |
| 20.0-left-g1-h6-s0 / baseline | 12,992,197 | 12,884,834 | 107,363 | 13,214,243 | 68,181,998 |
| 20.1-left-g0-h1-s1 / fused | 685,299 | 671,995 | 13,304 | 712,934 | 685,739 |
| 20.0-left-g0-h1-s0 / fused | 15,489,584 | 15,340,468 | 149,116 | 15,868,071 | 15,452,605 |
| 20.1-left-g1-h6-s1 / fused | 1,260,402 | 1,218,446 | 41,956 | 1,359,697 | 1,231,848 |
| 20.0-left-g1-h6-s0 / fused | 12,992,197 | 12,884,834 | 107,363 | 13,214,243 | 12,981,887 |
| 20.1-left-g0-h1-s1 / prehash | 685,299 | 671,995 | 13,304 | 699,631 | 4,737,741 |
| 20.0-left-g0-h1-s0 / prehash | 15,489,584 | 15,340,468 | 149,116 | 15,718,956 | 85,206,731 |
| 20.1-left-g1-h6-s1 / prehash | 1,260,402 | 1,218,446 | 41,956 | 1,317,742 | 3,752,227 |
| 20.0-left-g1-h6-s0 / prehash | 12,992,197 | 12,884,834 | 107,363 | 13,106,881 | 68,181,998 |

## Method and verification

The discovery and separate validation corpora each contain twelve recorded contested decisions, split evenly between dealer and pone. Each comparison has three repetitions with rotating candidate order and warmed asset loading. The report sums per-position median CPU and elapsed times. All variants use the same frozen Model 20.1 assets and legal observations. These are controlled decision replays under the concurrent paired benchmark workload, not full-match throughput measurements.

Every candidate must match the exact serialized selected card, EV, and WP from the baseline and the recorded selected card. Profiling is separate from timing and covers the most expensive recorded dealer and pone opening in each corpus. Instrumentation counts memo calls, lookups, hits, insertions, clears, hash invocations, and full-key equality comparisons. The small hash-spread probe compiles the actual hasher/key implementations and varies only the board scores for fixed remaining hands.

All 288 paired candidate comparisons preserve exact selected cards, EVs, and WPs; the retained hash passes 72 comparisons across 24 distinct positions. All 12 instrumented decisions preserve both outputs and logical cache counters. A new regression test first failed against the previous hash because 81 score combinations occupied one bucket, then passed with the retained hash. The key regression also checks all stored state bits, every score bit, both roles, and retrieval under forced constant-hash collisions, while retaining the 32-byte entry assertion. Release WP oracle/key tests, Model 20 live cache/review integration tests, and `git diff --check` passed. The existing unused `WeightedEntry` fields warning is unchanged. Experimental counters, timing wrappers, helper, map dependency, and raw-entry code are absent from the retained source.

## Evidence

The report, corpora, frozen variant sources, scripts, counters, binary hashes, and supervised job specifications are archived under `benchmarks/model20/cache-throughput-20260926`. Binaries and runtime jobs remain under `/private/tmp/model201-cache-throughput-20260926`. The implementation branch is `work/model201-fast-hash`. The original paired benchmark was not changed or restarted.
