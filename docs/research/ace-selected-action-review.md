# Production Ace selected-action review

This is a focused backport of the review optimization in research commit
`89d4ed8`, based on production `30f8421`. The production Ace model remains 13.23;
model assets, ordinary recommendations, and the deployment workflow are unchanged.

## Release requirements

The requested optimization must save work during normal gameplay, retain the
selected action's complete valuation even when inferior, preserve recommendations
and EV/WP values, and avoid promoting the unreleased 20.x models.

Human plays trigger `storeLiveDecisionReview` in the browser, followed by
`/api/game/review` and `review_peg_for_side_with_recommendation`. These same paths
serve post-game backfill. Saved recommendations that match the selected physical
card already skip calculation. Other selected cards previously caused a full
forecast of every legal rank before filtering to that card. Without a saved
recommendation, the engine then calculated the recommendation separately.

The optimized selected-only path forecasts just the requested rank. When both
values are required, one complete forecast supplies the selected value and
recommendation, sharing world construction, policy memoization, terminal
histograms, and the counting evaluator. There is no choice pruning of inferior
selected actions, no additional persistent cache, and no policy change.

## Verification

Native regression tests compare full and selected forecasts bin-for-bin and
bit-for-bit, prove other roots are skipped, and compare combined reviews to the
ordinary recommendation. Coverage includes both roles, near-terminal scores,
duplicate ranks with distinct physical cards, and invalid selections/turns.

Production-profile differential workers replay the prior production source and
this backport using identical assets. The release requires exact action/card and
EV/WP agreement. Detailed local assessment artifacts are retained under
`/private/tmp/cribbage-ace-review-release-probe`.

The repository's required Quality check and complete predeploy QA must pass
before production cutover. The standard deployment performs native Linux
compilation, health and client-cache checks, and automatic rollback on failure.
