# Benchmark workbench

The local browser workbench shows the paired runner's live progress, projected
completion, paired win rate, scoring, WP calibration, pone-opening time,
reciprocal outcomes, and historical confidence bands. It is an observer: it cannot launch, stop, resume, or edit a
benchmark through its HTTP interface.

## Use

Archive, beside a job's status, hides its tab and keeps it in All experiments.
Selecting an archived job shows its results without restoring its tab; Elevate
restores the tab. These preferences are shared across browsers, survive service
restarts and supervisor resumes, and never change job execution or saved results.
Existing older benchmarks start in the dropdown; new active jobs start as tabs.
Finishing a job does not override an explicit Archive or Elevate choice.
Preferences live under the workbench runtime's `visibility/` directory.

### Opening asset builds

The asset tab separates chunk completion, production publication, and verified
TerraMaster archiving. It shows recent five-minute throughput, worker usage,
milestone ETAs, disk headroom, build/rate histories, and observed opening coverage
along the frozen heat ranking. It never changes a worker or reads the live asset
queue. A stale, stopped, failed, or storage-waiting build has no active ETA.

Register a supervised build using an `assetBuild` object in its versioned job
spec: `root` (the internal run directory), `title`, `target`, `policy`, and
`rankingSha256`. The controller writes atomic `progress.json` snapshots every ten
seconds and `history.jsonl` approximately every thirty seconds. Coverage is a
matching-policy/ranking `coverage.json` with `samples`, `basis`, and ordered
`curve` rows (`chunks`, `heldOut`, `recent`). Current coverage uses only a
checkpoint at or below the contiguous completed prefix; completion count alone
is insufficient when workers finish out of order. The selected 1.25M target was
informed by held-out coverage, so its approximately 99.5% figure is descriptive,
not an independent guarantee for future openings.

The build defaults to normal scheduling, supports ten workers, and waits at a
20 GiB internal disk reserve while allowing in-flight shards to finish. It
resumes automatically when space becomes available. Estimates exclude future
archive waits. An explicit `background: true` config retains the optional older
low-priority behavior. No solver, model assets, build ranking, or shard format
changes accompany these scheduling/reporting changes.

Foreground archiving is separate from the builder and HTTP interface:

```bash
python3 scripts/archive_model283_opening_assets.py CONFIG.json /absolute/archive/path --release-staging
```

This captures a consistent committed queue snapshot, verifies full and two-reply
shards at the destination, and stores the checkpoint and receipt there before
optionally removing those internal staging copies. Pending work is never
removed. The local `archive-progress.json` records that evidence and is read by
the workbench. Without `--release-staging`, internal copies remain. Background
external-volume access is not required or granted. Archive operations are
serialized independently of the running builder. They are explicit foreground
operations, not an unattended archival service; the builder will wait safely if
staging fills before the next archive. Final verification must accept an exact
matching archived checkpoint for released shards, and final durable completion
requires an archive snapshot covering the full target.

### Paired benchmarks

Installing a paired job with `python3 scripts/cribbage_job_queue.py install JOB.json`
registers it and starts the workbench automatically. Open
<http://127.0.0.1:8766/>. All browsers use the same service and cached snapshots.
New installations do not open unsolicited browser tabs.

On a phone on the same local network, use
`http://<this-Mac's-Bonjour-name>.local:8766/`. `workbench-status` prints the exact
address. Bookmark the base address: the Bonjour name and port stay the same when
DHCP changes the Mac's IP address. The Mac must be awake and reachable on the
same LAN; guest-network client isolation can prevent access. This does not
publish the workbench to the internet. Renaming the Mac changes its Bonjour URL.

Active benchmarks appear as tabs in one page. Tabs show matchup, job state,
saved-game progress, and a miniature of the main paired win-rate graph with both
95% bands and the 50% reference. Previews use the main graph's default 40–60%
scale (bands clipped), and name the model whose win rate is plotted. They
support touch and keyboard navigation, and keep a direct `?job=` link. The
experiment selector retains older runs. Installed supervisor jobs are discovered
automatically, including jobs created by older frozen supervisors without the
registration hook. Discovery reads specs and status files only. Only the selected
tab and each active run shown in the tab strip read game results. Older runs in
the selector are not polled unless selected. Each report is reused for its tab
preview and detail panel; an unavailable run does not hide other previews.

Standings name the observed leader and trailing model separately from the
sequential evidence verdict. Both models' paired win rates are shown. Win-rate
curves and both confidence intervals always refer to the explicitly named first
model; above 50% favors that model and below 50% favors the other. Score curves
show the named first model minus the other in points per game, with positive and
negative directions labeled. A points lead need not match the win-rate lead.
Horizontal axes show completed pairs or elapsed hours, not opposing models.
Completion percentages describe the run, and “left” in orientation labels is a
seat assignment, not a standing. Benchmark play and frozen inputs are unchanged.

Scoring can show final points per game, pegging and hand counting separately for
pone/dealer, or crib points. WP calibration shows signed miss (observed wins
minus predicted WP), in percentage points, with separate discard/pegging and
pone/dealer selections. Average predicted WP
and observed wins are shown alongside it, weighted by recorded decisions.
Pone opening is the first card of each hand, not each count-to-31 sequence.
Its elapsed model-call time excludes forced or missing-timing openings; later
calls never substitute for them. These timings include scheduling effects and
are not CPU-time measurements or a controlled comparison across workloads.

Each metric shows both models' means and sample counts, with a graph of the
first model minus the second. Above zero favors the first model for points;
below zero favors it for opening time. Each model's positive WP miss means
underprediction and negative miss means overprediction. Zero means no average
bias, but opposite misses can cancel. The WP difference graph compares signed
misses; neither direction automatically favors a model. The history slider
inspects the same completed-pair checkpoint across all graphs. Missing telemetry
leaves the relevant metric empty rather than counting it as a zero measurement.

Attach an existing run without restarting its workers:

```bash
scripts/local-runtime.sh workbench-start /absolute/path/to/job.json
scripts/local-runtime.sh workbench-status
```

`scripts/local-runtime.sh workbench-stop` stops only the UI. The existing local
web/API services on 8765/8787 are independent. The managed workbench listens on
the Mac's IPv4 interfaces and accepts only its configured Bonjour hostname and
the existing localhost addresses. It retains the read-only HTTP interface and
Host-header protection. All files and service state live in
`/private/tmp/strong-cribbage-local-runtime/workbench`. No production deployment
is needed for this local tool.

The workbench infers the benchmark root from the first stage with `compact_games`
SQLite completion checks; later archive/sync checks do not override that live
root. If that stage's paths do not share a root, supply an absolute
`benchmarkRoot` in the versioned job spec before installing it. The manifest
records `candidate`, `opponent` (or legacy `baseline`), and `gamesPerOrientation`.
`candidateLeft` and `opponentLeft` are used when present; otherwise the workbench
infers them from the job's database paths and reciprocal saved engine identities. Optional `startIndex` defaults to zero. Orientation run
IDs come from `candidateLeftRunId` / `opponentLeftRunId`, or the frozen
`reportCommand` arguments. A single database run can also be inferred; ambiguous
databases fail closed. A manifest created by a later job stage is supported.
Installing from a standalone frozen supervisor without the repository's runtime
manager prints the attach command instead. UI startup failures never fail jobs.

## Cost and consistency

The browser polls every 15 seconds while visible. For each displayed run, a
read-only SQLite query per orientation reads `compact_games`, filtered by run
ID. Indexed game-ID queries read compact hands and decisions for newly seen
completed games in batches of 100. A first visit backfills earlier games once;
later visits reuse in-memory per-game sums and counts. Completed records in a
frozen run are immutable. Changed game metadata, database identity or telemetry
column names invalidate the affected summaries; restarting the UI also rebuilds
them. No decision rows or persistent SQLite connections are retained.

There are no database backups, database writes, worker changes, or background
analysis when nobody is viewing. Games and their telemetry are read in one
transaction per orientation; the runner commits them atomically. The WAL reader
closes immediately after collecting rows. A shared 15-second cache avoids duplicate work across
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
The final-score graph uses the analogous ordinary interval on average pair margins.
These approximations have no time-uniform guarantee and can be unreliable at
very small sample counts. The sequential verdict uses only the confidence
sequence, never the ordinary interval.

The new metric bands are ordinary 95% **pointwise** normal/delta-method intervals,
not confidence sequences. Scoring is weighted by recorded hands (or games for
final score); WP and timing by recorded calls. For each reciprocal deal pair i,
retain v_i = (sum_A, count_A, sum_B, count_B). With totals (A, Na, B, Nb), the
difference is D = A/Na - B/Nb and its gradient is
g = (1/Na, -A/Na², -1/Nb, B/Nb²). With m contributing pairs, estimate variance as
m/(m-1) × sum_i (g·v_i)². The residuals are centered because g·sum_i(v_i) = 0.
The same calculation with the other model's gradient terms set to zero gives
each model's interval. This retains covariance among calls within a game and
between the reciprocal games; it does not pretend calls are independent deals.
Each model needs at least two contributing pairs for its interval, and both
models must meet that requirement for a difference interval. One model's
measured mean, count and interval remain available even if the other has no
telemetry; the absent mean and difference stay unknown. Means use all samples from
the same contiguous prefix as wins, including game-ending partial hands.

Phase scoring retains the reporter's recorded-point convention: unreached
phases contribute zero. WP miss uses the actor's eventual win/loss minus its
selected WP prediction and excludes forced pegging actions and absent
predictions. Natural parameter
bounds clip intervals for nonnegative scoring/timing means, signed WP miss
means (−1 to 1), and differences between signed misses (−2 to 2). The API uses
probability units; the UI scales WP means, differences and bands to percentage
points. Small-sample, heavy-tailed timing intervals can be unreliable. These bands do not control
false positives from repeated checks, metric selection, or changing workloads.

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
automatic job discovery, LAN/Host handling, and observer failure isolation.
Browser validation covers live data, tab switching, direct links, interval
controls, metric selection, history inspection, and narrow viewports. Metric
tests cover reciprocal covariance, unequal sample counts, within-pair sample
duplication, timing/forced-action selection, WP actor perspective, telemetry
compatibility, and avoiding repeated decision reads after cache warmup.

## Request and scope

Build a browser workbench exposed when the benchmark runner starts, with live
progress and graphs of key figures including ordinary confidence intervals and
confidence sequences, without materially slowing the benchmark. Preserve active
runs. The initial scope is local read-only observation of paired game benchmarks;
it does not change model policy, scoring, or the full command-line report.
