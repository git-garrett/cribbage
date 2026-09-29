# Compiler tuning assessment — 2026-09-28

## Decision

PGO alone is selected for native Mac release and benchmark build scripts. A
repeated, held-out replay reduced Model 20.3 CPU time by 11.3%, with exact decision
and floating-point parity. Adding `target-cpu=native` was about 2% slower than PGO
alone on held-out Mac cases. The [build workflow](../mac-pgo-builds.md) generates a
fresh profile and validates exact results automatically; direct Cargo builds
remain unmodified. The running head-to-head benchmark has not been restarted.

The separate AMD production-hardware experiment completed successfully. PGO
improved held-out ordinary decision CPU time by 4.9% and reviews by 6.9–15.8%,
although dealer first decisions were about 5% slower in this sample. Production
was restored to its original release and no experimental compiler settings were
deployed. These server measurements are separate from the Mac build integration.

The preceding selected-action review optimization is separately deployed to
production Ace 13.23 in `08297791363be114d9bfb995c4eb4bef023ef919`, via PR #46.
Full predeploy QA, native Linux build, public exact-commit health, and browser
cache-contract checks passed. This deployment contains no compiler tuning or
unreleased Model 20.x promotion.

## Separate build targets

| Target | Hardware | Compiler | Existing release settings |
| --- | --- | --- | --- |
| Benchmark | Apple M3, `aarch64-apple-darwin` | Rust 1.96.1, LLVM 22.1.2 | Optimization level 3, one codegen unit, thin LTO |
| Production | AMD EPYC 7713, 1 vCPU, `x86_64-unknown-linux-gnu` | Rust 1.92.0, LLVM 21.1.8 | Optimization level 3, one codegen unit, thin LTO |

The reported native CPU names are `apple-m3` and `znver3`, respectively. A native
flag selects instructions and scheduling for the build CPU; it is not a generic
performance switch. The Mac's default ARM target already enables many relevant
features. Do not share its binary or profile with the Linux API.

## Benchmark experiment

Frozen source: `89d4ed875558963d155348e6c77f216213b759f4`. Assets are the frozen
20.3 candidate from the ongoing experiment's `speed-v4/candidate` directory.
The streaming benchmark adapter calls `evaluate_decision_with_caches`; only CPU
time, wall time, and exact EV/WP bit reporting were added to the adapter.

Three independently built variants used the same source, assets, release
profile, explicit target, and locked dependencies:

- Baseline: no extra compiler flags.
- Native: `-Ctarget-cpu=native`.
- PGO: instrument, train, merge profiles, then build with `-Cprofile-use`.

Training used six discovery pegging positions and four discard contexts. Twelve
validation pegging positions were excluded from training. Workers loaded assets
before measurement, and variant order rotated between positions. These were
fixture replays, not new head-to-head games, and they did not change the running
benchmark or its completed-game accounting.

| Replay | Native CPU reduction | PGO CPU reduction |
| --- | ---: | ---: |
| Initial discovery, 6 positions | 3.26% | -2.34% |
| Initial held-out validation, 12 positions | -0.82% | 8.51% |
| Confirmation discovery, same 6 positions | 0.17% | 10.59% |
| Confirmation validation, same 12 positions | -1.44% | 11.31% |

Negative reduction means slower. The initial run overlapped deployment QA/build
activity. It showed a 15.55% PGO slowdown in one pone opening. Two targeted repeats
instead improved that opening by 13.19% in aggregate, and the full confirmation
improved it by 9.24%. Absolute CPU times changed substantially across passes;
uncontrolled core scheduling, load, or thermal conditions are possible causes.
The first anomalous pass is retained rather than treated as a proven regression
or silently discarded. All confirmation first-decision cases improved with PGO.

Confirmation first decisions, averaged across four positions per role:

| Player's first decision in the hand | Baseline CPU | Native CPU | PGO CPU | Baseline wall | PGO wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pone | 8.562 s | 8.626 s | 7.662 s | 8.563 s | 7.684 s |
| Dealer | 1.490 s | 1.480 s | 1.299 s | 1.493 s | 1.321 s |

The two held-out pone openings improved by 11.80% and 10.36% CPU. Selected
later decisions are also included in the aggregate replay, but the corpus does
not contain complete hands: it cannot supply whole-hand pegging totals or a
credible whole-benchmark ETA. These measurements are not production Ace latency.

All **88 baseline/candidate comparisons** were bit-exact for action/card selection
and EV/WP: 36 initial, 8 targeted repeats, 36 confirmation, and 8 discard checks.
The discard checks included two trained and two held-out contexts. This is strong
sampled parity evidence, not an exhaustive proof of every model or position.

## Initial pilot: build and deployment cost

The baseline worker build took 35.0 s. The PGO sequence took 116.9 s:
35.7 s instrumented build, 46.8 s training, and 34.5 s optimized build, plus a
small profile-merge step. These are pilot worker timings, not full API build
estimates. PGO therefore adds about 82 s before validation in this experiment.

The pilot already runs as one invocation of the repository's one-shot job
supervisor. Operator commands could remain unchanged if these stages become an
optional part of the existing frozen-build preparation. A normal implementation
would still need maintained training inputs, matching profile tooling, and a
profile identity that includes source, target, flags, and training corpus. Fresh
profiles should be built for each frozen executable, with exact parity checked
before adoption; a reused profile should not silently cross source/target changes.

The Mac's existing Apple LLVM 21 `llvm-profdata` successfully merged this Rust
LLVM 22 profile in the pilot. That success is not a guarantee for future versions.
A maintained build should use compatible toolchain-matched profile tooling.
The optimized build emitted 155 missing-function-profile warnings, including
unused API/legacy-model paths. Training one benchmark model does not establish
coverage for the production API, its reviews, or other models.

At the time of the initial pilot, the production compiler flags had not been
measured. Native compilation during deployment could retain its existing workflow.
After deployment the host had 954 MiB RAM, about 181 MiB available, an API RSS of
about 551 MiB, and 1.7 GiB free disk. A separate Ace replay worker used about
314 MiB RSS on the Mac; its Linux requirement is unmeasured. Running extra workers
or several fresh instrumented builds alongside the live API would not provide a
controlled comparison. `llvm-profdata` was also absent at that point.

The initial recommendation was to retain defaults pending automated PGO builds
and representative full-hand/discard validation. The later Mac integration and
isolated AMD measurement described below address those prerequisites separately.

## Follow-up: native CPU tuning combined with PGO

The combination was built and tested on the same frozen Mac engine. It used its
own native-CPU instrumented build and profile, trained on the same inputs as PGO
alone. Both variants were replayed in alternating order for two passes over the
18 pegging positions plus four discard contexts.

| Two-pass comparison | PGO CPU | PGO + native CPU | Change from PGO alone |
| --- | ---: | ---: | ---: |
| Discovery, 12 comparisons | 66.330 s | 67.477 s | 1.73% slower |
| Held-out pegging, 24 comparisons | 51.556 s | 52.617 s | 2.06% slower |
| Discard checks, 8 comparisons | 0.822 s | 0.835 s | 1.51% slower |

All 44 comparisons preserved exact decisions and EV/WP bits. The combined
instrumented training decisions also matched the original training outputs.
First decisions averaged 12.498 s CPU for pone with PGO versus 12.765 s combined;
dealer averaged 2.071 s versus 2.081 s. These samples each contain four positions
repeated twice, not whole-hand totals. Absolute timings varied from the earlier
run under the ongoing machine workload; the side-by-side comparison supplies no
reason to add native CPU tuning. Retain PGO alone as the Mac candidate.

Evidence: `combo-job-v1.json`, `combo-summary.json`, `combo-results.json`, and the
three build/training records in the original local experiment directory.

## Follow-up: supervised AMD maintenance experiment

The background AMD job completed on the actual production host using
frozen source `0829779`, the deployed Ace 13.23 assets, and the repository's
canonical one-shot job supervisor. LLVM 21.1.8 profile tooling was installed and
its instrumentation/merge smoke check passed before the API was paused. Source
hashes were checked against the deployed release; critical asset hashes and
compiler/CPU provenance were recorded.

The job built baseline, native, PGO, and combined variants. PGO and combined
variants had separate instrumented training profiles. Training includes plays,
selected-action valuations, combined reviews, and discards. Measurement uses
one resident worker at a time, 34 fixtures, and two passes with reversed variant
order. Validation cases are excluded from training. This measures the production
engine through a decision/review adapter; any winning settings still need normal
API integration and release validation before deployment.

The production API was paused for 22 minutes 48 seconds during this maintenance test. A server-side systemd
one-shot owns the canonical supervisor, has no automatic retry, and enforces a
three-hour execution limit (extended from 45 minutes at the user’s request), an 800 MiB memory cap, and a 256 MiB swap cap. The
normal exit path and an independent `ExecStopPost` hook both start the existing
production service and verify the original release's health. No experimental
binary is deployed and no production symlink or service definition is replaced.
Four restoration checks cover success, test failure, failed preflight, and an
interrupted job. The experiment does not depend on the chat or SSH staying open.

Remote artifacts: `/opt/cribbage/compiler-assessment-20260928-v1`.
Local control files: `/private/tmp/cribbage-compiler-assessment/production`.
Verified results have been retrieved under its `results/` directory. The
five-minute completion follow-up was disabled after reporting completion.

All ten supervisor stages completed; `final.json` and `restored.json` confirm
restoration, and public `/health` independently returned `ok=true`, Ace 13.23,
and the original commit `08297791363be114d9bfb995c4eb4bef023ef919`. No experimental
binary was deployed. All **238 comparisons** preserved exact decisions and
EV/WP bits across the 34 fixtures and two reversed-order passes.

Positive percentages mean less CPU time than baseline:

| Suite and work | Native | PGO | PGO + native |
| --- | ---: | ---: | ---: |
| Discovery decisions (including discards) | -0.67% | 3.04% | 3.78% |
| Held-out decisions (including discards) | -1.14% | 4.91% | 6.02% |
| Discovery selected-action valuation | 10.37% | 16.36% | 7.27% |
| Held-out selected-action valuation | 3.85% | 15.79% | 7.10% |
| Discovery combined review | -3.82% | 11.60% | 6.64% |
| Held-out combined review | 1.02% | 6.88% | 0.26% |

First-decision CPU times average four positions per role, each repeated twice:

| Player's first decision in the hand | Baseline | Native | PGO | PGO + native |
| --- | ---: | ---: | ---: | ---: |
| Pone | 16.260 s | 16.463 s | 15.572 s | 15.491 s |
| Dealer | 1.266 s | 1.273 s | 1.329 s | 1.269 s |

PGO alone improves the critical pone opening but increases the sampled dealer
first-decision time by 63 ms (5.0%). The combined build improves ordinary
aggregate decisions a little more, while losing much of PGO's review benefit.
These are engine-adapter CPU measurements, not end-to-end API latency. The
partial-hand fixtures cannot provide whole-hand pegging totals.

## Mac build integration

The native Mac release/benchmark scripts now run baseline validation,
instrumented training, profile merging, optimized rebuilding, and exact-result
validation in one invocation. API builds train current Ace and its review paths;
benchmark builds accept one or more explicitly named engines and default to
20.3. The integration corpus adds two complete held-out hands. Linux production
build flags remain unchanged. See [Mac PGO builds](../mac-pgo-builds.md) for
commands, dependencies, artifact locations, and failure behavior.

### Integrated-build validation

The real Mac pipeline completed both the benchmark and API builds. Benchmark
build/parity validation took 453.3 s; API took 396.4 s on the loaded Mac. The
optimized binaries matched 26 Model 20.3 cases and 34 Ace cases exactly; the
instrumented training builds added 24 exact comparisons. Each model's held-out
suite included two complete hands. The 427-test Rust suite and 13 build workflow
tests passed, including failed-parity publication protection, fresh profile paths,
platform routing, and caller compiler-flag precedence.

The first sequential benchmark replay recorded 55.12 s baseline versus 76.31 s
PGO for validation. This apparent slowdown did not reproduce in the follow-up:
two passes over the held-out cases alternated baseline/PGO order by case and
reversed order on the second pass, after compilation ended. PGO improved the
measured pegging and complete-hand workloads by roughly 11%, consistent with the
original pilot. This is why single sequential wall-clock readings under changing
machine load are not treated as a performance regression or a speedup guarantee.

| Integrated benchmark workload, two passes | Baseline CPU | PGO CPU | CPU reduction |
| --- | ---: | ---: | ---: |
| Held-out pegging, 24 comparisons | 60.199 s | 53.712 s | 10.78% |
| Complete hands, 4 comparisons | 52.807 s | 47.061 s | 10.88% |
| Discards, 4 comparisons | 1.164 s | 1.201 s | -3.16% |

All 32 comparisons were exact. Complete-hand workloads include discarding,
pegging, and final scoring; these numbers are not isolated pegging-series totals.
Each fixture ran in a fresh process, so CPU measurements include process startup
and asset loading. The small discard-only sample was about 9 ms slower per case
on average and varied in direction between passes; no blanket claim that every
operation became faster is supported.

The equivalent Mac API/Ace check completed 40 exact comparisons:

| Integrated API workload, two passes | Baseline CPU | PGO CPU | CPU reduction |
| --- | ---: | ---: | ---: |
| Held-out pegging, 24 comparisons | 23.409 s | 22.140 s | 5.42% |
| Complete hands, 4 comparisons | 29.153 s | 26.714 s | 8.36% |
| Discards, 4 comparisons | 1.808 s | 1.885 s | -4.29% |
| Combined review, 4 comparisons | 8.456 s | 8.687 s | -2.74% |
| Selected-action valuation, 4 comparisons | 3.748 s | 3.344 s | 10.80% |

The API's discard-only sample was about 19 ms slower per case; combined review
was about 58 ms slower per case. Its pegging, complete-hand, and selected-action
workloads improved. These Mac API results must not be substituted for the separate
AMD measurements. Across both real build pipelines and the two-pass timing
checks, **156 comparisons** preserved exact decisions and values. The measurements
support PGO for the principal Mac workloads, not an assurance that every operation
or future source revision improves.

Evidence: `/private/tmp/cribbage-pgo-integration-validation`, including the two
supervised job specifications, build receipts under `target/pgo/`, and raw
comparison rows and summaries. Published binary hashes matched their successful
build receipts. The build scripts add no `target-cpu` flag.

## Evidence

- Pilot sources, frozen-input provenance, binaries, profile, complete timing rows,
  and supervisor records: `/private/tmp/cribbage-compiler-assessment/benchmark`.
- Main records: `summary.json`, `repeat-summary.json`,
  `confirmation-summary.json`, `discard-check-summary.json`, and their raw results.
- Deployment supervisor and verified public health:
  `/private/tmp/cribbage-ace-review-release-job`.
- Rust's [PGO workflow](https://doc.rust-lang.org/rustc/profile-guided-optimization.html)
  and [CPU selection](https://doc.rust-lang.org/rustc/codegen-options/index.html#target-cpu).

## Production integration completed (2026-09-29 UTC)

Production Ace 13.23 is live at `7b0f6113fde84ea03d3a7c3f4c0d40ea9972cf4e`
with PGO alone. The running binary hash matched the release receipt, optimized
API tests passed, and all 14 training plus 20 held-out cases preserved exact
decision/value parity. These deployment wall times are not a controlled speed
comparison. The successful run needed 768 MiB memory high, 832 MiB maximum, and
384 MiB swap while the API was stopped; systemd restored production after
501.9 seconds. The verified receipt is retained at
`/private/tmp/cribbage-production-pgo-retry/verified-deployment-report.json`.

[Production PR #49](https://github.com/git-garrett/cribbage/pull/49), merged at
`2829e8774565dd9172d78cdb7d8b12a974720427`, preserves the
successful memory allowance and systemd restoration hooks for future builds.
Harmless probe services verified restoration after success, failure, and timeout
without interrupting the real API. This tooling follow-up needs no rebuild of
the currently verified live binary.

The research model optimizations and default Mac benchmark training target after
the frozen benchmark restart are now versioned as 20.4; the historical 20.3
measurements above retain their original labels. See
[the version boundary](model204-version-boundary.md).
