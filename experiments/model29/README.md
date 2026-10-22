# Model 29.1: exact-hand forecast learning

29.1 forks the latest completed 29.0 snapshot and keeps its live WP-maximizing
policy and other learning phases. It adds a forecast correction for each exact,
suit-canonical six-card/discard/role context. It does **not** pool different or
similar hands, rank-only hands, or different discards. Global suit renaming is
an exact game symmetry and is the only card equivalence used.

Each context has three regularized linear corrections: opponent standard, on,
and off. Features are an intercept, both actual scores (centered/scaled), and
the inherited forecast WP. The learning target is the hand's realized next-state
WP minus its inherited forecast, both evaluated at the actual source board with
the source generation's WP matrix. Terminal wins/losses are exactly 1/0. Each
four-parameter regression starts with zero coefficients and ridge strength 32.
This is a compact **WP correction**, not a newly generated joint-scoring table;
full joint endpoints and source predictions remain in evidence.db. Legacy
forecasts still supply the initial prediction and unvisited contexts.

The initial opponent-tempo heuristic asks whether faster scoring by both players
helps the opponent in the current WP table. A two-point forward slope (backward
at the board edge) blends standard with on/off over a 0.02-WP band. This is an
explicit experimental heuristic, not an implementation of Colvert's rules and
not an assertion that the opponent always adopts the opposite style. Its zones
change as the WP table learns; the band itself is fixed. Actual board features
also condition corrections for changes in our own future choices. Neither
actor's executable WP chooser is constrained to a style. Accuracy and strength
remain to be measured; a nonzero correction is not proof of improvement.

Prepare with `transition291.py prepare RUNTIME ARCHIVE`; training mode defaults
to on. Add `--ordinary-hands-only` to start with exploration disabled. During a
run, set `output/training-control.json` to `{"trainingMode": false}` for speed,
or `true` for all rejected discards. Changes take effect at the next 20-game
batch. The selected mode is persisted per batch; an interrupted batch resumes
its original mode even if the control file subsequently changes.

The supervised transition builds and verifies 29.1 before stopping 29.0. It
forks the latest completed snapshot after the stop, retains all old evidence,
and uses two workers. The rolling opening cache reads compatible older chunks
without resetting their age and writes new chunks into the 29.1 runtime. Cache
compatibility is supported by a source audit and initial-policy parity. The
clock carries forward all previous completed training/evaluation games. A disk
check before every worker request preserves at least 10 GiB of headroom.

The pilot uses 20 ordinary games per phase, with 50 rounds per 5,000-game block.
After every 5,000 training games it runs 1,000 paired games against the original
29.0 starting state, recording full benchmark telemetry. These are a new run's
confidence sequence; older 29.0 panels are not silently pooled into it.

## Inherited 29.0 experiment


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

## Training-mode toggle

New runs default to `trainingMode: true`. After each ordinary training batch,
its same workers check all **14 rejected discards for both players in every
played hand**, using that hand's actual deal, cut, board position, and frozen
policy. The chosen discard's outcome comes from the ordinary game and is not
replayed. Both actors still receive only their legal observations. Alternatives
stop at the first winner; there is no score transposition or post-win play.

Set `trainingMode: false`, or prepare with `--ordinary-hands-only`, when speed
matters more than exploring alternatives. In that mode the forecast still
learns from the chosen discards in ordinary games. No counterfactual worker
requests are made. The toggle governs evidence collection only; learned assets
remain in use in both modes. The mode control is separate from the frozen policy configuration and is recorded at each batch boundary.

The forecast phase consumes the new ordinary-game evidence and, when enabled,
the rejected-discard continuations from all preceding ordinary phases. Evidence
is committed by exact game/hand/actor identity, so interrupted or out-of-order
continuations resume without repeating completed work. A game/hand/actor is one
shared world; its 15 candidate outcomes are correlated and are never counted as
15 independent games. Suit-equivalent choices contribute at most once per
forecast row per world, preferring the actually played outcome. Only ordinary
full games advance the cache clock. Evaluation never supplies training evidence.

29.0's sparse exact-board forecast remains an inherited component. In 29.1 the
new source-board residuals update the separate exact-hand tempo correction;
absolute terminal endpoints are never transplanted onto a different board.

## Opening cache

Completed original-state comparisons retain per-decision EV, win probability,
actor/role/model, legal-choice count and computation time. The workbench reports
EV error (excluding terminal hands), WP calibration/Brier, and discard, opening
and whole-hand pegging timings for both states and orientations. Legacy games
remain explicitly unrecorded; their predictions and timings are not reconstructed.
Each checkpoint has its own confidence intervals because the learned state
changes. The checkpoint-adjusted assessment also accounts for repeated testing.

The workbench separately accumulates evidence for the **evolving branch** across
every completed comparison, beginning with the first. Each fresh reciprocal seed
pair contributes its win fraction (0, 1/2, or 1). The two-sided 95% confidence
sequence targets the average conditional win rate across evaluated states,
including the declared rolling-cache policy. It allows changing performance and
repeated inspection; superiority requires its lower bound to exceed 50%.
It cannot establish latest-state strength, future strength, or monotonic learning.

The fixed method is Howard et al., [Theorem 4 and equation (24)](https://arxiv.org/pdf/1810.08240),
using the predictable constant forecast 1/2. With `n` pairs and `V` equal to one
quarter of the number of sweeps, put `v=max(1,V)` and `l=log(log(2*v))`.
The radius is `(1.7*sqrt(v*(l+3.8)) + 3.4*l + 13)/n`, clipped to [0,1].
This differs from the fixed-mean betting interval used by ordinary benchmarks.
Never intersect bounds from different checkpoints or force confidence to improve:
their cumulative targets change. All checkpoints count, including ones older than
the UI's rolling history. Missing panels, reused seeds, changed originals, or
incomplete orientations make cumulative inference unavailable rather than silently
dropping evidence. This is read-only reporting and schedules no additional games.

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
ordinary asset phase, optional all-rejected-discard continuations for every hand,
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
