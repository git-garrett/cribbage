# Schell Table + Peg Table 14.1

14.1 is a correction to 14.0's discard win-probability evaluation.

It reuses 14.0's tripolicy pegging and crib assets:

- EV: both players maximize net pegging points.
- On: the perspective player maximizes own pegging points while the opponent suppresses them.
- Off: the perspective player suppresses opponent pegging points while the opponent maximizes them.

## Discard Evaluation

14.1 keeps 14.0's three-policy discard search, but changes the win-probability forecast so the upcoming count is modeled from known cards rather than only phase averages:

- Own hand is scored from the actual keep and possible cut.
- Opponent hand is modeled from possible four-card keeps, weighted by the empirical prefix-0 hold table and adjusted for known dead cards.
- Crib outcomes use the discard + cut crib table and proportionally reduce opponent discard buckets when known dead cards reduce available suit combinations.
- Later phases still hand off to the board-position phase distributions.

## Pegging

Actual pegging play uses the 14.x live pegging layer:

- It keeps the model-13 exact-hand minimax tree over possible opponent rank hands.
- Unlike historic 13.0, post-pegging win probability uses the current known-card hand/crib context before handing off to future phase distributions.
- It also uses the 14.0 tripolicy lead shortcut for opening pone leads.

## Difference From 14.0

14.0 used the generic hand phase distribution for the opponent's upcoming hand inside discard win-probability analysis. 14.1 uses the known-card opponent-hold model for that upcoming hand and applies more accurate dead-card weighting.
