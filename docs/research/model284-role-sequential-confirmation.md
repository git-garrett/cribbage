# Ace 28.4: 10,000-game sequential confirmation

The user authorized a 10,000-game benchmark with early stopping at 95%
confidence. This is a fresh confirmation, separate from the completed
1,024-game pilot. The engine, beliefs, role cutoffs, old discard correction and
opponent remain exactly the validated pilot versions. No model rebuild,
refitting, cutoff search or production activation is part of this run.

- Maximum: **5,000 reciprocal seed pairs / 10,000 games**.
- Freeze a new numeric seed range before play, excluding retained learning,
  selection and pilot seed identities that can be compared numerically.
- Dealer early 0–109 / late 110–120; pone early 0–111 / late 112–120, using
  each player's public score at hand start.
- Candidate `schell_table-peg_table-28.4`, opponent production Ace
  `schell_table-peg_table-28.3.fast`; exact pilot PGO binary and asset hashes.
- Run both orientations concurrently with **three workers each**, six total.
  Alternate initial dealer by game index; use the same seeds in both orientations.
- Finish **100 pairs / 200 games** per batch. Evaluate only after both sides
  have the complete ordered index interval for that checkpoint.
- Stop before another batch if the **anytime-valid 95% confidence sequence**
  for candidate paired win rate lies strictly above or below **50%**. A loss
  boundary stops just as a win boundary does. Otherwise finish 10,000 games and
  report inconclusive if the interval still contains 50%.

Each seed contributes X = 0, 0.5 or 1, the candidate's fraction of wins across
the two reciprocal games. Inference reuses the repository's frozen fixed-bet
mixture in `scripts/benchmark_workbench_stats.py`: bets
`0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.0`, equal mixture weights, threshold
40 per tail (alpha 0.025 each), with outward-rounded bisection endpoints.
[The existing proof and assumptions](../benchmark-workbench.md) describe the
Ville/union-bound guarantee. This is a time-uniform construction inspired by
[Waudby-Smith and Ramdas](https://arxiv.org/abs/2010.09686), not their optimized
adaptive algorithm. No bets or thresholds are fitted to the pilot or new games.

This controls repeated checking for this one frozen matchup under the common
conditional-mean assumption; independent representative seed pairs suffice.
Reproducibility and nonoverlapping numeric seeds do not prove that sampling
assumption. Historical nonnumeric seed identifiers remain a documented limitation.
The ordinary paired-normal and Wilson intervals are retained as descriptive
summaries, clearly labeled as unsuitable for this stopping decision.

The one-shot supervisor has separate preflight, paired-batch, checkpoint,
verification, reporting, archive synchronization and read-only archive-check
stages. After a valid terminal checkpoint, later game stages produce explicit
skip receipts without launching workers. The terminal inference record fixes
the actual contracted count; verification recomputes every checkpoint from the
databases and requires no earlier stop boundary, complete matching index
coverage, correct seeds/engine/binary/belief provenance and database integrity.
The same checks and hashes bind the durable archive.

Interrupted batches preserve all completed out-of-order indices and run only
missing intervals. Interrupted checkpoint publication is idempotent, including
the window after a terminal inference was published but before its supervisor
receipt. A failed stage blocks subsequent work and requires explicit repair;
there is no retry loop and no simultaneous writers to one database.

The runner is `scripts/model284_sequential_stage.py`. Tests cover the pilot's
non-significant confidence sequence, both stopping directions, an inconclusive
cap, missing/mismatched/undecided pairs, terminal-publication interruption,
subsequent stage skips and verified early-stop coverage. The existing confidence
sequence tests exactly enumerate repeated-look null paths and check the
martingale's unit expectation. Reporter tests reject mismatched inference
prefixes and stopping decisions and require the sequential-interval caveat.

## Execution identity

The one-shot job is `ace284-roles-vs-ace-10k-20261127-v1`, rooted at
`/Users/garrett/Library/Application Support/StrongCribbage/runtimes/ace284-roles-vs-ace-10k-20261127-v1`.
It has 105 ordered stages and an explicit persistent supervisor root;
`KeepAlive` is false. Preflight passed and the first paired batch started.

- New numeric seed range: **1865618938–1865623937**, zero overlap with
  50,640 retained numeric seeds, including the pilot and its smoke seed.
- Engine source: `42c86b99b6de3208184e069dc77db427d9cab66c`.
- Runner SHA-256: `29d79f8f55d905947ce6dcaf50e6d2ed902764286ba4e120d5aedd2dc02a02a9`.
- Belief-manifest SHA-256: `0de3b019dfc9fb08fa0d028006d94c382df0d10ba49b7eed252a49cee00ed408`.
- Original orchestration revision: `de9ac484f61c8d818cd13a0904de6d59ed5d7a00`.
- Archival-only patch: `9f974609767a27e0ee1b5fe4087d6cb4374c58b8`, recorded with
  original frozen hashes in `orchestration-patch.json`; it retains and verifies
  the protocol, seed receipt, executable and other copied inputs in the archive.
  It changes no game or inference settings.
- Durable output: `benchmarks/model284/roles-vs-ace-10k-20261127-v1` in the shared
  project checkout. Final verification must bind its actual early-stop or cap
  count to the recomputed terminal confidence sequence and complete indices.

No new confirmation outcome has been used to modify the experiment. The pilot
result and its ordinary fixed-sample interval remain separate.
