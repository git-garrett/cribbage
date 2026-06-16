# Schell Table + Peg Table 12.0

Model 12.0 keeps the 11.1 hand, crib, flush, and live pegging logic, but replaces the old peg-table EV used for discard calculations and pone opening leads.

- Discard logic: uses the 11.1 rank keep + cut hand table, crib histogram by discard + cut, and crib flush adjustment. Pegging is now represented by a pairwise binary table of own keep, opponent keep, role, lead, and paired dealer/pone pegging outcomes. At decision time the app dynamically filters and reweights opponent keeps from known cards, then builds a paired pegging histogram for win-probability analysis.
- Pone lead logic: uses the same pairwise table. Each legal first-card rank is dynamically aggregated from possible opponent keeps, then selected by current board-position win probability with net pegging EV as the tie-break.
- Pegging logic after the lead: unchanged from 11.1. The model still uses exhaustive pegging with the empirical remaining-hand distribution where available.
- Improvement over 11.1: the pegging table is generated from keep-vs-keep recursive rank-only pegging outcomes, avoiding the older averaged-continuation peg table that overestimated pone lead EV against tactical dealer responses. Unlike the first 12.0 aggregate table prototype, this version preserves pairwise opponent-keep outcomes so known-card filtering can change the resulting pegging distribution.
