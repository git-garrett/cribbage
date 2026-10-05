# Model 20.3 posterior batching

Assessment against `610e73c66c3b40bfdc6bd30b5b2d13c8d3df72cf`, including all preceding engine optimizations and PGO-only Mac builds. The accepted working-tree change batches only the root player's first pegging decision, as either pone or dealer. It does not restart the long benchmark or change production Ace.

## Finding and selected design

Grouping requests alone was slower. The useful version shares the rank traversal while computing the separate posterior weights for related queries, then accumulates each action's utility in its original hidden-hand order. It processes at most 32 worlds together, and consumes their terminal results in the original world order. All original support and pruning remain; 32 is a scheduling bound, not a world-sampling budget.

Rollouts advance each world through forced plays until its next decision. The policy receives only each actor's legal observation. Exact duplicates can share a response within the batch. Other queries share continuation evidence only under the existing complete evidence key, including role and both board scores. Their owned dead cards, physical availability, and likelihood vectors still produce independent weights and decisions. No persistent observation-to-action table or pegging-path graph is added. Existing cache bounds and admission rules are unchanged.

Two implementations were screened at batch sizes 8, 32, and 128, alongside scheduling-only and scalar controls. All 54 screen comparisons matched exactly. On six discovery positions without PGO, the initial implementation increased CPU by 3.1%, 3.9%, and 7.0%. Sharing the actual rank-weight traversal reduced CPU by 9.52% at 32 and 9.58% at 128. Pone reductions were 9.09% and 8.96%, respectively. The larger batch did not establish a useful pone advantage, so the smaller bound was retained.

The ungated prototype added overhead to a cheap later-turn case. The final version opts in only while the root player's `own_played` counts are zero. Historical models and subsequent live decisions keep scalar rollout scheduling. Each speculative chunk can do at most 31 extra worlds before a challenger is pruned; accumulation and the pruning decision still happen at the original per-world boundaries.

## Exactness and regression checks

- 304,640 individual posterior weights matched the scalar routine bit for bit across all rank hands of sizes zero through four, all weighting modes, depleted availability, zero and tiny likelihoods, extreme factors, tiny weights, and signed zero.
- Each lane preserves the original coefficient-product order, `base_weight * (after / denominator)` expression, and multiply-then-divide likelihood arithmetic. It does not replace division with a reciprocal or combine likelihood multipliers.
- Tests compare batched and scalar choices across both roles, owned discards, cuts, likelihoods, duplicate queries, memo hits, zero support, and race-to-121 scores. Empty empirical support retains the physical fallback.
- Histogram and pruning tests preserve every joint outcome and probability bit, including ties and unequal world weights. A speculative batch error falls back to canonical scalar evaluation, so errors from worlds that pruning skips are not surfaced; cancellation remains an error.
- The full Rust suite passed: **433 tests across 22 targets**. The existing unused `WeightedEntry` fields warning remains.
- Both final binaries received independently generated, fresh PGO profiles with no native-CPU tuning. Each build passed instrumented-versus-reference training parity and optimized-versus-reference training and held-out parity.
- Final cross-version validation matched **36 decision fixtures plus 64 live decisions through six full-hand runs**. Selected physical cards/actions, EVs, WPs, and final game states were exact, including signed zero through serialization.

## Final PGO performance

Both sides use native Mac release builds with PGO alone, identical frozen assets, warm-up, and alternating execution order, reversed on the second repetition. CPU time is the comparison metric because the existing long benchmark continues to share the host. Fixture names referring to older models describe their historical source; every evaluation executes Model 20.3.

Eighteen positions, each repeated twice:

| Suite | Role / decision | Reference mean CPU | Batched mean CPU | CPU reduction |
| --- | --- | ---: | ---: | ---: |
| all | pone first | 12.648508 s | 11.830961 s | 6.46% |
| all | pone later | 0.105808 s | 0.108240 s | -2.30% |
| all | dealer first | 2.069989 s | 1.829762 s | 11.61% |
| all | dealer later | 0.025269 s | 0.025677 s | -1.61% |
| validation | pone first | 10.659866 s | 9.849633 s | 7.60% |
| validation | pone later | 0.127347 s | 0.129994 s | -2.08% |
| validation | dealer first | 2.126260 s | 1.871863 s | 11.96% |
| validation | dealer later | 0.020995 s | 0.022029 s | -4.93% |

The two execution orders reduced combined first-decision CPU by 7.13% and 7.25%. Later fixture decisions averaged 2.43 ms more CPU as pone and 0.41 ms more as dealer, so this is not a speedup on every position. The independent whole-hand sample below showed a clear net benefit, including later decisions.

Three complete hands, including a close race, each repeated twice:

| Role | Measure | Reference mean CPU | Batched mean CPU | CPU reduction |
| --- | --- | ---: | ---: | ---: |
| pone | first | 11.218686 s | 10.598697 s | 5.53% |
| pone | whole-hand pegging | 11.404241 s | 10.775346 s | 5.51% |
| dealer | first | 1.575808 s | 1.382450 s | 12.27% |
| dealer | whole-hand pegging | 1.602232 s | 1.409393 s | 12.04% |

Combined whole-hand pegging CPU fell from 78.038842 to 73.108437 seconds across the six runs (6.32%). Every paired full-hand run improved. These are measured whole-hand totals, not extrapolations from partial-hand fixtures, and are a small controlled sample rather than population-wide game timing or a new benchmark ETA.

Maximum sampled **post-decision** RSS was 56,160 KiB for the reference and 54,320 KiB for the candidate. These samples do not measure true peak RSS. The temporary weight matrix is bounded by the batch and evidence population; 32 lanes over the normal 1,820 four-card rank hands occupy 455 KiB, with no increase to persistent memo limits.

## Artifacts and scope

`/private/tmp/cribbage-203-posterior-batch` retains the isolated prototypes, source hashes, screen results, final baseline/candidate PGO build receipts, profiles and binaries, paired decision/hand outputs, and reproducible setup/build/comparison scripts. `pgo-job-v1.json` completed all three supervised stages. `pgo-summary.json` contains the final measured aggregates.

The research working tree contains the three engine-file changes and their tests. No 10,000-game benchmark restart, model promotion, or production deployment is part of this posterior-batching assessment. The previously authorized production PGO deployment is an independent background job.
