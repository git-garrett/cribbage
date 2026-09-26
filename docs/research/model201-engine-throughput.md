# Model 20.1 playing-engine throughput

Baseline: `dea3abc51d3489e0ea8ffc2685d52dbd4ea0edb1`, including all previously accepted cache optimizations. Date: 2026-09-26. Retained all three engine changes below; cache layout, admission, capacity, key, and lifetime are unchanged.

## Measured result

Full-decision replay CPU and wall-time reductions versus the baseline, using 12 discovery positions and three repeats with rotated execution order:

| Change | CPU reduction | Wall-time reduction |
| --- | ---: | ---: |
| Visit present, playable ranks | 20.26% | 20.08% |
| Extract packed series once; skip impossible run scoring | 6.61% | 6.49% |
| Use the existing rank mask for empirical depletion | 10.46% | 10.00% |
| All three | 37.38% | 37.23% |

The combined version also passed an independent 12-position corpus, three repeats:

| Role | CPU reduction | Wall-time reduction |
| --- | ---: | ---: |
| All | 36.41% | 36.97% |
| Dealer | 40.81% | 41.42% |
| Pone | 36.06% | 36.62% |

These are complete Model 20.1 pegging decisions through the benchmark's streaming decision adapter, including model setup and evaluation. They are not whole-game throughput measurements. The original 12-worker benchmark remained active, so timings were interleaved/rotated and process CPU time was the primary metric. Tests/builds/sampling did not overlap timed comparison stages.

The combined version preserved the selected card and exact serialized EV/WP on all 72 paired comparisons across 24 positions. All independent variants also matched: 252 timed decision outputs in total. Both corpora contain six dealer and six pone positions. The fixtures are retained observations from the existing frozen benchmark, not newly generated games or a new random-seed benchmark.

Peak worker RSS was 80.73 MiB baseline versus 83.72 MiB combined in discovery, and 79.58 versus 83.05 MiB in validation. The changes add no persistent state or cache allocation; these are single-process peak observations, not a memory reduction claim.

## Why these changes help

- **Continuation rank enumeration:** `WpMemo::future` previously examined all 13 ranks and repeatedly extracted 128-bit fields. It now extracts the active hand once into 64 bits, masks out ranks that cannot fit under 31, and visits only present ranks. Ascending rank order, multiplicities, play validation, terminal handling, and the floating-point accumulation sequence are preserved.
- **Pegging scoring:** `State::score` extracts the 32-bit packed series once. When the last ranks repeat, a run cannot end at that play, so the run scan is skipped. For other plays, the last rank seeds the run scan. Fifteens, 31s, pairs, triples, quads, and longest-suffix runs retain their previous rules.
- **Empirical depletion:** `evidence_hand_weight` already held a rank mask but called a helper that scanned all 13 ranks twice. The new loop uses that existing mask for both combinatorial products. Omitted ranks multiply by exactly one; product order and the final multiply/divide order are unchanged. The separate likelihood adjustments, including neutral factors, remain unchanged.

## Profile and benchmark-engine audit

A 10-second sample of the baseline replay worker had 7,510 leaf samples: 3,302 in `WpMemo::future`, 1,225 in `State::score`, 563 in `WpMemo::play`, and 885 in `evidence_hand_weight`. Continuation traversal/scoring accounted for about 68%, and evidence weighting about 12%. This is a sample of expensive replay positions, not a universal CPU breakdown.

A separate five-second sample of the actual frozen runner confirmed the same compute-heavy path. Coordinator semaphore waits and frozen-opponent pipe reads were expected: the coordinator waits for games, and a worker waits while its opponent computes. They do not establish expensive IPC overhead.

The runner already keeps one opponent process per worker, handles forced single-card plays without model evaluation, reuses loaded assets, and releases hand-cache locks before the expensive decision-local solve. There is no shared global solve lock to remove. Writes occur through the coordinator after each completed game, with one SQLite transaction per game. The sample did not identify persistence as a bottleneck.

The existing allocation uses 12 game workers across six performance and six efficiency cores. More concurrency inside each solve would compete with these workers. A clean worker-count sweep is still needed before claiming that six, eight, or twelve workers maximizes total games per hour; this experiment did not change worker allocation.

## Remaining candidates, not yet measured

1. **Share immutable belief data:** `model1323::PolicyAssets::decision_policy` deep-clones `Model91EmpiricalBeliefs`, including its HashMap and vectors, for each decision. Sharing the immutable belief data could reduce allocation/copying while keeping action and continuation memoization decision-local.
2. **Avoid a discarded crib calculation:** `model1323_pegging_win_evaluator` builds the ordinary crib distribution through `post_pegging_win_context`, then replaces it with the Model 20 suit-aware distribution. Select the required distribution before constructing the context.
3. **Reduce rollout setup:** `world_state` reconstructs histories and validates the same public observation for each action/world rollout. Validate invariant input once and reuse a prepared starting state where that preserves legal-information checks and independent mutable rollout state.
4. **Reduce scheduling tail:** the runner assigns game indices by a fixed stride. A next-index work queue could reduce the final tail from uneven game duration, while keeping each game seed and orientation tied to its index. This is unlikely to affect the main steady-state bottleneck.

These opportunities are code-audit findings, not measured savings. SQLite/date subprocess cleanup and lock removal are lower priorities than the measured model work.

## Verification and provenance

- Extended the existing exhaustive rank-hand weighting oracle to depleted empirical modes, including unavailable cards and zero baseline support. It passed before the optimization and after it.
- Passed the Model 9.1 tests, including the compact scorer versus the reference for every legal series through five cards plus longer edge cases, complete-game continuation equivalence, and the WP oracle with first-winner termination near 121.
- Passed the Model 20 integration tests covering live/review behavior and hand-cache equivalence.
- Only the pre-existing unused `WeightedEntry` fields warning remained.
- Restored the ordinary decision worker; all timing wrappers and prototypes remain in the experiment artifacts.
- Frozen original benchmark runner/opponent binaries and its job were not modified or restarted. A future run must explicitly use a rebuilt runner to benefit.

Replays and supervisor specifications: `benchmarks/model20/engine-throughput-20260926/`. The internal run directory is `/private/tmp/model201-engine-throughput-20260926`; executable snapshots remain under its `bin/` directory. Archived artifacts include source prototypes, fixtures, per-decision results, sampling reports, test logs, and verification/provenance records.
