# Ras Table 2.0

Rank-table discard model using Ras crib values.

- Discard logic: evaluates hand expectation over cuts and combines it with rank-based Ras crib tables.
- Crib logic: uses separate own-crib and opponent-crib Ras tables.
- Pegging logic: uses the base pegging behavior, without exhaustive pegging or peg-table discard EV.

Improvement over prior model: replaces slower crib simulation with a consistent crib table that separates own crib from opponent crib.
