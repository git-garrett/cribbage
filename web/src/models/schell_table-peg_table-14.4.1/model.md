# Schell Table + Peg Table 14.4.1

14.4.1 is a controlled variant of 14.4.

It uses the same bounded 14.4 crib and pegging supplement assets, but restores the nine-way discard search used by 14.3.

## Discarding

For each discard candidate, 14.4.1 evaluates every combination of:

- crib policy: EV, bounded on, bounded off
- pegging policy: EV, bounded on, bounded off

That gives nine discard evaluations per candidate instead of the three paired strategy families used by 14.4.

Sparse bounded entries still fall back to EV when the bounded table omits them.

## Pegging

Actual pegging play remains the same live model-13 style pegging tree used by 14.4. The bounded pegging table is used for discard-time pegging forecasts and pone lead shortcuts.

## Purpose

This model tests whether 14.4's bounded on/off assets perform better when crib and pegging strategy choices are allowed to mix independently.
