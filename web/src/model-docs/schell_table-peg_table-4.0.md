# Schell Table + Peg Table 4.0

Schell discard table model with peg-table discard EV.

- Discard logic: combines expected hand score, Schell crib table EV, and peg-table EV for the retained four-card hand.
- Crib logic: uses Schell own/opponent crib tables.
- Pegging logic: uses the first in-app peg table where rows exist and falls back to neutral peg EV for missing discard rows.

Improvement over prior model: discard choices account for retained-hand pegging value using the peg table.
