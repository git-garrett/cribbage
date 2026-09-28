# Selected-action pegging review assessment

Baseline: `30ac2887e610dec630aba268ac550b3a35bcc0eb`, the committed and
pushed cancellation change on `work/model203-forced-choice`.

## Normal use

This saves real gameplay work. `web/src/main.ts` calls `storeLiveDecisionReview`
after ordinary human plays. The `/api/game/review` handler evaluates the saved
decision through `review_peg_for_side_with_recommendation`. The same engine path
serves post-game analysis and backfilling older reviews.

When a matching hint is available, the API stores its recommendation for reuse.
If the player chose that exact physical card, the existing path already completes
the review without any valuation. If the player chose another card, it previously
forecast every legal rank, kept only the selected rank, and discarded the rest.
Without a saved recommendation, it then solved the recommendation separately.
Both situations occur in normal gameplay; hint preparation is asynchronous and
is not required for post-game review.

Current Ace uses 13.23. The shared review implementation also serves 20.0–20.3,
so the optimization benefits current Ace and future 20.3 reviews. Native benchmark
games use `ModelPlayout` and the synchronous frozen decision worker, without this
review path. This is a review optimization, not a benchmark-throughput gain or
a change to Ace's lead-selection algorithm. No benchmark restart was performed.

## Change

- A review with a saved recommendation forecasts only the selected rank.
- A review needing both values forecasts all legal ranks once. The selected
  value and recommendation share the posterior, decision-local policy caches,
  terminal histograms, and counting evaluator.

Every reviewed action keeps its full world population, including an inferior
selected action. World ordering, normalization, histogram summation, WP/EV
arithmetic, rank tie-breaking, and physical-card identity are preserved. The
ordinary bounded recommendation solver is unchanged. The one-legal-card fast
path and matching-saved-recommendation fast path retain their existing behavior.
No persistent action cache or additional speculative analysis was introduced.

## Review timings

Both workers use the production release profile (`codegen-units = 1`, thin LTO),
the same frozen speed-v4 assets, warmed immutable assets, process CPU timing,
and alternating execution order. Historical replay includes both roles and first
and later decisions: six discovery positions plus twelve held-out positions for
20.3, and the six discovery positions for Ace 13.23.

The selected-only rows below include only selections that differ from the saved
recommendation. Matching physical-card selections already avoid calculation and
are excluded from these savings. Totals cover the listed comparison cases, not
an average complete hand or game.

| Model | Review work | Cases | Baseline CPU | Candidate CPU | Reduction |
| --- | --- | ---: | ---: | ---: | ---: |
| 20.3 | Selected card; recommendation saved | 12 | 35.837818 s | 10.737016 s | 70.04% |
| 20.3 | Selected card and recommendation | 18 | 86.637379 s | 42.704397 s | 50.71% |
| Ace 13.23 | Selected card; recommendation saved | 5 | 7.217593 s | 1.090661 s | 84.89% |
| Ace 13.23 | Selected card and recommendation | 6 | 15.104843 s | 7.520149 s | 50.21% |

Across all twelve held-out 20.3 positions, including selections that match the
recommendation, the selected-valuation calculation itself used 66.11% less CPU;
combined reviews used 52.41% less. These are engine measurements, not browser or
network latency estimates. The live matching-recommendation path remains free
of evaluation; the overall gameplay benefit depends on review frequency.

## Ordinary move-selection controls

The first six mixed-harness control decisions were 1.62% slower in aggregate;
the six final-build controls were 1.44% slower. We retained both results and
repeated the two expensive pone openings four times, counterbalancing worker
order. Those eight pairs used 81.180202 s baseline CPU versus 80.738882 s
candidate CPU, a 0.54% reduction. Individual repeats varied from 3.72% faster
to 0.88% slower, with all actions and values exact.

Across all twenty move-selection control pairs, CPU was 126.859146 s versus
127.115692 s, or **0.20% more**. This does not establish a consistent slowdown
at the observed timing variation. It is also not a claimed move-selection
speedup. The direct review savings are much larger than that variation, and
the ordinary bounded move-selection algorithm and calculations are unchanged.

## Verification

- `npm test`: **427 tests passed across 21 targets** on the final source.
- A counting-policy test proves unselected roots are skipped while preserving
  every selected histogram bin and weight bit-for-bit.
- Native tests compare selected and combined reviews with the old full-forecast
  method and the ordinary recommendation, including duplicate ranks, different
  physical cards, both roles, inferior choices, and near-terminal scores.
- **114 initial paired release comparisons**, followed by **66 final paired
  comparisons**, matched physical card, action, and all EV/WP floating-point
  bits exactly. Coverage includes 13.23 and all four 20.x versions. The final
  source additionally preserves the old wrong-player/wrong-turn rejection path.
- Six further baseline comparisons cover one legal card, an illegal selected
  card, and wrong-player/wrong-turn errors; all match exactly.
- The eight repeated move-selection pairs also match exactly: **194 total
  baseline comparisons**, including error cases, with no output differences.

## Artifacts

`/private/tmp/cribbage-203-selected-review` contains the baseline and candidate
workers, production-profile manifest, replay plans and scripts, raw paired
results, source patch, binary/source hashes, and summaries. The reference comes
from the committed cancellation change, isolating this review optimization.
