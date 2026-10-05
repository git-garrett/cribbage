# Ace 28.3 and progressive opening assets

User-authorized deployment, 2026-10-05. Release branch: `codex/ace283-production`,
checkout `/private/tmp/cribbage-ace283-production`. Operational receipts live in
`/private/tmp/cribbage-ace283-rollout`.

## Contract

- Promote the retained 28.3 playing policy using its exact `28.3.fast` execution
  path. Keep both versioned models available; existing games keep their model.
- Build full assets **only locally**, archive full compressed chunks on the
  external volume, and upload only the first two dealer-card replies to production
  after each verified chunk. Missing, corrupt or stale assets use exact solving.
- Heat first: all 13 first-hand batches, then historical hot board coordinates,
  with candidate-rank demand and savings/build-second as refinements. Cover the
  full reachable coordinate domain eventually; do not narrow playing support.
- Use spare cores/RAM, preserving running benchmarks until their existing paired
  95% anytime-valid confidence sequence excludes 50%. Stop through the canonical
  supervisor, retain completed games and statistical stop evidence, then increase
  local build capacity. Do not substitute fixed-point intervals.
- Preserve analysis/reviews, tips, Dynamic delegates and opening progress. Preserve all existing handicap/calibration history with its normal update rule; no reset, correction or backfill. Resume existing Ace games with their recorded engine.
- No periodic chat messages. Persistent jobs use the one-shot supervisor.

## Storage

Linode instance 100371549 (`cribbage`, us-sea, 172.239.170.10). User explicitly
authorized use of the status_monitor project's existing Linode credential.
Credential uses the project's secure SSH/in-memory API transport; never print it.
Created volume **18351878**, `cribbage-opening-assets`, **64 GiB** (~$6.40/month).
Mounted ext4 at `/var/lib/cribbage-assets`, UUID in `/etc/fstab`, nofail/noatime/
nodev/nosuid/noexec, zero reserved blocks. Only the verified newly attached blank
device was formatted. Service `cribbage` stayed active. Runtime opening assets go
on this volume; OS/releases/engine static assets and existing game DBs stay on root.
No production asset builder is to be installed.

## Evidence and implementation state

- [x] Prior exact depth2/full comparisons: 70 output comparisons, 12 complete
  hands; depth2 retains 97.6% of measured full savings. Durable evidence:
  `benchmarks/model28/model283-fast-20261005/depth-followup-20261005`.
- [x] Hot-path/tail assessment: prior `priority-followup-20261005` archive. Slowest
  1% of calls accounts for ~1.47% of total time; heat is the primary priority.
- [x] Production storage provisioned/mounted/readable as cribbage user.
- [x] Isolated branch from origin/master 79e8180. Merged retained
  28.3 research commit 4cba96d; eight conflicts resolved preserving production PGO,
  Dynamic opening progress and selected-action reviews. Merge committed as 28f1940 in PR #60.
- [x] Integrated uncommitted fast patch from `/private/tmp/cribbage-model283-fast`
  and tested depth2 source from `/private/tmp/cribbage-283-depth-assessment-20261005/source`.
- [x] Release-build helper tests pass after combining Mac research and Linux
  production build machinery. `xz2 0.1.7` static dependency supplies bounded dictionary/XZ decoding without a server package dependency.
- [x] Native compressed codec, bounded reader and nested shard paths. Small-deck tests prove full-book projection equals direct shallow capture at depths 1/2/4 and early/endgame boards; replay preserves private discards and exact outcomes. Complete-hand compressed-path checks pass.
- [x] Ace identity/frontend/progress and model asset packaging. All 514 Rust tests and web/type checks pass. Fixed legacy 13.23 resume lookup; every old Ace engine retains its own active games. Existing Dynamic and continuous handicap tests pass; no profile reset/backfill/correction is introduced.
- [x] Frozen builder and publication controller, local-only resource limits,
  statistical benchmark stop/harvest, durable receipts and recoverable queue.
- [x] Fresh PGO opening-builder training: exact baseline/instrumented/optimized
  decisions, values and full/shallow shard bytes. Twelve complete hands (three
  identical deals, ordinary/missing/full/depth2), all eight cards legal, exact
  values/choices/scores; ordinary also exactly matches prior frozen 28.3 outputs.
  Mean pone first CPU: ordinary 5.364s, fast missing 4.632s, full 0.140s, depth2
  0.244s. Mean whole-pone: 5.402/4.667/0.175/0.279s respectively. Background
  workloads and macOS core selection apply; not production latency estimates.
  Evidence: `/private/tmp/cribbage-ace283-rollout/validation`. First-hand set pending.
- [ ] PR, independent standards/spec review, exact-head Quality, merge.
- [ ] Native AMD build/parity, health, deployed commit/hash checks, promotion.
- [ ] Start full local asset job and verify successful shallow-only publication.

At the first check neither active benchmark meets the stopping threshold:
28.3 vs20.7 has 889 ordered pairs and CS [48.695%,51.889%]; 20.7 vs20.6 has
734 ordered pairs and CS [49.289%,52.158%]. Use
`scripts/benchmark_workbench.py::build_report` with entry keys `id`, `root`, `spec`;
its fixed-order contiguous paired prefix is necessary to avoid duration bias.
Active specifications are each run's `job-balanced4.json` under
`/private/tmp/cribbage-model{283-vs-model207,207-vs-model206}-10k-20261004-v1`.

## Local execution and publication

`scripts/build_model283_opening_assets.py` owns a resumable, bounded queue. Each
worker computes on internal disk; the explicit chunk sync verifies and archives
full/shallow files, publishes only depth2 through
`scripts/receive_model283_opening.py`, and records the acknowledgment before
releasing internal staging. Failed sync preserves completed work for a supervised
resume. No production computation is scheduled. The receiver refuses root-disk
fallback if the block volume is unmounted. Immutable policy namespaces and atomic
files protect readers. Progress includes finished chunks, bytes and an explicitly
provisional ETA based on observed throughput.

Mac: 12 logical CPUs, 18 GiB RAM. Four benchmark solving threads are active. The
builder reserves two CPUs, starts with at most six workers and can grow to ten
after the benchmarks finish/are statistically stopped. Workers run at background
policy/nice20; macOS chooses core type. All source/assets/binaries are fingerprinted.

The canonical launchd write probe failed with macOS `Operation not permitted` on
the external volume. User was asked to enable runner drive access or choose a
capped internal build. Deployment and independent verification continue while
that choice is pending. Do not bypass this OS restriction or silently fill the
internal disk with the full archive.

## Deferred free compute assessment

After the local/publishing pipeline is working, assess external workers without
changing playing policy. Cloudflare's free Workers CPU allowance is 10 ms per
invocation, unsuitable for these multi-second native chunks. Oracle Always Free
currently documents an Ampere allowance equivalent to 2 OCPUs/12 GiB; availability
and eligibility need checking. Standard public GitHub Actions runners are free,
while private repositories have limited included minutes. These are candidates,
not provisioned workers. Sources: [Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Release-only verification now includes optional `CRIBBAGE_283_STATS` diagnostics so
AMD checks can prove asset hits, not silently pass by falling back. A missing or
unwritable diagnostic destination never affects decisions. This source change
changes the conservative policy fingerprint; the final verified pilot will be
rebuilt before publication.

## Activation gate

The receiver writes versioned chunks and deliberately does **not** select the
active policy. After the AMD binary passes baseline/asset/Mac bit parity and
reports successful lookups, verify `/var/lib/cribbage-assets` is mounted and the
chosen policy directory exists. Create a temporary symlink in `openings` to that
64-hex policy directory, then atomically rename it to `openings/current` (same
filesystem). Retain prior link target, new target, deployed commit, test receipts,
and file hashes in `activation.json`. Confirm the configured service path resolves
to that policy. An interrupted or missing link only causes exact solver fallback.
Do this before launching the publishing build. Rollback restores the previous
link if needed; do not allow incoming chunks to activate themselves.

Independent PR review found and fixed one shared P1: Dynamic preparation captured
the wrapper model instead of the frozen decision delegate. A real `prepare().wait()`
forced-rank regression covers both pone and dealer without test assets.

Independent standards and specification re-review: no findings after the delegate
and cooperative-cancellation fixes. Model 28.3 now reports completed root candidates
and checks cancellation inside public/private solving and forced suffixes. A real
API forfeit stopped the obsolete new-Ace solve in 3.12 ms (legacy 13.23: 7.92 ms),
after confirming useful progress; no partial decision was returned. Receipt:
`/private/tmp/cribbage-ace283-rollout/cancellation.json`. Progress is deliberately
coarse (up to four distinct rank candidates), not a percent-of-CPU estimate.

The first GitHub Quality run exposed a test fixture dependency: discard parity
requires the ignored 523 MB production correction asset, which is absent in a
fresh CI clone. The test is now an explicit mandatory predeploy installed-asset
check, alongside the existing full-asset integration check; it is not silently
skipped at deployment. It passed locally with the installed asset.

A subsequent CI target exposed the same installed-asset dependency in six inherited
20.x mixed pegging/discard tests. Their pegging checks remain in ordinary CI;
explicit installed-asset wrappers retain all discard/cache/review cases in the
mandatory predeploy gate. No assertion is dropped. A clean-checkout run without
the ignored correction asset is being used to verify the complete ordinary suite.

Final compiled progress/cancellation version: twelve complete-hand parity checks
passed, including exact comparison with the prior frozen solver. Mean CPU seconds:
fast missing/full/depth2 pone lead 4.497/0.133/0.235, whole-pone
4.530/0.166/0.268. Depth2 dealer first/whole 0.398/0.405. This small Mac sample
shows no observed slowdown from cancellation support; it is not a statistical
latency guarantee. Streaming controller validation also built a native chunk,
preserved it through a deliberate sync failure, resumed without recomputation,
and verified idempotent completion. Evidence: rollout `pipeline-validation`.
