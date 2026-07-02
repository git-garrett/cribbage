# Schell Table + Peg Table 14.8.1

14.8.1 is the empirical discard/keep reconstruction model with exact
suit-aware discard-candidate grouping.

It keeps 14.8's empirical role tables:

- empirical opponent discard rank-pair frequencies by role
- empirical opponent four-card keep frequencies by role
- empirical suited-discard rates by role and rank pair

The artifact is shared with 14.8:

- `web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json`

## Discard Evaluation

For the actual six-card hand, 14.8.1 first groups physical two-card discard
candidates that have identical evaluator inputs and score-outcome distributions.
The grouping is suit-aware, so flush and right-jack differences remain separate.

For each grouped candidate and cut rank, it combines:

- the model's rank-only four-card keep score plus exact weighted suit outcomes
- empirical opponent discard-pair crib outcomes
- empirical opponent keep hand-score outcomes
- pairwise keep-vs-keep pegging outcomes

Empirical discard and keep frequencies are adjusted at runtime for known dead
cards using rank-combination availability scaling.

## Suit Handling

Rank scoring is the base cut-card analysis. Flush and right-jack effects are
represented as integer score outcomes with probabilities carried in the outcome
weights.

Crib flush probability uses empirical suited-discard rates rather than the
purely combinatorial opponent-suit expectation used by 14.7.

## Selection

Each grouped discard candidate is scored against the current board position.
The model chooses the candidate with the highest win probability, with point EV
used only as the tie-breaker.
