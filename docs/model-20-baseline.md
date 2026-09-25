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
The frozen discard correction asset is unchanged and has not been rebuilt to
forecast the new live policy.
