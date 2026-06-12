# Schell Table + Peg Table 7.0

Schell 5.0 peg-table model with a suited-crib flush pass.

- Discard logic: same as 5.0, plus a crib flush adjustment when the two discarded cards are suited.
- Crib logic: starts with the Schell own/opponent crib table, then adds `5 * P(two crib cards and cut match the discard suit)`.
- Pegging logic: uses the 5.0 peg table.

Improvement over prior model: accounts for the extra crib-flush upside of suited discards to own crib and the matching downside of feeding suited discards to the opponent crib.
