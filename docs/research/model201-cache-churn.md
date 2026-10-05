# Model 20.1 cache capacity and churn experiments

Baseline: `dea0a91`, including fast hashing and bypassing memoization for one/two-card tails. These experiments did not stop, modify, or restart the frozen 20.1-versus-20.0 benchmark.

## Decision

Keep the original one-million-entry limit, fast hash, and one/two-card-tail bypass. Retain only the smaller stored key from these experiments: split the packed 128-bit pegging state into two 64-bit words in the memo key, preserving every state bit, both board scores, role, equality, and the original hash output. This removes alignment padding: each `(key, WP)` entry is 32 bytes instead of 48.

This version saved 1.1% CPU in discovery and 1.4% in independent validation (1.2% pooled), with about 23% lower worker peak RSS in each comparison. The timing gain is modest under a concurrent benchmark workload; reduced memory is the clearer benefit. Logical hit/miss behavior and cache limits do not change.

Do not retain 2× capacity, 1.5× capacity, two-generation promotion, local replacement buckets, three-card-tail bypass, repeated-use admission, or the combined smaller-key/1.5-million variant. None consistently improved total CPU. The running benchmark is unchanged; the optimization branch is ready for a future frozen build.

## Timing and memory

Savings below are relative to the baseline within the same comparison. Negative savings mean slower. RSS is the complete worker process peak, in decimal MB. Allocation order affects RSS; compare paired runs, not baselines across experiments.

| Corpus / experiment | CPU saving | Elapsed saving | Peak RSS, baseline → candidate |
| --- | ---: | ---: | ---: |
| Discovery: 2,000,000-entry continuation cache | -10.0% | -11.5% | 240 → 461 MB |
| Discovery: Two 500,000-entry generations; promote old hits | -2.8% | -3.1% | 240 → 244 MB |
| Discovery: Skip three-card tails as well | -1.2% | -1.9% | 240 → 338 MB |
| Discovery: Two-slot buckets with local replacement | -15.8% | -16.7% | 341 → 152 MB |
| Discovery: 1,500,000 entries in existing allocation | -2.4% | -2.8% | 293 → 321 MB |
| Discovery: 32-byte entries; original 1,000,000 limit | 1.1% | 1.1% | 293 → 227 MB |
| Discovery: 32-byte entries; 1,500,000 limit | -1.7% | -1.4% | 293 → 213 MB |
| Validation: 2,000,000-entry continuation cache | -6.9% | -6.7% | 237 → 449 MB |
| Validation: 32-byte entries; original 1,000,000 limit | 1.4% | 1.1% | 237 → 181 MB |
| Discovery: Repeated-use admission filter; original limit | -2.4% | -2.2% | 299 → 225 MB |
| Validation: Repeated-use admission filter; original limit | 0.0% | 0.9% | 290 → 265 MB |

The baseline HashMap grows to capacity 1,835,008 once it holds more than 917,504 entries. The two-million limit forces the next allocation tier (capacity 3,670,016). The 1.5-million experiment tested additional retention without that allocation jump; it also failed to improve throughput.

## Reuse counters

The following counters come from separate instrumented binaries. They are not used for timing comparisons. The expensive opening `20.0-left-g0-h1-s0` illustrates why counting cache clears alone is misleading.

| Variant | Eligible lookups | Hits | Hit rate | Full clears / generation rotations | Evicted entries never hit |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 84,244,039 | 14,964,417 | 17.76% | 69 | 98.19% |
| double | 84,140,345 | 15,137,737 | 17.99% | 34 | 98.37% |
| generations | 84,120,448 | 15,181,666 | 18.05% | 138 | 98.44% |
| filled | 84,190,483 | 15,062,230 | 17.89% | 46 | 98.30% |
| probation | 86,332,760 | 14,632,546 | 16.95% | 2 | 93.41% |

The original hash-only profile showed 109 full clears here. Bypassing one/two-card tails already reduced that to 69. Doubling capacity halves those remaining clears to 34, but improves the eligible hit rate by only 0.23 percentage points and reduces recursive calls by only 0.8%. The higher memory and access costs outweigh that small reduction in recomputation.

Two-generation promotion finds old entries and reduces recursive work, but its additional lookups, removals, and promotion writes still lose on total CPU. The replacement-bucket prototype reduces memory further, but loses substantially on CPU. Skipping three-card tails goes beyond the useful cheap-tail admission cutoff in these samples.

The repeated-use filter is motivated by a different observation: 97–98% of admitted entries in the two expensive openings are evicted without being used. It uses a bounded 1 MB fingerprint table to screen cache misses for prior encounters, while the main memo always checks the full state, scores, and role before returning a value. Fingerprint collisions can admit unnecessary entries, never return an incorrect WP.

The repeated-use experiment reduced admissions in the expensive opening from 69,279,622 to 2,134,445, and full clears from 69 to two. However, recursive calls increased from 184,020,597 to 192,082,354 (4.4%): useful first reuses now require recalculation before the result can enter the main cache. Its CPU time was 2.4% worse in discovery and essentially unchanged in validation. Lower churn alone is not a sufficient acceptance criterion.

## Method and correctness

The discovery corpus has 12 actual contested decisions from game 0, hands 1 and 7, in both frozen benchmark orientations. The independent validation corpus has 12 different decisions from game 1, hands 1 and 6. Each corpus has six dealer and six pone positions. Binaries use the same frozen Model 20.1 assets and legal actor observations. The original 12-worker benchmark continued running.

Within each comparison, the harness rotates candidate order, warms asset loading, and records CPU time with `clock()` and elapsed time with `Instant`. It compares exact serialized selected card, EV, and WP for every paired evaluation and checks every selected card against the original game record. Discovery screens use two repetitions, the replacement-bucket test uses three, and independent validation uses three. SHA-256 fingerprints identify each binary.

Profiling is separate from timed runs. It records lookups, hits by remaining-card count, recursive calls, evictions, entries used at least once, and generation promotions. The two profiled positions are the most expensive discovery openings. An entry counted as unused might recur after eviction; these counters do not claim it is globally unique.

All caches remain decision-local. No policy, legal observation, score utility, rollout ordering, hidden-hand distribution, arithmetic order, or cross-hand cache is introduced.

## Verification and retained change

The retained representation change returned identical serialized card/EV/WP outputs in all 60 paired evaluations across 24 distinct positions. Every other experimental variant also preserved exact outputs in its completed comparisons.

- Release WP oracle, first-winner behavior, score-sensitive cache behavior, and root WP selection: passed.
- New regression check: key storage is 32 bytes per entry, keys remain distinct across full state bits/scores/roles, and hashes match the former representation: passed.
- Release Model 20 live/cache/review integration checks: passed (including both roles and the historical model path).
- `git diff --check`: passed.
- Temporary counters, timing wrappers, and rejected policies: absent from the retained source.
- Known pre-existing compiler warning: unused `WeightedEntry.count` and `full_combination_count` fields.

## Evidence

Raw comparison records, profiler counters, fixture corpora, timing scripts, source snapshots, binary hashes, and supervised job specifications are retained in `benchmarks/model20/cache-churn-20260926`. Frozen executable binaries and runtime jobs remain under `/private/tmp/model201-churn-test-20260926`. The optimization worktree is `/private/tmp/cribbage-model201-fast-hash`, branch `work/model201-fast-hash`.
