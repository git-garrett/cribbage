# Schell Table + Peg Table 11.0

11.0 keeps 10.0's win-probability pegging model and changes discard valuation to use cut-joined rank tables.

Discarding uses:

- Exact rank-only hand scores by four-card keep and cut rank.
- Exact rank-only crib scores by own discard, opponent discard, and cut rank, weighted by the general empirical discard frequencies observed in included flush-aware 7.0+ games.
- The same static suited-discard crib flush adjustment used by 7.0+.
- The same peg table iteration 2 discard-pegging values used by 8.0+.

These tables are general role-level cribbage tables. They are not keyed by opponent engine, so future games can improve the empirical discard-frequency table without tailoring the model to one benchmark opponent.

Pegging is unchanged from 10.0: it enumerates possible opponent rank holdings using the empirical remaining-hand distribution, builds a weighted pegging outcome distribution for each legal play, and scores the resulting board positions by approximate win probability.

Known gaps:

- The rank crib table does not yet model crib right-jack value from the unknown opponent discard.
- Crib and hand tables are rank-only; suit-sensitive flush handling remains a simple additive adjustment.
- Discard choices still use EV plus peg-table value rather than a full discard-conditioned win-probability distribution.
