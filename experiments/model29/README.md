# Model 29.0: cyclic prior learning

29.0 starts from the audited FP64 28.3 policy and its immutable assets. This is
an experimental training model; production Ace remains unchanged. PR #78 owns
this work. The October 16 user requests supersede the original transposition
pilot: build now, run ten workers continuously, evaluate 1,000 games against the original
state after every 5,000 training games, show progress on the workbench, and refresh
opening chunks only on misses or at age 50,000 games.

## Cycle and evidence

Play ordinary 0–0 games, stop at the first winner at 121, and collect evidence for
all five priors. Publish one immutable candidate at a time:

1. WP at the start-of-hand/before-discard phase only.
2. Crib discard frequencies.
3. Opponent hold frequencies.
4. Conditional opponent discards and suit rates.
5. Strategic decline factors.
6. Modern discard hand-outcome forecasts, using separate counterfactual sampling.

Repeat. There is no score transposition, artificial continuation, or score-started
training. The other three legacy WP phases remain for format compatibility; normal
28.3 decisions use the start-of-hand phase. Exact card scoring stays fixed.
Each asset has its own consumed-evidence ledger. Seed clusters, not the number
of board cells, determine effective WP observations. Raw observations and prior
smoothing mass remain distinct. Cumulative evidence describes a policy mixture,
not an unbiased estimate of only the latest policy.

The old 9.x-derived correction asset remains the fallback while the sixth phase
adds modern forecasts. Each sampled context is an actual hand and board from
training. For each of 16 fresh legal opponent deals/cuts, the opponent chooses its
own discard using its own legal information, and all 15 candidate keeps play the
hand with the current executable policy. Suit-canonical six, discard, role and
actual board identify a row. Full-hand endpoints retain heels, pegging, counting
order and first-winner stopping. Runtime values these endpoints with the current
WP table, blended with 32 effective observations of the inherited forecast.
Unvisited contexts retain their inherited forecast. This is sparse incremental
coverage, not a claim to have rebuilt the old asset broadly. Shared worlds across
keeps are correlated; raw rollout count is not independent sample count. EV tie
breaking remains inherited; the modern forecast updates win-probability value.

## Opening cache

Completed original-state comparisons retain per-decision EV, win probability,
actor/role/model, legal-choice count and computation time. The workbench reports
EV error (excluding terminal hands), WP calibration/Brier, and discard, opening
and whole-hand pegging timings for both states and orientations. Legacy games
remain explicitly unrecorded; their predictions and timings are not reconstructed.
Each checkpoint has its own confidence intervals because the learned state
changes. The checkpoint-adjusted assessment also accounts for repeated testing.

For an already frozen run, `evaluation_runner.py CONFIG EXTENSION` attaches a
separately pinned recorder at the controller's worker boundary. Training still
uses the original binary, controller, config, assets and cache identity. The
recorder changes only result serialization. A supervised build and
`verify_evaluation_recorder.py UPGRADE_DIRECTORY` require unchanged policy
sources and four matched games against the original binary before sealing the
extension. Resume via a versioned supervisor spec pointing to the same evidence
ledger; never rewrite the original run identity or completed records.

The dedicated training binary permits explicit policy lag. A chunk's computation
records the global completed-full-game count, generation hash and binary identity.
Training and evaluation full games advance the clock; counterfactual hand rollouts
do not. Hits never reset age. At age 50,000 it is unusable; its next use solves
fresh and replaces it. Missing chunks are captured from ordinary public-domain
solves, with private-row calculations kept separate. Atomic files prevent partial
reads; concurrent misses may duplicate a solve but cannot publish partial data.
Code changes invalidate immediately. No early fresh checks and no proactive
refresh run during training. Implementation parity tests before launch are separate.

The staged inherited bank retains its original fingerprint and checksums and is
born at game zero. The local run stages 675,987 existing full chunks plus the remaining 574,013
existing two-reply chunks. Together they retain about 99.5% historical opening
coverage while using about 92 GiB rather than 152 GiB for an all-full bank. Full
chunks cover about 86.6% of historical openings; partial chunks compute later
replies at runtime. Missing contexts build full chunks on demand. Source, binaries, cache, assets,
seeds, databases and supervisor are on persistent internal storage. Production's
exact cache checks are unchanged. See ADR 0001 for the authorized exception.

## Experimental advancement and verification

Both sides use immutable priors during a game. Between phases, validate and seal
one changed asset, then advance the experimental lineage. Every 5,000 training
games, play 1,000 ordinary games on 500 fresh paired seeds against the original
starting state. Evaluation never feeds learning. The original opponent has a
separate opening cache populated only with its frozen starting priors; it never
reads chunks captured under the candidate's learned priors. The candidate keeps
its declared rolling-cache policy. Intervals use a conservative paired-seed bound
with an error budget spread across successive checkpoints. Results are reported;
these comparisons do not silently deploy or promote a model.

Before training: native decision parity, whole-game uncached/captured/replayed/
expired/inherited-cache parity, and captured-chunk equality against the independent
public-domain builder must pass. Every updated asset is sealed and verified.
SQLite identities preserve out-of-order completions on resume. Source, binary,
configuration and seed identity changes reject a resume. Interrupted candidate
writes are retained separately, then rebuilt. Jobs fail closed; there is no retry
loop that hides failures.

## Run and observe

Commit the source and install the audited `model1323-corrections.bin`. The existing
opening bank is staged with `stage_cache.py` under its own one-shot supervisor.
`prepare.py RUNTIME ARCHIVE` freezes a continuous run: 200 normal games per
ordinary asset phase, 12 contexts × 16 worlds × 15 keeps per forecast phase,
and 1,000 original-state evaluation games after each 5,000 training games. Fresh
disjoint seed ranges are reserved for each 5,000-game block, using frozen historical
exclusions and the shared reservation ledger. Ten workers play or sample; cache
refresh runs inside those workers. Brief serial asset updates use only the CPU
they need. The one-shot supervisor runs until explicitly stopped or a failure;
there is no 2,000-game limit and no automatic retry after failure. Each game and
each generation is checkpointed on persistent storage. Final report/archive
stages remain pending while the continuous process runs.
Only unconsumed evidence is decoded for each asset update. Cache counters are
transactional and incremental. A phase-boundary storage guard checkpoints and
stops if fewer than 10 GiB remain, preserving all evidence for an explicit resume.

Use `scripts/cribbage_job_queue.py validate JOB.json` and `install JOB.json`.
The ordered stages are build, bootstrap, decision parity, wait for staged bank,
cache parity, continuous cycles, report, archive, and archive verification. The
release build uses FP64 and no PGO; timing is diagnostic. Register with
`scripts/local-runtime.sh workbench-start JOB.json`. The workbench reads small
receipts showing active asset, cycle, generation, games, sampled hands, workers,
cache age/hits/misses/writes, coverage and original-state evaluation results.

A broad one-time rebuild of the old 330,590-row forecast would cost approximately
8–11 days at only 16 worlds per row, 34–42 days at 64 worlds, or 134–168 days at
256 worlds, using the measured 21,003 cached hand rollouts/hour at eight workers
and optimistic linear scaling to ten. These already assume opening-cache hits,
exclude build/validation overhead and new board/suit dimensions, and do not imply
statistical adequacy. The run therefore begins cyclic learning and incremental
modern forecasts rather than delaying it for that rebuild.

```bash
PYTHONDONTWRITEBYTECODE=1 scripts/run-quiet.sh 'Model 29 learning tests' \
  python3 -m unittest discover -s experiments/model29 -p 'test_*.py'
scripts/run-quiet.sh --show-warnings 'Model 29 native tests' \
  cargo test --manifest-path rust/Cargo.toml -p cribbage-shadow-engine \
  --features model29-training -- --test-threads=1
```
