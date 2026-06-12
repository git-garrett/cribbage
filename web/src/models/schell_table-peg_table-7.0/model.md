# Schell Table + Peg Table 7.0

Schell 6.0 peg-table model with a suited-crib flush pass.

- Discard logic: same as 6.0, plus a crib flush adjustment when the two discarded cards are suited.
- Crib logic: starts with the Schell own/opponent crib table, then adds a static model-owned suited-discard lookup for `5 * P(two crib cards and cut match the discard suit)`.
- Pegging logic: uses the iteration 1 peg table.

Improvement over prior model: keeps the newer iteration 1 peg table and adds the extra crib-flush upside of suited discards to own crib, plus the matching downside of feeding suited discards to the opponent crib.
