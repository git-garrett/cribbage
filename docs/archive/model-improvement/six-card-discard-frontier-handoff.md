# Archived: Six-Card Discard Frontier Handoff

> Historical handoff and calibration record. The active execution plan is
> [`docs/model-13.2-strategy-fusion-plan.md`](../../model-13.2-strategy-fusion-plan.md).

## Current Goal

We are trying to replace the flawed model-wide `frontier:N` discard/crib logic with a local six-card discard-decision system.

Target model number: `schell_table-peg_table-14.7`.

The intended model behavior:

- For the actual six-card hand and role, evaluate the local discard candidates.
- Preserve the relationship between own hand score, opponent hand score, crib score, cut rank, and pegging outcome.
- Score each local candidate against the current board position by win probability.
- When modeling opponent decisions, choose from the opponent's perspective, not our own.

The main plan is in:

- `docs/archive/model-improvement/six-card-discard-frontier-plan.md`

This handoff file summarizes what has actually been built and what the calibration showed.

## Files Added So Far

### Builder

`scripts/build-six-card-discard-frontier-table.cjs`

Purpose:

- Builds validation JSON rows keyed by six-card rank hand and role.
- Each row stores local discard candidates.
- Each candidate stores joint outcome rows:
  `[cutRank, leadRankOrMinusOne, ownHandScore, opponentHandScore, cribScore, ownPegging, opponentPegging, weight]`

Restart behavior:

- Complete root checkpoints.
- Complete discard-candidate checkpoints inside a root.
- Active-candidate partial checkpoints every N opponent hands.
- Long calibration runs should be started with `screen -dmS ...` so they survive Codex crashes.

Current limitations:

- Opponent discard distribution is deterministic rank-only board-neutral 13.0-style EV selection.
- Suit-shape aggregation has not been implemented.
- Hand and crib scores are rank-only in the validation artifact.
- Pegging outcomes use the configured pairwise pegging table; default is the 12.0/13.0 discard-layer table.

### Packer

`scripts/pack-six-card-discard-frontier-table.cjs`

Purpose:

- Packs validation JSON into a compact binary.
- Current binary magic is `D6F2`.
- Stores shared 7-field outcome tuples once.
- Candidate distributions reference tuple IDs with weights.
- Also deduplicates whole candidate outcome blocks when identical blocks exist.

Current finding:

- Whole candidate block dedupe did not help in the sampled artifacts because every candidate block was unique.
- Tuple dedupe helped modestly but does not solve the artifact-size problem.

### Compact Opponent Discard Policy

`scripts/build-six-card-discard-policy-table.cjs`

Purpose:

- Builds the compact Step 1 table:
  `six-card rank hand + role -> discard-rank histogram`.
- Current policy matches the previous calibration builder's deterministic
  rank-only board-neutral model-13-style choice:
  hand EV plus crib EV as dealer, or hand EV minus opponent crib EV as pone.
- Writes a binary model asset plus a manifest:
  - `web/src/models/rank-crib-discard/six-card-discard-policy.bin`
  - `web/src/models/rank-crib-discard/six-card-discard-policy.manifest.json`
- Writes progress/restart files while running:
  - `web/src/models/rank-crib-discard/six-card-discard-policy.status.json`
  - `web/src/models/rank-crib-discard/six-card-discard-policy.checkpoint.json`

Current output:

- 36,790 role/hand roots.
- 36,790 policy records.
- One weight-1 discard pair per root.
- Binary format magic: `D6P1`.
- Full binary size: 431 KB.
- Manifest size: 384 KB.
- Full build time in this run: 69.655 seconds.

### Componentized Reconstruction Prototype

`scripts/prototype-six-card-discard-reconstruction.cjs`

Purpose:

- Reconstructs local discard-candidate outcome rows for one six-card rank hand
  and role without reading or building the fully joined table.
- Uses:
  - compact six-card discard policy table for opponent discard choices
  - existing `hand-rank-score-by-keep-cut.json` for own and opponent hand scores
  - exact live rank-only crib scoring from own discard + opponent discard + cut
  - existing 12.0 pairwise pegging table for keep-vs-keep pegging outcomes
- Stores summaries and sample rows by default. Use `--write-outcomes` only for
  explicit inspection because full per-hand JSON can get large.

Measured prototype runs for `A 2 3 4 5 6`:

| Role | Opponent cap | Candidates | Outcome rows | Runtime | Output |
| --- | ---: | ---: | ---: | ---: | --- |
| dealer | 200 | 15 | 5,802 | 0.134s | `benchmarks/discard-frontier/six-card-reconstruction-prototype/reconstruction-dealer-a23456-cap200.json` |
| dealer | none | 15 | 264,552 | 6.935s | `benchmarks/discard-frontier/six-card-reconstruction-prototype/reconstruction-dealer-a23456-full.json` |
| pone | none | 15 | 1,127,659 | 10.738s | `benchmarks/discard-frontier/six-card-reconstruction-prototype/reconstruction-pone-a23456-full.json` |

The pone reconstruction is larger because lead rank is preserved as a decision
dimension. It is not a randomized lead distribution.

### Model Number

The latest registered runtime model is `schell_table-peg_table-14.6`.
This six-card componentized discard work is assigned to
`schell_table-peg_table-14.7`.

`web/src/models/schell_table-peg_table-14.7/model.md` documents 14.7 as the
componentized six-card discard model. Runtime discard selection is now wired
and 14.7 is registered as a selectable opponent.

## Calibration Runs

Generated artifacts are under `benchmarks/discard-frontier/` and appear to be ignored by git.

| Run | Roots | Opponent cap | Candidates | Outcome rows / refs | JSON size | Packed binary |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `six-card-sampled-10` | 10 | 25 | 41 | 7,448 | 1.35 MB | not packed |
| `six-card-sampled-10x100` | 10 | 100 | 41 | 18,585 | 3.35 MB | not packed |
| `six-card-sampled-10x500` | 10 | 500 | 41 | 40,118 | 7.58 MB | 0.40 MB after D6F2 tuple dedupe |
| `six-card-mid-10x500` | 10 | 500 | 79 | 88,216 | 16.64 MB | 0.91 MB after D6F2 tuple dedupe |

There are:

- 18,395 six-card rank hands.
- 36,790 role/hand roots.

Compatible opponent six-card rank hand counts:

- First 10 roots average 14,003 compatible opponent rank hands.
- Mid sample starting at root 10,000 averages 16,316.5 compatible opponent rank hands.

Implication:

- The fully joined artifact is too large in this shape.
- Even with binary packing and tuple dedupe, capped samples project into multi-GB territory before uncapping the opponent-hand space.
- Building the full joined table is not currently recommended.

## Important Design Conclusion

Whole-distribution dedupe is not enough.

Measured on samples:

- `six-card-sampled-10x500`: 41 candidates, 41 unique candidate blocks.
- `six-card-mid-10x500`: 79 candidates, 79 unique candidate blocks.

Tuple dedupe helps:

- `six-card-sampled-10x500`: 40,118 refs, 9,594 unique tuples.
- `six-card-mid-10x500`: 88,216 refs, 24,795 unique tuples.

But tuple dedupe still leaves the joined table too large at full scale.

The better next architecture is componentized reconstruction:

- Use the existing keep+cut hand score table for own and opponent hand scores.
- Compute exact rank-only crib score from own discard, opponent discard, and cut, or store a small exact discard-pair + discard-pair + cut crib score table.
- Reuse existing pairwise pegging tables for keep-vs-keep pegging outcomes.
- Build and ship a compact Step 1 six-card opponent discard-policy table:
  `six-card rank hand + role -> discard-rank histogram`
- Reconstruct candidate outcome distributions at runtime or in a memoized precompute step from these component tables.

This avoids storing every fully joined own-hand/opponent-hand/crib/pegging/cut outcome row.

## Current Worktree State

Known git-visible changes after the compact-table continuation:

- `docs/archive/model-improvement/six-card-discard-frontier-plan.md`
- `docs/archive/model-improvement/six-card-discard-frontier-handoff.md`
- `scripts/build-six-card-discard-frontier-table.cjs`
- `scripts/pack-six-card-discard-frontier-table.cjs`
- `scripts/lib/six-card-rank-utils.cjs`
- `scripts/build-six-card-discard-policy-table.cjs`
- `scripts/prototype-six-card-discard-reconstruction.cjs`
- `web/src/models/schell_table-peg_table-14.7/model.md`
- `web/src/models/rank-crib-discard/six-card-discard-policy.bin`
- `web/src/models/rank-crib-discard/six-card-discard-policy.manifest.json`
- `.gitignore` entries for transient rank-crib-discard `*.checkpoint.json`
  and `*.status.json` files

Present but git-ignored progress files from the compact policy build:

- `web/src/models/rank-crib-discard/six-card-discard-policy.checkpoint.json`
- `web/src/models/rank-crib-discard/six-card-discard-policy.status.json`

The compact policy build was launched with `scripts/launch-background.cjs` because
this sandbox's `screen` could not exec `node`. The build completed. No full
joined six-card frontier builder was started.

## Runtime Wiring Completed

14.7 now uses componentized reconstruction in-engine:

- The `Opponent` union, engine label, model docs, analytics sort order, and full
  app model picker include `schell_table-peg_table-14.7`.
- The compact `D6P1` six-card discard-policy asset is loaded alongside the
  existing 13.0 hold/lead tables and 12.0 pairwise pegging table.
- `analyzeDiscardChoice` routes 14.7 to a local six-card evaluator when game
  context is available.
- The local evaluator enumerates actual discard candidates, compatible opponent
  six-card rank hands, compact opponent discard choices, cut ranks, exact
  rank-only crib score, expected suit bonuses, and pairwise pegging outcomes.
- Candidate choice is by current-board win probability with point EV as the
  tie-breaker.

## Verification Completed

After wiring 14.7:

- `node --check` passed for all new six-card builder/prototype scripts.
- `npm run typecheck` passed.
- `npm test` passed: 28 tests.
- `npm run build` passed and `scripts/check-client-artifacts.cjs` confirmed no
  protected model artifacts were emitted into the client build.
- `npm run build:server` passed.
- `npm run package:server` passed and `scripts/check-server-package.cjs`
  confirmed `web/src/models/rank-crib-discard/six-card-discard-policy.bin` is
  included in the server archive.

A one-game 14.7-vs-14.6 AI smoke was launched under
`scripts/launch-background.cjs`, but it did not complete promptly because it
spends time in the known slow componentized reconstruction path. The smoke was
terminated and should be rerun after the planned performance pass.

## Recommended Next Steps

1. Do not start a full joined-table build.
2. Optimize runtime reconstruction and memoize reusable intermediates.
3. Validate more reconstructed rows against the older capped joined-table builder
   for sampled roots.
4. Decide whether crib score should stay live or be stored as a small exact table keyed by:
   `ownDiscardPair + opponentDiscardPair + cutRank`.
5. Add suit-shape handling after the rank-only reconstruction is validated.
6. Run larger AI-vs-AI smoke and benchmark comparisons after the performance
   pass.

## Useful Commands

Syntax checks:

```bash
node --check scripts/build-six-card-discard-frontier-table.cjs
node --check scripts/pack-six-card-discard-frontier-table.cjs
node --check scripts/lib/six-card-rank-utils.cjs
node --check scripts/build-six-card-discard-policy-table.cjs
node --check scripts/prototype-six-card-discard-reconstruction.cjs
```

Compact policy table smoke:

```bash
node scripts/build-six-card-discard-policy-table.cjs \
  --output benchmarks/discard-frontier/six-card-policy-smoke/six-card-discard-policy.bin \
  --checkpoint-interval 5 \
  --limit 20 \
  --memo-limit 50000 \
  --no-resume
```

Full compact policy table build:

```bash
/usr/local/bin/node scripts/launch-background.cjs sixcard-policy-full -- \
  /usr/local/bin/node scripts/build-six-card-discard-policy-table.cjs \
  --output web/src/models/rank-crib-discard/six-card-discard-policy.bin \
  --checkpoint-interval 250 \
  --memo-limit 200000
```

Componentized reconstruction prototype:

```bash
node scripts/prototype-six-card-discard-reconstruction.cjs \
  --role dealer \
  --hand "A 2 3 4 5 6" \
  --output benchmarks/discard-frontier/six-card-reconstruction-prototype/reconstruction-dealer-a23456-full.json
```

Small builder smoke:

```bash
node scripts/build-six-card-discard-frontier-table.cjs \
  --out-dir benchmarks/discard-frontier/six-card-active-partial-smoke \
  --limit 1 \
  --workers 1 \
  --old-mb 512 \
  --memo-limit 10000 \
  --max-opponent-hands 4 \
  --partial-opponent-interval 2
```

Detached sampled calibration pattern:

```bash
screen -dmS sixcard-sampled-10x500 \
  node scripts/build-six-card-discard-frontier-table.cjs \
  --out-dir benchmarks/discard-frontier/six-card-sampled-10x500 \
  --limit 10 \
  --workers 2 \
  --old-mb 1536 \
  --memo-limit 200000 \
  --max-opponent-hands 500 \
  --partial-opponent-interval 25
```

Pack validation JSON:

```bash
node scripts/pack-six-card-discard-frontier-table.cjs \
  --input benchmarks/discard-frontier/six-card-mid-10x500/six-card-discard-frontier.json
```
