# Schell Table + Peg Table 14.3

14.3 is the optimized production branch from 14.2.

## Discarding

14.3 keeps the 14.2 nine-way discard search:

- crib policy: EV, on, off
- pegging policy: EV, on, off

It still uses the 14.x known-card win-probability forecast, including the player's known upcoming hand, opponent hand estimates from the empirical hold table, upcoming crib estimates from the tripolicy crib table, and phase distributions only after those immediate phases.

The change from 14.2 is performance-oriented. During discard win-probability evaluation, 14.3 groups possible cuts by rank and applies expected suit adjustments for flush and knobs effects instead of walking every individual suited cut and every suited opponent-hand instance. That preserves the rank-driven cribbage structure while cutting repeated work.

## Pegging

14.3 uses the same live model-13 pegging tree and tripolicy pegging outcome assets as 14.2. It evaluates pegging decisions by win probability using current board position, known cards, possible opponent holdings, and future phase estimates.

## Purpose

This model tests whether the rank-grouped discard forecast materially improves speed without degrading play quality against 13.0.
