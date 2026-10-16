# Model 29.0: cyclic prior learning

29.0 starts from the audited FP64 28.3 policy and its immutable assets. This is
an experimental training model; production Ace remains unchanged. PR #78 owns
this work. The October 16 user request supersedes the original transposition
pilot: build now, run ten workers, show progress on the workbench, and refresh
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
born at game zero. The local pilot stages 675,987 existing full chunks covering
about 86.6% of historical openings; other contexts build on demand. This avoids
filling the internal disk with the complete bank. Source, binaries, cache, assets,
seeds, databases and supervisor are on persistent internal storage. Production's
exact cache checks are unchanged. See ADR 0001 for the authorized exception.

## Experimental advancement and verification

Both sides use immutable priors during a game. Between phases, validate assets,
then play fresh paired full games with opening acceleration disabled against the
previous generation and the frozen baseline. Evaluation never feeds learning.
An inconclusive screen may advance the experimental lineage; a detected regression
retains the previous generation. The verified baseline stays separate. Only a
passing predeclared noninferiority gate can mark a snapshot promoted. The small
pilot cannot establish stronger play, and its sparse forecast coverage is reported.

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
`prepare.py RUNTIME ARCHIVE` freezes the pilot: two cycles, 200 normal games per
ordinary asset phase (2,000 total), 12 contexts × 16 worlds × 15 keeps per forecast
phase, and four evaluation seed pairs per reference and phase. Ten workers play
or sample; cache refresh runs inside the same workers. Brief serial asset updates
use only the CPU they need. This is a bounded pilot, not an indefinite automation.

Use `scripts/cribbage_job_queue.py validate JOB.json` and `install JOB.json`.
The ordered stages are build, bootstrap, decision parity, cache parity, wait for
staged bank, cycles, report, archive, and archive verification. The release build
uses FP64 and no PGO; timing is diagnostic. Register with
`scripts/local-runtime.sh workbench-start JOB.json`. The workbench reads small
receipts, showing active asset, cycle, generation, games, sampled hands, workers,
cache age/hits/misses/writes, coverage and evaluation outcomes.

```bash
PYTHONDONTWRITEBYTECODE=1 scripts/run-quiet.sh 'Model 29 learning tests' \
  python3 -m unittest discover -s experiments/model29 -p 'test_*.py'
scripts/run-quiet.sh --show-warnings 'Model 29 native tests' \
  cargo test --manifest-path rust/Cargo.toml -p cribbage-shadow-engine \
  --features model29-training -- --test-threads=1
```
