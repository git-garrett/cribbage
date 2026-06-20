# Schell Table + Peg Table 14.2

14.2 is a test branch from 14.1 that restores the older nine-way discard search.

## Discarding

14.2 uses the same corrected known-card win-probability forecast as 14.1, including:

- known own hand and cut for the upcoming hand count
- opponent upcoming hand estimates from the empirical hold table, adjusted for dead cards
- upcoming crib estimates from known discard, cut, and weighted possible opponent discards
- phase distributions only after the immediate known-card phases

Unlike 14.1, it evaluates all combinations of:

- crib policy: EV, on, off
- pegging policy: EV, on, off

That restores the older nine-way search used before the 14.1 simplification to matching policy pairs.

## Pegging

14.2 uses the same live model-13 pegging tree and tripolicy pegging outcome assets as 14.1. It evaluates pegging decisions by win probability using current board position, known cards, possible opponent holdings, and future phase estimates.

## Purpose

This model is intended to isolate whether narrowing discard evaluation from nine combinations to three combinations caused the 14.x performance decline.
