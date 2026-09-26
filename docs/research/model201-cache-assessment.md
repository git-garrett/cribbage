# Model 20.1 decision-local cache assessment

Date: September 25, 2026 (PDT). Baseline: `99e480f`, including the completed fast-hash optimization. The running paired benchmark remained unchanged.

## Accepted change

Keep the existing decision-local WP caches and limits. Do not look up or store continuation values when only one or two cards remain across both players. Evaluate those cheap tails directly, retaining the same recursive arithmetic, card order, terminal handling, and win-probability calculation. More expensive continuations retain the existing one-million-entry bounded memo.

No model choice rule, score/role key, observation, belief, asset, persistent cache, or cross-hand reuse was added. The action and evidence caches retain their existing limits and behavior. This is an admission rule for the existing continuation cache, not a search approximation.

## Measurements

All percentages below compare with the fast-hash baseline. Positive savings mean less CPU or elapsed time.

| Experiment | CPU saving | Elapsed saving | Decision outputs |
| --- | ---: | ---: | --- |
| Fourfold larger continuation cache (4,000,000 entries) | -22.4% | -24.9% | Identical |
| Fourfold larger decision/evidence caches (400,000 decisions; 1,200,000 outcomes) | 0.4% | -0.03% | Identical |
| Skip caching one/two-card tails, discovery corpus | 8.3% | 8.0% | Identical |
| Normalize irrelevant series prefixes | -4.7% | -5.4% | Identical |
| Normalize prefixes and skip cheap tails | 5.3% | 5.5% | Identical |
| Skip caching one/two-card tails, separate validation corpus | 9.7% | 9.6% | Identical |

The admission change saved 8.9% when pooling the sums of per-position median CPU times from the two corpora. This is an additional improvement beyond the earlier fast-hash change, not a directly measured full-benchmark throughput gain.

Validation by role: dealer CPU 12.8% lower and elapsed 10.3% lower; pone CPU 9.4% lower and elapsed 9.5% lower.

Peak RSS in the discovery matrix: baseline 278 MB; larger continuation cache 870 MB; admission change 336 MB; larger policy caches 319 MB. In the separate validation, baseline was 301 MB and admission was 304 MB. Allocation order and corpus affect process peaks; the accepted change does not increase any cache cap and is not claimed to reduce peak RSS.

## What the profile showed

The existing cache already avoids repeated simulated decisions. In the expensive opening at game 0/hand 1 with Model 20.1 on the right:

- Action cache: 664,375 requests, 285,335 hits (42.95%), three full clears at the 100,000-entry limit.
- Evidence cache: 379,040 requests, 357,398 hits (94.29%), 15 full clears at the 300,000-outcome limit.
- Continuation memo: 33,595,094 nonterminal hits and 109,127,711 misses, with 109 full clears at the 1,000,000-entry limit.

Those counts motivated the experiments, but did not establish that larger caches would be faster. The fourfold continuation limit was slower and used over three times the peak RSS. More retained decisions/evidence gave no useful throughput gain. The accepted change instead avoids hash-table work for small tails while reserving entries for larger subproblems.

## Method and correctness

The discovery corpus contains 12 contested decisions from game 0, hands 1 and 7, in both orientations of the frozen 20.1/20.0 benchmark. The validation corpus contains 12 different contested decisions from game 1, hands 1 and 6, again in both orientations. Each corpus includes six dealer and six pone positions. Only each actor's legal observation was replayed.

The initial four-variant screen used two repetitions; the prefix/combined comparison used three; separate validation used three. Variant order rotates within each position. Workers use the same frozen source/assets and identical timing wrappers; CPU time uses `clock()` and elapsed time uses `Instant`. Asset loading is warmed and excluded. The main 12-worker benchmark continued running. Binaries are frozen and SHA-256 fingerprints are recorded in each result.

For the retained change, all 60 paired evaluations across 24 distinct positions returned exactly equal serialized selected cards, EV, and WP; every selected card also matched its original benchmark record. All rejected variants also preserved outputs in their measured comparisons.

The prefix-normalization prototype first reproduced a missing-reuse regression (eight entries after an equivalent prefix versus five beforehand). Its candidate passed that regression, the WP oracle, first-winner checks, and an exhaustive scoring-extension test exceeding 100,000 cases. It was nevertheless rejected on speed. Its temporary implementation and tests are retained only with experiment artifacts, not in the final engine patch.

Final retained-code verification:

- Release WP scoring oracle, first-winner behavior, score-sensitive caching, and root WP selection: passed (three tests).
- Release Model 20 live/cache/review integration suite: passed (three tests, including both roles and the historical model path).
- `git diff --check`: passed.
- Temporary counters and timing wrapper: removed from the worktree.
- Known compiler warning: pre-existing unused `WeightedEntry.count` and `full_combination_count` fields.

## Evidence and disposition

Raw counters, replay scripts, corpora, timing samples, exact outputs, memory peaks, binary fingerprints, frozen variant sources, supervisor specifications, and the final patch are retained under:

`/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model20/cache-assessment-20260926`

The isolated binaries and supervised jobs remain under `/private/tmp/model201-cache-test-20260926`; the Cargo build cache is under `/private/tmp/model201-hash-test-20260926/target`.

Recommend retaining the fast hash and this admission rule before creating the next frozen benchmark. Do not carry over the larger limits or prefix normalization. This assessment did not stop or restart the existing benchmark.
