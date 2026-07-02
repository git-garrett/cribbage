# Schell Table + Peg Table 14.8

14.8 is the empirical discard/keep reconstruction model.

It keeps the 14.x current-board win-probability discard objective, but replaces
14.7's opponent six-card-hand enumeration with compact empirical role tables:

- empirical opponent discard rank-pair frequencies by role
- empirical opponent four-card keep frequencies by role
- empirical suited-discard rates by role and rank pair

The artifact is:

- `web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json`

## Discard Evaluation

For the actual six-card hand, 14.8 evaluates all 15 two-card discard candidates.
For each candidate and cut rank, it combines:

- the model's rank-only four-card keep score plus exact weighted suit outcomes
- empirical opponent discard-pair crib outcomes
- empirical opponent keep hand-score outcomes
- pairwise keep-vs-keep pegging outcomes

Empirical discard and keep frequencies are adjusted at runtime for known dead
cards using rank-combination availability scaling.

## Suit Handling

14.8 keeps rank-only scoring as the base cut-card analysis. Flush and right-jack
effects are not averaged into fractional scores; they are represented as integer
score outcomes with probabilities carried in the outcome weights.

Crib flush probability uses empirical suited-discard rates rather than the
purely combinatorial opponent-suit expectation used by 14.7.

Dominated score states are not pruned before win-probability calculation because
they still carry probability mass. Duplicate rounded score states are collapsed
before lookup instead.

## Selection

Each discard candidate is scored against the current board position. The model
chooses the candidate with the highest win probability, with point EV used only
as the tie-breaker.
