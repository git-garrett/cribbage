# Model 20.1 continuation hash experiment

Date: September 25, 2026 (PDT). Source: `d162c2d230aabd395ea60724b0097426343e60eb`.

## Result

The existing internal fast hasher reduced Model 20.1 pegging CPU time by 29.0% and elapsed time by 29.2% in the replay corpus. All 36 paired evaluations returned exactly identical serialized decisions, including selected card, EV, and win probability. Every selected card also matched the original benchmark record.

| Role | Positions | Baseline CPU (s) | Fast CPU (s) | CPU reduction | Elapsed reduction |
| --- | ---: | ---: | ---: | ---: | ---: |
| dealer | 6 | 3.751 | 2.734 | 27.1% | 26.9% |
| pone | 6 | 38.062 | 26.949 | 29.2% | 29.4% |
| all | 12 | 41.813 | 29.683 | 29.0% | 29.2% |

Times are sums of per-position medians across three repetitions, not average decision latencies. Whole-corpus CPU reductions by pass were 28.5%, 30.6%, and 28.0%.

## Scope and method

The production change is one line in `rust/cribbage-shadow-engine/model91_compact.rs`: `WpMemo.outcomes` uses `BuildHasherDefault<StateHasher>`, already used by the points continuation evaluator. The full key still includes pegging state, scores, and role; equality still compares every field. Hash collisions cannot substitute one state for another. No cache lifetime, capacity, pruning, model policy, or asset changed. There is no reuse across unrelated live decisions or dependence on a future repeat of a hand and cut.

The corpus contains all 12 contested Model 20.1 decisions in game index 0, hands 1 and 7, from both orientations of the frozen 20.1-versus-20.0 benchmark. It covers six dealer and six pone decisions, including two opening leads, two first replies, and later decisions in the same hands. Card IDs were converted from the compact log to engine IDs, and only the acting player's legal observation was supplied. The selected-card check independently verifies replay against the retained games.

Both workers were built offline in release mode from the same frozen revision and installed assets, using the same toolchain and target directory. The only engine difference is the hash-map hasher. Both include the same measurement-only streaming-wrapper patch: `clock()` for process CPU microseconds and `Instant` for elapsed nanoseconds. A short decision warms asset loading before measurements. Each pair alternates baseline/fast order; three repetitions use persistent worker processes, as the benchmark does. The main 12-worker benchmark continued running. CPU time and paired ordering help control scheduling noise, but do not replace a broad end-to-end throughput measurement.

## Restart assessment

At the cost snapshot, 238 of 10,000 games were saved (2.38%). Model 20.1 pegging consumed 64.2% of recorded model-decision elapsed time across both orientations. Applying the measured 29.0% CPU reduction to that share estimates 18.6% less total model-decision work. This is an extrapolation from a small corpus, not a measured full-benchmark speedup or ETA. Its margin over the restart cost is large enough to recommend applying the change and starting a newly frozen run. Preserve the current run and its provenance; do not replace its executable or mix different binaries in its databases.

The original benchmark was left running while this test was performed.

## Verification

- Paired replay: 36/36 exact serialized-decision matches; 12/12 original recorded card choices matched in every repetition.
- Release WP tests: scoring-oracle/first-winner behavior, score-separated caching, and root WP selection all passed (three tests).
- Release live/cache/review integration passed for both dealer and pone; the historical Model 20.0 path remained unchanged.
- `git diff --check` passed.
- Compiler warning: pre-existing unused `WeightedEntry.count` and `full_combination_count` fields.

## Retained evidence

Raw fixtures, all timings and decisions, binary SHA-256 values, measurement patch, engine patch, replay script, and supervisor specifications are retained at:

`/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model20/hash-ablation-20260926`

The two instrumented binaries and isolated Cargo target remain under `/private/tmp/model201-hash-test-20260926`. Run `python3 scripts/cribbage_job_queue.py summary /private/tmp/model201-hash-test-20260926/replay-job.json` for the completed experiment. To repeat, preserve the prior result, create a new versioned supervisor job/output path, and run the retained replay harness with the frozen binary and fixture checksums.
