# Six-Card Discard Frontier Plan

## Goal

Build a board-position-agnostic discard-decision artifact keyed by six-card rank hand and role. Runtime will evaluate the local alternatives for the actual hand and choose the discard that maximizes win probability from the correct player's perspective.

This replaces model-wide `frontier:N` policy selection with local candidate evaluation.

Target model number: `schell_table-peg_table-14.7`.

## Core Principles

- A discard decision belongs to the player holding the six-card hand.
- Opponent future decisions must be evaluated from the opponent's perspective.
- Outcome distributions should preserve correlation between own hand, opponent hand, crib, cut, and pegging where practical.
- Rank-only tables should remain board-position agnostic.
- Suit effects should be handled with compact suit-shape cases or runtime adjustments, not by storing all suit permutations.
- Do not prune candidate discards as "never useful" in the initial version.

## Artifact Shape

For each six-card rank hand and role:

- `role = dealer`: crib belongs to the player making the discard.
- `role = pone`: crib belongs to the opponent.
- Store each legal rank-only two-card discard candidate.
- For each candidate, store a joint weighted distribution of outcomes.

Each outcome should preserve enough information to score current-board win probability:

- cut rank
- own hand score
- opponent hand score
- crib score
- own pegging points
- opponent pegging points
- weight

The same table can be used for our discard decisions and for modeled opponent discard decisions by changing the perspective of the win-probability scoring.

## Suit Handling

The artifact remains rank-only.

For discard choices, flush-aware behavior can be represented by suit-shape cases rather than every suit realization:

- whether the candidate discard pair is suited
- whether the four-card keep is suited
- right-jack possibilities by cut suit probability
- crib flush possibility from the two discarded cards plus opponent discard/cut suit cases

Because all suits are symmetric, the table does not need separate hearts/spades/diamonds/clubs realizations. It only needs enough suit-shape information to model suited discard and suited keep effects.

Runtime can apply suit adjustments from the actual cards in hand.

## Step 1: Opponent Discard Distribution Table

Build a helper table for every six-card rank hand and role:

- Input: six-card rank hand, role.
- Output: histogram of rank-only discard pair choices.

The histogram should reflect model-13-style discard behavior in a board-neutral setting. Where suit can affect the model's discard, aggregate by suit-shape cases rather than every literal suit.

This table is used to model what an opponent is likely to discard from a possible six-card hand.

## Step 2: Candidate Outcome Builder

For every six-card rank hand and role:

1. Enumerate each legal rank-only discard candidate.
2. Compute the four-card keep.
3. Build possible opponent six-card rank hands by reweighting the Step 1 distribution according to the six known cards in our hand.
4. For each possible opponent six-card hand:
   - use the Step 1 discard histogram for that opponent role
   - derive opponent discard and opponent keep
5. For each cut rank:
   - score own hand
   - score opponent hand
   - score crib from own discard, opponent discard, and cut
   - attach pegging outcome distribution for own keep vs opponent keep
6. Store the joint weighted outcome distribution.

The builder should avoid treating hand, crib, and pegging as independent marginals when they came from the same opponent six-card hand.

## Step 3: Runtime Logic

Replace global frontier policy loops with local candidate evaluation:

1. Open the table row for the actual six-card rank hand and role.
2. Read the actual discard candidates and their local outcome distributions.
3. Score each candidate distribution against the current board position.
4. If this is our decision, choose the candidate maximizing our win probability.
5. If this is modeling opponent behavior, choose the candidate maximizing opponent win probability.

This resolves the previous issue where the model chose opponent-controlled future behavior in its own favor.

## Step 4: Builder Engineering

The builder should be restartable and checkpointed.

Recommended structure:

- checkpoint by six-card hand and role
- emit periodic status with rows/sec and expected completion time
- support worker count and memory calibration
- emit a large full artifact first
- pack a compact binary artifact only after validation

## Step 5: Validation

Before using the artifact in a model:

- Build a small sample table.
- Compare selected discard decisions against live model-13-style evaluation.
- Verify opponent-mode selection chooses the opponent-favorable discard.
- Verify discard EV calibration is no longer inflated.
- Run a small AI-vs-AI smoke test.
- Then run a larger benchmark.

## Remaining Duplication To-Dos

- Deduplicate identical candidate outcome distributions.
- Deduplicate identical opponent discard histograms.
- Deduplicate pegging histograms reused across many rows.
- Avoid evaluating duplicate suit-shape cases.
- Avoid recomputing suit adjustments that can be derived from the same rank/suit-shape case.

## Calibration Notes

Initial implementation files:

- `scripts/build-six-card-discard-frontier-table.cjs`
- `scripts/pack-six-card-discard-frontier-table.cjs`
- `scripts/build-six-card-discard-policy-table.cjs`
- `scripts/prototype-six-card-discard-reconstruction.cjs`

The builder now checkpoints completed roots, completed discard candidates within a root, and active candidates every N opponent hands. Calibration runs should be launched under `screen` so they survive Codex interruptions.

Early sampled JSON artifacts showed the validation shape is too large to treat JSON as anything beyond an inspection format:

| Run | Roots | Opponent cap | Candidates | Outcome rows | JSON | Packed binary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `six-card-sampled-10` | 10 | 25 | 41 | 7,448 | 1.35 MB | not packed |
| `six-card-sampled-10x100` | 10 | 100 | 41 | 18,585 | 3.35 MB | not packed |
| `six-card-sampled-10x500` | 10 | 500 | 41 | 40,118 | 7.58 MB | 0.48 MB |
| `six-card-mid-10x500` | 10 | 500 | 79 | 88,216 | 16.64 MB | 1.06 MB |

There are 18,395 six-card rank hands, or 36,790 role/hand roots. The first 10 roots average 14,003 compatible opponent six-card rank hands; the mid-root sample starting at root 10,000 averages 16,316.5. Scaling even the 500-opponent capped binary sample across all roots projects to multi-GB artifacts before uncapping the opponent space. The current row shape therefore needs stronger deduplication or a different runtime aggregation design before a full build is practical.

## Componentized Prototype Notes

This work is now assigned to target model `schell_table-peg_table-14.7`.

The compact Step 1 policy table has been built as:

- `web/src/models/rank-crib-discard/six-card-discard-policy.bin`
- `web/src/models/rank-crib-discard/six-card-discard-policy.manifest.json`

The policy binary is 431 KB for all 36,790 role/hand roots. The current table is
deterministic rank-only model-13-style EV, so each root stores one discard pair
with weight 1. The binary format magic is `D6P1`.

The reconstruction prototype uses the compact policy table plus existing
component tables instead of storing all joined outcomes globally. Initial
uncapped timings for `A 2 3 4 5 6`:

| Role | Candidates | Reconstructed rows | Runtime |
| --- | ---: | ---: | ---: |
| dealer | 15 | 264,552 | 6.935s |
| pone | 15 | 1,127,659 | 10.738s |

14.7 now wires this componentized reconstruction into runtime discard
selection:

- 14.7 is a registered/selectable model.
- The compact opponent discard-policy table is loaded as a protected model
  asset.
- Runtime discard analysis enumerates the actual two-card candidates, models
  compatible opponent six-card rank hands, applies the compact opponent policy,
  reconstructs hand/crib/pegging/cut components, and selects by current-board
  win probability.
- Exact rank-only crib score currently remains computed live, with expected
  suit bonuses applied from the actual discard and reconstructed opponent ranks.

Remaining follow-up work is performance engineering, larger validation against
the capped joined builder, and richer suit-shape handling.
