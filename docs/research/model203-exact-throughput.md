# Exact Model 20.3 evidence arithmetic experiment

Baseline: frozen Model 20.3 source `b2379b53a783dedf4b866a7048c46b561c7e7496` and the reference streaming worker from `/private/tmp/cribbage-model203-vs-model202-10k-20260927-v1`. The running 10,000-game benchmark is unchanged.

A native sampling profile identifies `evidence_hand_weight` as a substantial cost, alongside the compact WP continuation solver. Its binomial coefficients always describe at most four physical copies of each rank. Specializing those coefficients removes repeated multiply/divide loops without changing posterior support, accumulation order, caches, or policy decisions. The general coefficient calculation remains the fallback outside the deck domain.

## Evaluation

The warmed reference and candidate workers use identical frozen assets. Eighteen existing regression positions (six discovery, twelve held-out validation) cover both roles and opening/middle/late pegging. Two repetitions reverse worker order. Compare CPU time separately from wall time while the main benchmark runs. Require exact decoded JSON equality for card, action, EV, and WP. These fixed positions deliberately reproduce the known regression; they are not new strength-test games.

The initial 5-by-5 lookup table reduced aggregate CPU time by 5.83%, but a 16 ms late-hand case regressed about 2% in a 20-repeat check. A direct single-copy fast path and small-deck coefficient cases replace that table in the final candidate.

Normalizing posterior weights once before evaluating all legal plays was also tested on top of the table. Across six discovery positions and two reversed-order repetitions it was 1.23% slower (52.854182 versus 53.502302 CPU seconds), with identical outputs. That candidate was rejected.

The coefficient test checks all 65,536 `(u8, u8)` input pairs bit for bit against the original routine. Existing evidence tests also verify full posterior weights against the reference formula across all rank hands of sizes zero through four, several depletion baselines, and nontrivial likelihoods.

Runtime scripts and raw per-position timing/decision records: `/private/tmp/cribbage-203-diagnosis/{exact-replay,normalized-replay,direct-replay,short-replay,direct-short}*`. Instrumented worker adapters are diagnostic only and are excluded from the source change.

## Final result

The direct-coefficient candidate passed all 36 comparisons: 99.080616 baseline versus 93.245195 candidate CPU seconds, a 5.89% reduction. Discovery improved 5.87%, held-out validation 5.91%; dealer positions improved 7.89%, pone positions 5.53%. The two test orders improved 5.76% and 6.02%. Card, action, EV, and WP matched exactly in every comparison.

The two initially concerning short positions were repeated 20 times each with the direct-coefficient candidate. Excluding initial warmup, their deltas were approximately +12 microseconds on a 16 ms decision and +0.6 microseconds on a forced response, effectively unchanged at this measurement scale. No material regression was observed; this finite fixture set cannot guarantee every possible position is faster.

Release evidence tests pass, including the exhaustive coefficient test and posterior-weight parity test. The wider Model 9.1 policy tests passed for the initial bit-equivalent table candidate. Builds emit only the existing unused `WeightedEntry` fields warning. The diagnostic adapter was restored; only the arithmetic helper and its call sites/test remain changed.

This is an incremental throughput improvement, not a solution to the roughly fourfold increase in supported joint keep/discard worlds. Private opponent discards can alter their legal-information posterior and decisions; those worlds cannot simply be collapsed by matching the retained hand. Further grouping must prove policy equivalence and preserve terminal outcomes and floating-point accumulation order.

## Applied benchmark restart

Committed and pushed as `7414667926de984eefb90fda79e2f3238e7b915a`. The replacement runner and its tests were built with the one-shot supervisor, then the original job was stopped before resuming under `model203-vs-model202-10k-20260927-v3`. Retained 143 completed games: 71 in 20.3-left and 72 in 20.2-left. The former had a hole at index 70 with index 71 already present; resume runs `[70,71)` then `[72,5000)`. The latter resumes `[72,5000)`. Seeds, assets, opponent binary, six-worker selection, and the 10,000-game total remain unchanged.

The runtime `benchmark/speed-v3-restart.json` preserves old metadata, exact retained index sets, hashes of retained game/hand/discard/pegging rows, and the new source/binary identity. The final verification stage rechecks those hashes and complete index intervals before reporting and durable sync. Old and new timing samples remain distinguishable through the retained index sets.
