# Benchmark workbench

The local browser workbench shows the paired runner's live progress, projected
completion, paired win rate, score margin, reciprocal outcomes, and historical
confidence bands. It is an observer: it cannot launch, stop, resume, or edit a
benchmark through its HTTP interface.

## Use

Installing a paired job with `python3 scripts/cribbage_job_queue.py install JOB.json`
registers it and starts the workbench automatically. Open
<http://127.0.0.1:8766/>. All browsers use the same service and cached snapshots.
New installations do not open unsolicited browser tabs.

Attach an existing run without restarting its workers:

```bash
scripts/local-runtime.sh workbench-start /absolute/path/to/job.json
scripts/local-runtime.sh workbench-status
```

`scripts/local-runtime.sh workbench-stop` stops only the UI. The existing local
web/API services on 8765/8787 are independent. The workbench listens on loopback
only; all files and service state live in
`/private/tmp/strong-cribbage-local-runtime/workbench`. No production deployment
is needed for this local tool.

The workbench infers the benchmark root from the job's `compact_games` SQLite
completion checks. If those paths do not share a root, supply an absolute
`benchmarkRoot` in the versioned job spec before installing it. The manifest
must record `candidate`, `opponent`, `candidateLeft`, `opponentLeft`, and
`gamesPerOrientation`. Optional `startIndex` defaults to zero. Orientation run
IDs come from `candidateLeftRunId` / `opponentLeftRunId`, or the frozen
`reportCommand` arguments. A single database run can also be inferred; ambiguous
databases fail closed. A manifest created by a later job stage is supported.
Installing from a standalone frozen supervisor without the repository's runtime
manager prints the attach command instead. UI startup failures never fail jobs.

## Cost and consistency

The browser polls every 15 seconds while visible. One short read-only SQLite
query per orientation reads only `compact_games`, filtered by run ID. There are
no database backups, per-decision scans, database writes, worker changes, or
background analysis when nobody is viewing. The WAL reader closes immediately
after collecting rows. A shared 15-second cache avoids duplicate work across
browser tabs. The UI shows the measured time to read and calculate each snapshot.
The launchd service runs at background priority, from an internal-disk copy.

Each orientation is read consistently in its own SQLite SELECT. Different
orientations can have different completion counts. Rows are matched by index,
validated for reciprocal engine identities and identical seeds, and admitted
to inference only through the contiguous completed prefix in index order.
Out-of-order completions remain visible in progress and raw outcomes but cannot
select the inference sample based on game duration. Every history point is
reconstructed from the frozen run's saved results, including when the UI is
attached midway through a run. Display points are thinned; calculations use all
pairs. A new run belongs in a separate job/root. Errors hide evidence rather than
displaying an invalid confidence claim. Stopped/failed supervisor status takes
precedence over old worker status files. Game completion is separate from the
supervisor's verification/report/sync completion.

## Statistical contract

For pair i, X_i = (candidate wins in its two side-swapped games) / 2, so X_i is
0, 1/2, or 1. The paired win rate is the mean of these observations. Its ordinary
interval is the same normal approximation used by the paired reporter:
mean ± 1.959963984540054 × sample-standard-deviation / sqrt(n), clipped to [0,1].
The score graph uses the analogous ordinary interval on average pair margins.
These approximations have no time-uniform guarantee and can be unreliable at
very small sample counts. The sequential verdict uses only the confidence
sequence, never the ordinary interval.

The 95% confidence sequence uses a simple fixed mixture of betting martingales,
following the bounded-mean construction in
[Waudby-Smith and Ramdas](https://arxiv.org/abs/2010.09686). This is our explicit
fixed-mixture implementation, not their optimized adaptive betting algorithm.
For each hypothesized mean m in [0,1], define

```text
L = {0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.0}
K_n^+(m) = (1/8) sum_{lambda in L} product_{i=1}^n [1 + lambda (X_i - m)]
K_n^-(m) = (1/8) sum_{lambda in L} product_{i=1}^n [1 - lambda (X_i - m)]
C_n = {m: K_n^+(m) < 40 and K_n^-(m) < 40}
```

At the true constant conditional mean mu, each factor is nonnegative and has
conditional expectation one. The mixtures are nonnegative martingales starting
at one. Ville's inequality bounds the probability of ever crossing 40 by .025
per tail; a union bound gives at least .95 coverage simultaneously for every n.
K+ decreases with m and K- increases, so bisection yields an interval. Computation
uses log-sum-exp to avoid overflow and rounds bounds outward. Empty data yields
[0,1]. The fixed bets and mixture weights do not depend on observed outcomes.

Assumptions: the matchup and engine assets stay frozen, and the seed-ordered
pairs have a common conditional mean (independent representative deals suffice).
The guarantee is for this one matchup, not selecting a winner among many
experiments or choosing statistical settings after inspecting their results.
No software method establishes those sampling assumptions from a seed alone.

## Validation

```bash
npm run test:workbench
```

Tests cover exact null expected capital, cumulative false-positive probability
over repeated looks, interval inversion, extreme outcomes, out-of-order pairing,
run filtering, integrity failures, read-only access, cache sharing, stopped jobs,
and observer failure isolation. Browser validation covers live data, interval
controls, history inspection, and narrow viewports.

## Request and scope

Build a browser workbench exposed when the benchmark runner starts, with live
progress and graphs of key figures including ordinary confidence intervals and
confidence sequences, without materially slowing the benchmark. Preserve active
runs. The initial scope is local read-only observation of paired game benchmarks;
it does not change model policy, scoring, or the full command-line report.
