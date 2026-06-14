# Schell Table + Peg Table 10.0

10.0 keeps the 9.0 discard model and changes exhaustive pegging decisions to value board position, not just immediate pegging expected value.

Discarding still uses the Schell discard table, peg table iteration 2, the static crib flush bonus table, and the empirical remaining-hand distribution from 9.0. These discard choices still fall back to EV because we do not yet have a joint outcome distribution that covers hand, crib, pegging, and board-position win probability by discard.

Pegging still enumerates possible opponent rank holdings using the 9.0 empirical remaining-hand distribution. For each legal play, 10.0 builds a weighted distribution of possible pegging outcomes for both players, then scores those outcomes by approximate win probability from the resulting board positions.

The win-probability estimate uses the flush-aware board-position artifact generated from model 7.0+ game logs. It models future pone pegging, dealer pegging, pone hand, dealer hand, and crib phases with average and variance rather than a single par expectation.

Known gaps to improve next:

- Discard decisions still use EV because the model lacks discard-conditioned joint outcome histograms.
- Future board-position scoring currently uses phase-level score distributions, not exact conditional histograms by discard, played-card prefix, board score, or known cards.
- The phase model treats future scoring phases independently, so it does not yet preserve covariance between pegging, hand, and crib scores from the same deal.
