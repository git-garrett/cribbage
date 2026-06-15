# Schell Table + Peg Table 11.1

11.1 keeps 11.0's pegging model and changes discard decisions to optimize expected win probability instead of point EV.

Discarding uses:

- Exact rank-only hand scores by four-card keep and cut rank.
- Live suited hand adjustments for flush and right jack.
- A crib score histogram by own discard, role, and cut rank, weighted by the general empirical opponent discard rank frequencies observed in included flush-aware 7.0+ games.
- Live crib suit adjustments computed from the real discard suits, the cut card, and valid opponent discard suit combinations after excluding seen cards.
- The same peg table iteration 2 player and opponent pegging values used by 8.0+.
- The global opponent hand score distribution for the opponent's hand in the current deal.

For each discard candidate, 11.1 maps weighted hand, crib, opponent hand, and pegging outcomes to future board positions, estimates win probability from those positions, and chooses the discard with the highest expected win probability. Point EV remains available for reporting and tie-breaking.

Pegging is unchanged from 11.0: it enumerates possible opponent rank holdings using the empirical remaining-hand distribution, builds a weighted pegging outcome distribution for each legal play, and scores the resulting board positions by approximate win probability.

Known gaps:

- Opponent hand outcomes are global phase distributions, not conditioned on known cards, opponent discard, or cut.
- Pegging inside discard analysis is still represented by expected peg-table shifts rather than a full discard-conditioned pegging distribution.
- Crib rank frequencies are general role-level cribbage data rather than opponent-specific strategy data.
