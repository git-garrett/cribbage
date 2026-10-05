# Further exact Model 20.3 throughput opportunities

Reviewed after applying commit `7414667926de984eefb90fda79e2f3238e7b915a` into the resumed benchmark. These are candidates for separate experiments, not additional production changes or measured speedups.

## Evidence and scope

A fresh native sample of the optimized engine replaying opening-pone fixture `20.1-left-g1-h1-s0` still places about 38% of top-of-stack samples in compact WP future/play, 21% in evidence weighting, 13% in scoring the pegging series, and 4% in SipHash. These are approximate shares of one three-second sample, not a whole-benchmark cost breakdown. Raw profile: `/private/tmp/cribbage-203-diagnosis/profile-v3.txt`.

The original 20.3 slowdown remains primarily an expansion of joint keep/discard support. The reviewed code already caches continuation outcomes across owned-dead-card variants, and already uses rigorous probability-mass bounds to abandon proven losing root actions. Neither idea is missing wholesale.

## Priority 1: stop recomputing fixed evidence denominators

`model91.rs::wp_choice_from_evidence` reuses the same evidence hands across observations differing in owned discards and cut. `evidence_hand_weight` nevertheless recomputes `before`, the product of binomial coefficients under `empirical_baseline`, for every hand on every call. The baseline depends on public opponent-played ranks, which remain in the evidence cache key; each hand and baseline are therefore fixed for the lifetime of that evidence entry.

Precompute that product when building the evidence entry and reuse its exact `f64` value. Preserve the expression `base_weight * (after / before)` and its multiplication order; folding the denominator into the base weight or storing its reciprocal changes rounding. This removes work from a measured hot function without dropping posterior support. Measure the added per-hand storage against cache locality and memory use; no benefit is claimed until the full decision replay improves.

Also reject a hand immediately when its copies exceed current physical availability. The current depleted-empirical path finishes both products, then traverses the mask again to discover incompatibility. A check inside the first traversal can return the same positive zero earlier and eliminate the second compatibility traversal for that mode. Keep finite/nonnegative weight preconditions and the other weighting modes intact. Evaluate independently before stacking.

## Priority 2: reuse the posterior-weight scratch buffer

Every evidence-based WP choice allocates a fresh weight vector and discards it after ranking legal moves (`model91.rs::wp_choice_from_evidence`). Keep a private scratch vector in the existing decision-local policy, clear its length, and refill it in the same hand order. The policy is already accessed through its mutex, and recursive continuation work completes before this vector is used. This can remove allocator traffic without changing arithmetic, capacity limits, or cached semantics.

Allocator samples support looking here, but also include observation/history allocation. The whole allocator share cannot be credited to this one vector. Keep the already-rejected normalization-once change out of this experiment.

## Priority 3: cheaper repeated series scoring

`model91_compact.rs::State::score` scans the same short series across many different hidden-hand and board-score states. Its result depends only on the active series and count, not on either remaining hand, scores, or role. Try a small decision-local exact-key scoring memo or an incremental representation for runs/pairs. A hash alone must never identify a series; include length and count and compare the complete key. A cache lookup may cost more than a short scan, so measure both early and late positions and retain the existing direct path for cheap cases if needed. This has a visible cost ceiling in the profile, but no measured gain yet.

## Priority 4: cache-key and observation overhead

The continuation memo has its specialized hash, but `wp_decisions` and `wp_evidence` still use standard HashMaps with large observation keys. An exact packed key or suitable incremental internal-key hasher could reduce hashing/copying while retaining all observation, likelihood, role, and score fields. Do not reuse the continuation hasher blindly: its specialized `write_u128` replaces its state and is designed for a single packed key. Full-key equality remains mandatory.

`Model132Observation::from_state`, `Model911Policy::choose_action`, and the Model 9.1 adapter also reconstruct public history and repeat validation on internally generated legal states. A private validated-state boundary could avoid duplicate work while preserving checks on external inputs. This is secondary to the measured weighting/continuation costs; remove no public validation by assumption.

## Larger opportunity, higher implementation risk

Group hidden-discard worlds only while they produce the same acting player's legal observation and public path; branch when the opponent's private discards change its chosen action. Matching only the opponent keep is insufficient. The current action/evidence caches already share much of the policy computation, so grouping chiefly avoids repeated rollout/state work unless it also enables better evidence batching. Preserve root pruning behavior and each world's original histogram accumulation order. Any batching or algebraic moment scheme that reassociates probability sums needs an explicit exactness argument; a faster but different policy does not satisfy this task.

## Acceptance gate

Test each candidate alone against the coefficient optimization now used by the benchmark, then test useful combinations. Preserve card choices, EVs, WPs, posterior support, tie-breaking, and terminal scores. Add focused coverage for 121-point wins, go/reset/31, duplicate ranks, tiny positive likelihoods, and depletion contradictions. Use warmed, reversed-order CPU comparisons on discovery and held-out fixtures, with first decision and whole-hand totals separated by dealer/pone for game-level checks. Reject repeatable material regressions in cheap decisions, memory, or end-to-end throughput. No additional cache size change or pruning/sampling is recommended from this review.
