# Ras Table + Peg Table 4.0

Ras discard table model with peg-table discard EV.

- Discard logic: combines expected hand score, Ras crib table EV, and peg-table EV for the kept four-card hand.
- Crib logic: uses Ras own/opponent crib tables.
- Pegging logic: uses the peg table where available and exhaustive pegging behavior elsewhere.

Improvement over prior model: discard choices begin accounting for the expected pegging value of the retained hand, not just hand and crib value.
