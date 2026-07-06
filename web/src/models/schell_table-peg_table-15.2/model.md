# Schell Table + Peg Table 15.2

15.2 is the Rust strength model based on 15.1 with targeted speed
optimizations in the future board and pegging evaluators.

## Future Board Evaluation

15.2 keeps the 15.1 rule for simultaneous future pegging terminals: if both
players can cross 121 inside the same aggregate pone/dealer pegging block, the
double-out outcome is scored as indeterminate at 50/50.

Unlike 15.1, 15.2 only pays for the joint pegging cross product when that
simultaneous terminal ambiguity is possible. If the current board position
cannot let both players cross 121 during the aggregate pegging block, it falls
back to normal sequential phase evaluation.

## Engine Optimizations

The Rust implementation also:

- precomputes static board score distributions once per process;
- stores board win-probability memo states in indexed arrays instead of hash
  maps;
- packs pegging simulation memo keys into fixed integer fields;
- lazy-loads model artifacts only when a model path needs them.

These changes are intended to preserve gameplay relative to the 15.1 logic
except for the exact-gated pegging ambiguity behavior.
