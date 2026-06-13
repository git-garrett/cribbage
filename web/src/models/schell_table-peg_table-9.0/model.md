# Schell Table + Peg Table 9.0

Schell 8.0 suited-crib model with empirical opponent-holding probabilities for pegging analysis.

- Discard logic: same as 8.0, combining hand EV, Schell crib EV, iteration 2 peg-table EV, and the static suited crib-flush lookup.
- Crib logic: same as 8.0, applying the model-owned suited-discard flush lookup.
- Pegging logic: uses exhaustive pegging analysis, but reweights possible opponent hands with the empirical hold table when the opponent has already played one to three cards in the current pegging hand.
- Hold table source: compact games between 7.0 and 8.0 models using flush-aware discard logic. Prefixes are unordered rank multisets by opponent role.

Improvement over prior model: keeps the 8.0 discard/crib/peg-table structure and replaces purely combinatorial opponent-hand assumptions during pegging with observed holding probabilities from model-vs-model game logs.
