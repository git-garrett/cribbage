# Schell Table + Peg Table 14.0

14.0 is a discard-evaluation update over 13.0.

It keeps the 13.0 live pegging decision layer: during pegging, it evaluates exact rank-only opponent hands and uses model-13-style minimax over approximate future win probability.

The change is in discard evaluation. Instead of using one net-EV pegging projection, 14.0 uses a compact tripolicy pairwise pegging table. For every discard candidate it evaluates the pegging outcome distribution under three tactical assumptions and chooses the discard/policy combination with the best estimated win probability:

- EV: both players maximize own net pegging points, reused from the 12.0 pairwise table.
- On: the perspective player maximizes own pegging points while the opponent suppresses them.
- Off: the perspective player suppresses opponent pegging points while the opponent maximizes them.

The 14.0 pairwise table:

- covers all 1,820 rank-only four-card keeps;
- covers 3,274,375 valid own-keep/opponent-keep pairs;
- stores dealer outcomes and pone outcomes by lead rank;
- stores all three policy outcomes in a 49-bit packed record format;
- remains rank-only, with suit/flush handling kept in the existing discard and crib layers.

14.0 also adds a tripolicy crib-discard table. During discard evaluation it checks crib outcomes under the same EV/on/off policy set and chooses the pegging-policy plus crib-policy combination with the best estimated win probability. The crib table remains rank-only and the app applies suited crib adjustments at analysis time from the known dead cards.

Other layers are unchanged from 13.0: Schell discard baseline, rank keep + cut hand table, static crib flush bonus, empirical opponent remaining-hand table, and empirical pone lead-frequency ordering.
