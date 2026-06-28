# Schell Table + Peg Table 14.4

14.4 keeps the 14.3 discard and pegging framework, but swaps in bounded on/off supplement tables.

## Discarding

14.4 evaluates three paired strategy families:

- EV crib and EV pegging
- bounded on crib and bounded on pegging
- bounded off crib and bounded off pegging

The on/off supplements are sparse. If an on/off result is identical to EV, or does not meet the two-to-one bounded tradeoff rule, the table omits it and the engine falls back to EV for that row.

## Pegging

14.4 uses the same live model-13 pegging tree for actual pegging decisions. The new pegging table is used for discard-time pegging outcome forecasts and pone lead table shortcuts.

## Purpose

This model tests whether bounded on/off alternatives improve 14.3 by avoiding high-cost point-chasing or point-denial choices.
