# Model 20 baseline

`schell_table-peg_table-20.0` started as a behavior-identical copy of production
Ace 13.23 at commit `35fe6f4`. It has its own model ID in the native engine,
benchmark runner, API, and local experimental opponent selector.

The initial version uses the same 13.23 discard, live pegging, and saved-decision
review functions, verified correction asset, board matrix, policy inputs, and
hand-cache/opening-preparation behavior. The existing assets are reused; no
training or asset rebuild is required. Install `model1323-corrections.bin` as
documented in `rust/cribbage-shadow-engine/assets/README.md` before evaluating
discards.

Production Ace remains 13.23. Model 20 is an experimental opponent, so its games
do not count as production Ace games. Future Model 20 strategy changes should
branch at its explicit dispatch paths and preserve the historical 13.23 model.

## Live pegging belief changes

Model 20 now uses the role-specific empirical `model132-keep-prior.json` before
the opponent's first play. This is the unchanged keep prior retained by the
frozen 13.23 offline correction builder, now packaged for live use. It equally
blends normalized Model 9.x, Model 13.x, and human keep frequencies per role;
it therefore includes observed discard selection rather than treating keeps
as random four-card deals. After public opponent plays, Model 20 uses the
existing Model 9.1 empirical remaining-hand rows.

Surviving empirical hands receive a known-card depletion multiplier before
go/decline evidence and normalization:

`product_r C(available[r], remaining[r]) / C(4 - opponentPlayed[r], remaining[r])`

Here `available` excludes the actor's initial keep, own two discards, cut, and
the opponent's public plays. The denominator already excludes those public
opponent cards because the empirical row conditions on them. For a remaining
pair of fives with no public opponent five and two fives otherwise known, the
five-rank multiplier is `C(2,2) / C(4,2) = 1/6`.

These beliefs apply to live candidate forecasts, continuation choices, cached
calculations, and saved-decision review. Missing empirical prefixes still use
physical combination weights; an empty root posterior retains the existing
physical fallback. Ace 13.23 and earlier models retain their original behavior.
The frozen discard-time pegging correction asset is unchanged and has not been rebuilt to
forecast the new live policy.

## Conditional-weight normalization fix

Status: implemented in the correction builder and regression-tested; **not yet
active in gameplay**. Model 20 still loads the frozen `model1323-corrections.bin`.

The historical builder multiplies each opponent keep's prior by its conditional
discard weights. Those discard rows have different totals depending on how many
empirical cohorts supplied observations, unintentionally changing the relative
probability of the keeps. The new `--model20-normalized-discards` build mode
normalizes each physically legal keep/role row to a common integer total of
`1_000_000_000_000` before applying actor-known-card depletion. Conditioning may
then reduce different rows by different amounts; normalizing again after that
step would incorrectly discard this evidence. Largest-remainder rounding gives
exact row totals and fails rather than silently rounding observed support to zero.
This fixes row scaling, not missing empirical support or the continuation objective.

The mode produces joint distributions in a separate `model20-corrections.bin`
with magic `M20DC001`. Historical build modes retain their original behavior,
and checkpoint/resume/merge validation rejects mixed model versions. Manifests
record the normalization convention. Existing runtime readers reject the new
format; activation requires a Model 20 reader/dispatch path and pinned, verified
input checksums after the replacement asset has been built.

The planned batched rebuild must first audit its inherited evidence under
[ADR-0002](adr/0002-exclude-defunct-models-from-learning-data.md). In particular,
the frozen decline factors contain excluded 15.x evidence. The new mode rejects
missing or ineligible decline-factor model attribution before starting work;
that metadata check does not replace an audit of the underlying observations.
Cleaning factors or changing the continuation policy also requires a compatible
Model 9.11 keep-pair baseline. Freeze the audited inputs, run the baseline and
correction builds through the job supervisor, verify the new distributions and
their own moments, and only then activate the replacement for Model 20. The
historical correction build took roughly four days on six workers, excluding
prerequisite work. No replacement build has been queued for this fix yet.

Model 20.0 discard and pegging selection maximize board win probability. Discards
break WP ties by total EV; pegging breaks them by immediate points and rank.
Both the offline builder and live pegging forecasts simulate future choices
with the net-pegging-point `Model911Policy`. At its next actual turn, the playing
engine evaluates the choices again by WP rather than executing the forecast's
continuation choice. Keeping the offline
asset independent of board scores avoids a naive additional `121 × 121` score
dimension, but does not establish that board-aware continuation is infeasible.
A future board-aware policy change must update both its baseline and correction
forecast; it is separate from the conditional normalization fix.

## Model 20.1 live WP continuation

`schell_table-peg_table-20.1` retains the existing EV-built
`model1323-corrections.bin` for discards. The normalized replacement described
above is a separate, pending asset build; the 20.1 benchmark does not claim to
contain that replacement. Live play and saved-decision review now use a WP
continuation chooser for **both** actors at every contested simulated turn.
Model 20.0 and production Ace retain their EV continuation chooser.

The chooser aggregates compatible opponent hands from the acting player's
legal-information posterior before selecting one move. For each candidate it
averages terminal win probabilities over card-order continuations, using the
verified board matrix's after-pegging seam, actual scores, and the acting
player's dealer/pone perspective. It stops scoring at the first player to reach
121. It does not convert mean net points into WP. Exact WP ties use immediate
points and then rank, matching the live selection convention.

This is an approximate executable policy, not a recursive equilibrium solver.
The inner action-value calculation averages legal card choices by remaining
card multiplicity; the outer forecast executes WP-selected actions at every
turn. The inner board seam integrates generic later hand/crib scoring, while
the root move comparison retains the existing known-card show evaluator.
Thus the forecast now models WP-seeking players, but its inner value estimates
are not identical to the full root evaluator. No EV fallback is used for a
contested 20.1 continuation choice. Empty empirical support falls back to
physically compatible hands with the same go/decline evidence.

Action and outcome caches exist only within one decision. Their keys include
board scores and role. Outcomes can be reused across actor discard variants
because only their posterior weights change. Rank worlds remain exhaustive;
only the existing provable WP bound can stop an inferior root candidate early.

The September 25 benchmark compares 20.1 with the **frozen previous benchmark's
20.0 engine and inputs**, revision `1925d15bb13a1c4ac8d39a7d87a6d89b7fc7aeed`.
A streaming adapter is compiled against that frozen source without changing
its model code. The adapter retains hand caching and full EV/WP diagnostics.
Each game records the explicit versioned model IDs; the experiment also pins
both source trees, binaries, asset checksums, and a fresh paired seed range.
This compares the latest 20.1—including the conditional-discard evidence
refresh—with the actual earlier 20.0, not an isolated WP-only ablation.

## Suit-aware show forecasts

Model 20 uses the opponent's role and discard rank pair to read empirical
same-suit rates from `model20-opponent-discards.bin`. Within each rank pair,
the crib forecast allocates that fraction of weight to compatible same-suit
assignments and the rest to different-suit assignments, distributing weight
equally within each group. A missing rank pair uses the role's distinct-rank
suited rate (or its overall suited rate). An impossible group receives no
weight. This matches the 15.2 suit-selection model while retaining Model 20's
existing cut/discard-conditioned crib rank histogram. It applies at discard
time and during live pegging/review; reported discard crib EV uses the same
distribution as win probability.

When choosing discards, Model 20 now conditions `model132-keep-prior.json` on
all six known cards and each possible physical cut. Opponent hand-score
distributions include flushes and nobs using compatible suit assignments.
These use Model 20's existing blended keep prior, rather than substituting
the older keep frequencies also present in the 14.8 asset. Each cut's
distribution is shared across all 15 candidates, and rank scores/weights are
reused across cuts of the same rank. All such reuse is decision-local.

The opponent-hand and crib forecasts remain separate marginal distributions;
this change does not introduce a joint keep/discard model or rebuild the
frozen pegging correction asset. Historical models remain unchanged.

### Performance check

A local optimized Rust test used the installed full correction asset, warm
runtime assets, three timed repetitions per configuration after warm-up, and
rotating configuration order. The six cases cover both roles and opening,
midgame, and near-finish scores. Median milliseconds per complete discard
decision (including conditioned-hand preparation):

| Own/opponent score | Role | Suited rates only | Suited rates + conditioned hands |
|---|---|---:|---:|
| 0 / 0 | Dealer | 191.66 | 211.41 |
| 0 / 0 | Pone | 183.91 | 203.96 |
| 95 / 105 | Dealer | 175.95 | 192.04 |
| 95 / 105 | Pone | 170.33 | 190.89 |
| 118 / 117 | Dealer | 164.94 | 183.02 |
| 118 / 117 | Pone | 168.67 | 183.21 |

The added hand forecast cost was 14.5–20.6 ms (8.6–12.1%) in this sample.
This is a local latency check, not a production timing guarantee or a playing
strength benchmark. Reproduce with the ignored release test
`model::tests::model20_discard_timing`; it writes `model20-discard-timing.json`
to the process temporary directory.

### Asset-list changes

| Asset | Model 20 use | Change |
|---|---|---|
| `model20-opponent-discards.bin` | Conditional opponent discard ranks and same-suit rates by role/rank pair, with role-level fallbacks and original suit counts. | Original 13.22 conditional evidence plus 16,418 newer completed games; unchanged 14.8 suited-discard evidence. See `model-20-opponent-discards.md` for the exact import ledger and coverage. |
| `model132-keep-prior.json` | Blended empirical opponent keeps for opening pegging beliefs and now discard-time hand-score forecasts, conditioned on known cards. | Newly packaged for Model 20 in `e864f47`; reused here, unchanged. |
| `model91-pegging-beliefs.bin` | Empirical remaining hands after opponent plays; the previous change added depletion weighting. | Existing Model 20 dependency; no asset change. |

The suit-aware scoring and depletion multipliers are runtime calculations,
not new learned assets. The existing crib rank-score and crib histogram JSON
files continue to provide the crib rank distributions.

The consolidation changes storage and loading only. Conditional discard weights,
fallback behavior, and historical rounded suit rates are preserved exactly; the
frozen pegging correction asset does not need rebuilding for this migration.
See [the consolidated asset specification](model-20-opponent-discards.md).
