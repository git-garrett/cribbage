# Schell Table + Peg Table 14.7

14.7 is the componentized six-card discard model.

It avoids the oversized fully joined six-card discard frontier artifact. Instead
the runtime reconstructs each local discard candidate from compact policy and
component tables:

- compact six-card discard-policy table:
  `web/src/models/rank-crib-discard/six-card-discard-policy.bin`
- compact policy manifest:
  `web/src/models/rank-crib-discard/six-card-discard-policy.manifest.json`
- existing rank hand, crib, and pairwise pegging component tables

## Change

14.7 replaces model-wide `frontier:N` discard selection with local six-card
candidate evaluation.

For the actual six-card rank hand and role, the model enumerates legal discard
candidates, reconstructs candidate outcomes from component tables, scores those
local outcomes against the current board position, and chooses the discard from
the decision maker's perspective.

This also fixes the previous modeling issue where opponent future discard
behavior could be selected from our perspective rather than the opponent's.

## Current Artifact State

The compact policy table stores:

- every six-card rank hand
- both roles, dealer and pone
- a discard-rank histogram per root

The initial policy is deterministic rank-only board-neutral model-13-style EV,
so each root currently has one discard pair with weight 1. The binary uses magic
`D6P1`.

Current size:

- 36,790 role/hand roots
- 36,790 records
- 431 KB binary
- 384 KB manifest

## Prototype Measurements

Uncapped reconstruction for `A 2 3 4 5 6`:

| Role | Candidates | Reconstructed rows | Runtime |
| --- | ---: | ---: | ---: |
| dealer | 15 | 264,552 | 6.935s |
| pone | 15 | 1,127,659 | 10.738s |

The pone shape is larger because lead rank is preserved as a decision dimension.

## Runtime Wiring

14.7 is registered as a selectable runtime opponent and loads:

- the 13.0 remaining-hand table
- the 13.0 pone lead table
- the 12.0 pairwise pegging table for keep-vs-keep discard-time pegging
- the compact six-card discard-policy table

The discard decision path evaluates all actual two-card discard candidates,
models compatible opponent six-card rank hands, applies the compact opponent
discard policy, combines hand, crib, cut, and pegging components, and selects by
current-board win probability with point EV as the tie-breaker.

## Follow-up Work

- Optimize runtime reconstruction and memoize reusable intermediates.
- Validate more roots against the capped joined-table builder.
- Decide whether exact crib score should move into a small exact table.
- Add richer suit-shape handling.
- Run larger AI-vs-AI benchmark comparisons.
