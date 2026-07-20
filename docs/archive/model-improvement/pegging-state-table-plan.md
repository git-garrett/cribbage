# Archived: Pegging State Table Plan

> Historical design and calibration record. The active execution plan is
> [`docs/model-improvement-roadmap.md`](../../model-improvement-roadmap.md).
> The unshippable full-state graph below is not an active implementation path.

Goal: replace static keep-vs-keep pegging approximations with a compact rank-only pegging scoring-event graph that lets the app evaluate future board-position outcomes without storing every intermediate non-scoring state.

## App Runtime Approach

1. Build the visible state from the current game: starting rank keeps, played ranks, current stack, go/pass markers, role, and board scores. Current count and remaining cards are derived from the encoded sequence.
2. Enumerate possible opponent remaining rank holdings from known-card constraints, excluding our cards, the cut card, crib/discard cards when known, and all already played cards.
3. For each candidate opponent holding, find the last reached scoring-event node and retain the set of encoded future paths that remain compatible with the actual non-scoring plays seen since that node.
4. For each legal candidate play, filter those paths to the branches beginning with that play. If the play does not score, continue looking forward through compatible paths until their next scoring event.
5. Convert each reachable next scoring event into paired board-position deltas and evaluate win probability using the board-position model.
6. Choose the play whose compatible future scoring-event constellation has the highest weighted expected win probability. After the opponent acts, cull paths precluded by the opponent's actual play and repeat until another scoring node is reached.

## Table Shape

The table should be binary and rank-only. It should store scoring-event nodes and compact path edges between them, not every non-scoring decision state.

- Root records: valid rank-only 4-card keep pair, role/perspective, and root scoring-event node.
- Scoring-event node records: pair id, encoded played sequence from the start of pegging or from a compact path store, and outgoing edge range. A scoring event becomes a node only when it is followed by multiple legal playable ranks.
- Edge records: compact encoded sequence from one stored node to the next stored node or terminal. Edges carry an ordered list of scoring checkpoints that occur along the collapsed path, because any checkpoint can end the game depending on board score.
- Terminal scoring events are stored as scoring checkpoints on terminal edges. A separate terminal node is redundant.
- Path storage: rank plays and go/reset markers packed into 4-bit symbols where possible, with overflow bytes only for rare longer paths.

The table stores future scoring pathways, not fixed best moves. Optimal play depends on the current board score. The app evaluates compatible scoring pathways dynamically, using actual non-scoring plays to prune branches between scoring events.

## Builder Requirements

- Generate every legal pegging line reachable from every valid rank-only 4-card keep pair.
- Emit root nodes and scoring-event nodes only when the scoring event is followed by multiple legal playable ranks. Do not emit non-scoring decision states or forced-continuation scoring states.
- Collapse every path segment between stored nodes into a compact encoded edge with ordered scoring checkpoints.
- Deduplicate scoring-event nodes by pair id and encoded sequence.
- Emit compact binary artifacts and a manifest.
- Checkpoint by keep-pair ranges so interruptions do not lose completed shards.
- Support calibration runs with configurable worker count, keep limit, and memo/cache size.
- Validate scoring against existing pegging rules.

## Caveats

- The first version is rank-only. Suit information only enters through known-card filtering before rank counts are constructed.
- Non-scoring decision states are intentionally not stored. The runtime keeps all compatible edges from the last scoring event, chooses among legal first symbols, and prunes incompatible branches after each actual play.
- Equal weighting of all legal future branches is not used for play decisions; the app evaluates the weighted compatible scoring-event constellation from the current board position.
- The builder table is a substrate for model 13.0 or later, not a finished app decision layer by itself.

## Scoring-Event Compression Rationale

The prior flat state graph stored many redundant fields and many states where no board-position change occurred. In the scoring-event graph:

- Current count is implied by the encoded sequence since the last reset.
- Remaining hands are implied by the starting keeps minus encoded played ranks.
- Last player is implied by the turn/go sequence.
- Non-scoring decisions are not separately stored; their effect is represented by the set of possible future scoring-event edges that remain compatible with the actual sequence.
- Scoring events that have only one legal playable continuation are not separately stored as nodes; they are represented as ordered checkpoints on the collapsed edge.

This should preserve the information needed for win-probability decisions while shrinking the table substantially. The next builder calibration should measure:

- scoring-event node count
- edge count
- average encoded edge length
- path-byte overflow rate
- projected binary size
- runtime branch count from representative mid-pegging positions

## June 16 Scoring-Event Calibration

Implemented `scripts/build-pegging-scoring-event-graph.cjs` to test the scoring-event architecture. It stores roots and branching scoring-event nodes, collapses non-scoring and forced scoring continuations into packed edges, and uses 4-bit symbols for ranks/go/reset.

Calibration results:

- N1, 1 root, 1 worker, 512 MB old-gen, memo 10,000:
  - 82,851 nodes.
  - 80,121 edges.
  - 3,911,328 estimated bytes.
  - 13.131 seconds.
  - Full linear estimate: 150,788,820 nodes, 145,820,220 edges, 7,118,616,960 bytes, 23,898 seconds.
- N2, 2 roots, 1 worker, 1,024 MB old-gen, memo 10,000:
  - 505,211 nodes.
  - 499,025 edges.
  - 24,101,664 estimated bytes.
  - 184.041 seconds.
  - Full linear estimate: 459,742,010 nodes, 454,112,750 edges, 21,932,514,240 bytes, 167,477 seconds.
- N2, 2 roots, 2 workers, 1,024 MB old-gen, memo 10,000:
  - Stopped after it slipped from an expected completion of 2026-06-17T01:11:53Z to 2026-06-17T01:15:13Z with only one of two roots complete. The heavier root dominated wall time, so two workers did not materially change feasibility.

The scoring-event architecture successfully eliminated edge overflow in the samples: every edge fit in 64 bits, with max edge length 10 symbols. However, it did not reduce total projected artifact size enough. The two-root projection is still about 21.9 GB, similar to the flat canonical state graph.

Current conclusion: do not launch the full scoring-event build. The architecture is more elegant and path-packed, but storing all scoring pathways remains too large for app shipment and too slow to build on this laptop. The next compression step must reduce the number of retained paths, not just the bytes per path.

Updated branching-scoring-node calibration:

- Root 0, `K K K K`, 1 worker, 1,024 MB old-gen, memo 10,000:
  - 7,248 nodes.
  - 35,990 edges.
  - 80,121 scoring checkpoints.
  - 84,932 score checkpoints on edges.
  - 1,377,440 estimated bytes.
  - 8.589 seconds.
- Root 1, `Q K K K`, 1 worker, 1,024 MB old-gen, memo 10,000:
  - 45,897 nodes.
  - 211,613 edges.
  - 418,904 scoring checkpoints.
  - 430,658 score checkpoints on edges.
  - 7,902,872 estimated bytes.
  - 109.026 seconds.

This materially improves storage versus storing every scoring event as a node:

- Root 0 fell from 3,911,328 bytes to 1,377,440 bytes.
- Root 1 fell from 20,190,336 bytes to 7,902,872 bytes.

Feasibility remains unresolved pending a less biased spread-out sample. The first two roots vary sharply, so first-N root projection is not reliable.

## Probability-Branch Pegging Graph Plan

Goal: replace exact opponent 4-card keep enumeration with a compact opponent rank-probability model. The player hand remains exact; the opponent side branches over the 13 possible ranks weighted by empirical hold probabilities conditioned on role and the unordered set of opponent cards already played.

### Opponent Hold Table

Extend the existing opponent hold table so it covers opponent played-prefix lengths 0, 1, 2, and 3 for both roles:

- Dealer.
- Pone.

Prefix length 0 gives the prior probability that the opponent holds each rank before the opponent has played any pegging card.

The prefix remains unordered. A bucket should include role, unordered played prefix, rank probabilities, and sample count.

### Known-Card Adjustment

At runtime, adjust rank probabilities for known dead cards that are not already represented by the played-prefix bucket:

- Our hand.
- Our played cards.
- Known crib/discard cards.
- Cut card.

Do not separately adjust for opponent played cards; those are already the conditioning prefix for the hold table. There are no exposed-card cases in this app.

For each rank:

```text
availableRankCount = 4 - seenCount[rank]
adjustedProbability = baseProbability * availableRankCount / 4
```

If all four cards of a rank are seen outside the opponent-prefix conditioning, the adjusted probability reaches zero.

When choosing an opponent branch, eliminate ranks that exceed 31, then renormalize across the remaining playable ranks.

### Builder Scope

Build a table for every rank-only 4-card player keep, separately for player-as-dealer and player-as-pone.

Pone table roots:

- Start from each legal player lead rank in the player keep.

Dealer table roots:

- Start from each possible opponent lead rank A-K, weighted by prefix-0 hold probabilities at runtime.

After the root:

- Player turns branch exactly over legal ranks in the known player keep.
- Opponent turns branch over ranks A-K, filtered only by whether the rank can be played without exceeding 31, and weighted by the runtime-adjusted hold table for the opponent's current unordered played prefix.

### Stored Graph Shape

Store:

- Root nodes.
- Scoring nodes only when the scoring event is followed by multiple legal playable ranks.

Collapse:

- Non-scoring states.
- Scoring states with only one legal continuation.
- Forced continuations.

Edges carry:

- Encoded play/go/reset path.
- Ordered scoring deltas along the edge.
- Actor for each path symbol, so runtime can distinguish player actions from opponent probability branches.
- Destination node id or terminal marker.

Scoring deltas must include path offset, scorer, points, score type, and terminal flag where applicable. This preserves peg-out detection before the edge reaches its destination.

### Runtime Engine

At a live pegging position:

1. Identify player role and exact player keep.
2. Find the current root or last reached stored scoring node.
3. Keep the set of compatible live edges from that node.
4. Cull edges incompatible with actual opponent plays.
5. For each legal player candidate play, keep edges beginning with that play.
6. Evaluate ordered scoring deltas along compatible edges against the current board position.
7. Weight opponent-rank branches using the adjusted hold table for the opponent's unordered played prefix.
8. Choose the play with the best expected win probability.

### Feasibility Test Order

1. Update the hold-table script to emit prefix-0 probabilities for dealer and pone.
2. Create a new probability-branch pegging graph builder.
3. Run single-root calibration on representative roots.
4. Run one spread `N=10` root calibration.
5. Stop and evaluate feasibility. Do not proceed to `N=50` or a full build until the `N=10` result is reviewed.

Feasibility checks:

- Projected full artifact size.
- Projected per-keep shard size.
- Lead and dealer-response branch counts.
- Estimated app runtime for lead/response evaluation.
- Builder throughput and expected completion time.

### June 16 Probability-Branch Calibration

Implemented `scripts/build-pegging-probability-branch-graph.cjs`, a calibration builder that keeps the player's 4-card rank keep exact and replaces exact opponent keeps with rank branches weighted at runtime from the opponent hold-probability table.

Also updated `scripts/analyze-pegging-hold-probabilities.cjs` so future hold tables include prefix length 0 for dealer and pone.

Single-root calibration:

- Root 0, `K K K K`: 28 nodes, 7,186 edges, 16,948 scoring checkpoints, 362,337 estimated bytes, 0.381 seconds.
- Root 1, `Q K K K`: 596 nodes, 19,182 edges, 59,729 scoring checkpoints, 1,049,794 estimated bytes, 1.313 seconds.
- Root 500, `4 J Q K`: 2,750 nodes, 69,270 edges, 294,958 scoring checkpoints, 4,223,216 estimated bytes, 12.763 seconds.

Spread `N=10` calibration, 4 workers, 1,024 MB old-gen, memo 10,000:

- 18,587 nodes.
- 690,236 edges.
- 1,882,633 scoring checkpoints.
- 2,067,705 score checkpoints stored on edges.
- 34,711,452 estimated bytes for 10 roots.
- 55.183 seconds.
- Largest sampled keep: `A 3 6 9`, 9,166,353 estimated bytes.
- Full linear projection: 3,382,834 nodes, 125,622,952 edges, 6,317,484,264 estimated bytes, 10,043 seconds.

Conclusion: this architecture is a major improvement over exact opponent-hand/path enumeration, but the full artifact is still too large to ship as a normal app asset. Per-keep shards may be computationally plausible in isolation, but shipping all shards would likely require several GB uncompressed before indexes and production overhead.

### Sequence-Record Architecture Check

The probability-branch graph can be represented more compactly as role-separated sequence records:

- Dealer table.
- Pone table.

This removes role from individual records. It also avoids explanatory string labels such as "player leads A"; production records should store compact symbols only.

Record identity can be:

```text
keepId + encoded full pegging sequence
```

Example shown textually:

```text
A369,A23T9g6ggJJ
```

In production this would be binary symbols, not text:

- A compact keep id, not literal `A369`.
- 5-bit play/go/reset symbols, not literal rank letters.
- Separate dealer/pone files, so no per-record role byte.

The full sequence plus the player's 4-card keep implies the derived state:

- Player remaining ranks.
- Opponent played prefix.
- Current stack and count.
- Turn.
- Go state.

The stack since last reset alone is not enough; the full play/go/reset sequence is required because previous played cards determine remaining cards and opponent prefix.

The sequence-only approach can omit explicit edge records if runtime finds continuations by prefix lookup over sorted sequence records. That means:

- Store branching scoring-node sequences and terminal sequences.
- Build prefix indexes/ranges per keep/table for fast lookup.
- Recompute scoring checkpoints from the encoded sequence at shard-load time or cache them in memory.

Calibration using the same spread `N=10` roots:

- Edge-graph estimate: 34,711,452 bytes for 10 roots, 6,317,484,264 projected full bytes.
- Sequence-only estimate: 19,907,300 bytes for 10 roots, 3,623,128,600 projected full bytes.
- Sequence records in sample: 1,481,376.
- Sequence symbols in sample: 12,890,066.
- Largest sampled root by sequence-only estimate: `A 3 6 9`, 4,648,030 bytes.

Conclusion: sequence records materially reduce storage, but the full artifact still projects to about 3.6 GB before production prefix indexes. This is still too large for normal app shipment. Per-keep lazy shards may be usable on device, but shipping all shards remains the blocker.

## June 16 Calibration

The first implementation tried per-root worker checkpoints. That duplicated shared states heavily and ran out of heap during sample assembly, so the viable builder mode now uses one global canonical graph.

Calibration results:

- 20 roots: 4,907,385 states, 6,472,484 transitions, 189,186,668 byte binary, 30.686 seconds.
- 50 roots, calibration only: 15,509,121 states, 20,686,021 transitions, estimated 599,743,572 byte binary, 59.106 seconds.

Linear projection from the 50-root sample:

- 564,532,004 states.
- 752,971,164 transitions.
- 21,830,666,021 byte uncompressed binary.
- 2,151 seconds of graph traversal, with final output likely adding significant time.

Current conclusion: do not launch the full uncompressed build on the laptop as-is. The projected binary is larger than the free disk space available on June 16 and too large to ship in the app. The next iteration should add a more compact or sharded representation, or narrow the runtime table shape before the full build is started.
