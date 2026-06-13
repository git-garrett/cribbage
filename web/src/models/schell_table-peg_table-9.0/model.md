# Schell Table + Peg Table 9.0

Schell 8.0 suited-crib model with empirical opponent remaining-hand distributions for pegging analysis.

- Discard logic: same as 8.0, combining hand EV, Schell crib EV, iteration 2 peg-table EV, and the static suited crib-flush lookup.
- Crib logic: same as 8.0, applying the model-owned suited-discard flush lookup.
- Pegging logic: uses exhaustive pegging analysis, but when the opponent has already played one to three cards in the current pegging hand it uses an empirical distribution of exact remaining rank-count hands for that role and played-card prefix.
- Remaining-hand table source: compact games between 7.0 and 8.0 models using flush-aware discard logic. Prefixes are unordered rank multisets by opponent role.
- Sparse buckets: used directly as observed. The model does not smooth or blend those buckets back toward combinatorial hand weights.

Improvement over prior model: keeps the 8.0 discard/crib/peg-table structure and replaces purely combinatorial opponent-hand assumptions during pegging with observed exact remaining-hand distributions from model-vs-model game logs.
