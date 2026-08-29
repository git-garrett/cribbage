# Cribbage Engine

This language describes information-safe pegging evaluation and discard forecasting.

## Language

**Legal observation**:
Everything the acting player may know: its own cards and crib discards, the cut, scores, role, and public pegging history. It excludes the opponent's unrevealed cards and crib discards.

**Executable pegging policy**:
An algorithm that selects an action from the acting player's legal observation and beliefs. It is evaluated when needed rather than serialized over possible observations.
_Avoid_: Policy table, observation table

**Strategy fusion**:
Choosing different actions at indistinguishable information sets because a simulation exposed hidden information.

**Discard pegging forecast**:
The distribution of terminal pegging scores expected after a discard, aggregated over hidden deals and the unknown cut under the specified executable pegging policy.

**Forecast histogram**:
A stored distribution of terminal paired pegging scores for a finite discard context. It contains outcomes, not pegging actions or future paths.
