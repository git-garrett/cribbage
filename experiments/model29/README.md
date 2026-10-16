# Model 29.0: cyclic prior learning

29.0 starts as the native **FP64 28.3 policy with identical assets**. Its canonical
ID is `schell_table-peg_table-29.0`; the parser also accepts `29.0`. Ace remains
28.3.fast. This is an experimental training model, not a production deployment.

## Update schedule

Collect evidence for every prior during every batch, then update **one prior at
a time**: WP → crib discard frequencies → opponent holds → conditional opponent
discards and suits → strategic decline factors → repeat. Both players use one
frozen snapshot throughout each game. Candidate snapshots are immutable and
identified by hashes; an update never writes into 28.3's assets. The next batch
uses an accepted snapshot only after independent evaluation.

This is the initial engineering recommendation, not an experimentally proven
best schedule. Collecting all evidence continuously avoids wasting games.
Separate updates make regressions attributable and keep the values being used
by the policy stable within a batch. They do not guarantee convergence or
monotonic improvement. Alternating evaluation and improvement follows the broad
[policy-iteration idea](https://www.incompleteideas.net/book/bookdraft2018mar21.pdf),
but exact policy-iteration guarantees do not transfer to these approximate
self-play assets. Comparing this schedule against simultaneous batch updates
would be a separate controlled experiment.

The current five mutable priors are updated with FP64 arithmetic and explicit
smoothing mass. That mass is a training parameter, not a claimed historical
sample count. Raw observations and the identity of every included game remain
separate. Each asset has its own consumed-game ledger; rejected candidates do
not consume the accepted lineage's evidence. Historical policy-dependent
observations form a mixture; the initial version does not claim that cumulative
counts estimate only the newest policy, nor introduce an uncalibrated decay rate.

The exact scoring cube and physical card combinatorics stay fixed. The inherited
13.23 discard pegging-outcome asset also stays frozen in this first version:
refreshing those counterfactual forecasts requires deliberately sampled
alternative keeps, not treating the outcome of a chosen keep as evidence for
all rejected keeps. Consequently 29.0 currently learns its five priors, not every
derived forecast in 28.3. `baseline.json` records the inherited provenance,
including the old correction asset's indirect historical decline-factor
dependency. New behavioral data comes only from the frozen, audited 28.3
algorithm; no 15.x/16.x decisions or broad legacy decline counts are imported.

## WP replay and its limits

Each batch includes a complete trajectory from 0–0 until **both** actors reach
121. Replay translates only the initial score across all 14,641 starting boards,
stops each translated game at its first winner, and accumulates the four phase
boundaries visited before that winner. Scoring preserves heels, go, last card,
pone count, dealer count, then crib. Later suffixes are not separately rebased.

28.3 changes actions with board position. A fixed line played from 0–0 is
therefore **not** an unbiased estimate of what 29.0 would play from 115–118.
Post-terminal continuation is synthetic too. This replay estimates a broad
fixed-line prior; direct games from specified board strata also contribute
on-policy observations. That combination remains an approximation, with no
claim that a few games identify all board squares. The pilot exercises both
paths. Only standard-game prefixes contribute behavioral evidence; synthetic
post-terminal choices are excluded.

For smoothing, all visits and both orientations with the same seed supply at
most one effective observation per cell. Transposition never creates thousands
of independent games. `test_learning.py` compares the accumulator against
event-by-event replay at every starting square, including dealer changes.

## Evaluation and publication

Fresh training/evaluation seed intervals are reserved before freezing the run.
Evaluation games never feed learning. Each candidate plays paired seat swaps
against the previous accepted generation and, once those differ, the frozen
baseline. A paired-seed Hoeffding interval controls the predeclared
noninferiority gate with a correction for planned comparisons. An inconclusive
or regressed candidate leaves the accepted snapshot unchanged. This gate can
support noninferiority, not superiority. A stronger-model claim needs an
appropriately powered experiment and a broader opponent panel.

The small pilot uses two update stages, WP then crib, with two training games
per stage and two evaluation seed pairs from late starting boards per reference.
It measures pipeline integrity and speed. Late-board evaluation cannot publish
a stronger model or promote a snapshot as a full-game replacement. The other
three update paths have deterministic isolation/deduplication tests and are
available in the configurable repeated cycle.

## Running

Commit the reviewed source and install the verified 28.3
`model1323-corrections.bin` in the source asset directory. Prepare the pilot:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 experiments/model29/prepare.py \
  '/Users/garrett/Library/Application Support/StrongCribbage/runtimes/model29-pilot-JOB' \
  '/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model29/pilot-JOB'
```

Use `scripts/cribbage_job_queue.py validate` and `install` with its printed
`job.json`. The one-shot stages are build, bootstrap, native baseline parity,
pilot, report, archive, and hash-verified archive validation. CPU leases, frozen
code, assets, executable, supervisor, and checkpoints live on persistent
internal storage. The pilot reserves two CPU workers. Its release build skips
PGO explicitly for diagnostics; its throughput is not production throughput.

The dedicated build enables `model29-training`, which permits manifest-verified
asset hashes and separate per-root caches. Normal builds retain the original
asset pins. 29.0 bypasses opening acceleration assets built for old priors.
No persistent observation-to-action table or pegging-path graph is introduced.

Progress is `cribbage_job_queue.py summary JOB.json`. Resume the **same** spec:
SQLite primary keys and exact request checks preserve completed games even
when workers finish out of order. Each new run needs new reserved seeds.
Training is bounded by `rounds` and `phases`; no recurring automation is installed.

```bash
PYTHONDONTWRITEBYTECODE=1 scripts/run-quiet.sh 'Model 29 learning tests' \
  python3 -m unittest discover -s experiments/model29 -p 'test_*.py'
scripts/run-quiet.sh --show-warnings 'Model 29 native tests' \
  cargo test --manifest-path rust/Cargo.toml -p cribbage-shadow-engine \
  --features model29-training model29 -- --test-threads=1
```
