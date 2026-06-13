# Schell Table + Peg Table 8.0

Schell 7.0 suited-crib model using the iteration 2 peg table.

- Discard logic: same as 7.0, combining hand EV, Schell crib EV, iteration 2 peg-table EV, and the static suited crib-flush lookup.
- Crib logic: starts with the Schell own/opponent crib table, then applies the model-owned suited-discard flush lookup.
- Pegging logic: uses exhaustive pegging analysis during play and the iteration 2 peg table during discard evaluation.

Improvement over prior model: keeps the 7.0 suited crib-flush adjustment and swaps in the newer iteration 2 peg-table output for discard pegging EV.
