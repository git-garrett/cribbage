# Schell Table + Peg Table 13.0

Experimental pegging model built on 12.0.

## Discard

- Uses the same rank keep + cut hand table and rank discard + cut crib table path as 12.0.
- Uses the same shipped 12.0 pairwise pegging outcome table for discard pegging impact.
- Keeps the static crib flush bonus from the flush-aware line.

## Pegging

- Uses live exact-hand exhaustive pegging evaluation instead of the shipped pairwise lead shortcut.
- Weights possible opponent remaining rank hands with empirical 7.0+ game data, including prefix length 0 before the opponent has played a pegging card.
- Uses win-probability scoring for pegging decisions rather than raw pegging EV when that path is available.

## New Assets

- `pegging-remaining-hand-distribution.json`: empirical opponent remaining-hand distributions for prefix lengths 0, 1, 2, and 3.
- `pone-lead-frequency.json`: empirical pone first-lead frequencies by pone 4-card rank keep. This is included for ordering dealer-side precompute work as the live tree path evolves.

## Difference From 12.0

12.0 relies on a shipped pairwise pegging outcome table for pone leads and discard pegging estimates. 13.0 keeps the 12.0 discard layer but changes actual pegging play to live exact-hand exhaustive analysis, using empirical opponent-hold priors before and during the pegging sequence.
