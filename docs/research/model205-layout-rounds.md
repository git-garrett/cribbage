# Model 20.5: two exploratory rounds on ownership and memory placement

Follow-up: [broader native validation](model205-owned-generalization.md) does
not reproduce a general opening-speed gain across 36 hands. The 1.16% figure
below is specific to this fixture comparison; the candidate remains disabled.

Assessment date: 2026-09-29. **Both exploratory rounds complete.** Round one
reproduces the startup-sensitive penalty and localizes the excess sampled cycles
to the recursive WP evaluator. Round two finds a small Mac gameplay benefit
from separately boxed, aligned modern ownership: approximately 0.9% with the
reused profile and 1.2% after a fresh PGO build. This does not recover the original
roughly 900 ms discrepancy. The candidate remains an isolated prototype; AMD
benefit and native benchmark throughput have not been measured for this placement
variant. This follows the
[initial discrepancy diagnosis](model205-timing-discrepancy.md). The user
requested a cause-finding round and an independent round seeking a reproducible
pone-opening gain, covering both ownership and memory placement. They then
requested execution tracing before concluding round one.

All work is in `/private/tmp/cribbage-205-layout-rounds-20260929`. No engine
prototype is enabled in the working checkout. The active 20.3/20.4 benchmark
and production are outside the experiment.

## Round one: startup controls and placement isolation

The unchanged PGO reference binary again reproduces the effect on the same
opening. Two reversed-order repeats average 13.717 s with no extra environment
entry and 12.609 s with one unused entry: **1.108 s faster without a solver
change**. Card choice and exact EV/WP bits match the saved reference.

The new diagnostic worker uses the unchanged engine and baseline PGO profile.
Within one process, 12 stack-depth offsets from 0 to 4096 bytes, repeated in
reverse order, produce means of 12.672–12.853 s. Holding 0, 8, 128 or 2048
separate 256-byte allocations before solving produces means of 12.940–13.070 s.
Neither control reproduces the original approximately one-second penalty.
These probes do not exhaust possible stack/heap interactions or allocator size
classes; they test concrete isolated interventions.

Fresh-thread comparisons across four startup environments likewise do not show
a consistent gain. Two slower repeats have only 61.9%/66.1% performance-core
CPU time, compared with approximately 85% in their partners. Their slowdown has
a scheduling confound, unlike the original control with similar core usage.

A final unchanged-binary control substitutes ignored command-line arguments
for environment entries, preserving their text lengths. It produces the same
broad fast/slow pattern:

| Extra environment entries | Extra arguments | Opening CPU time |
| ---: | ---: | ---: |
| 0 | 0 | 13.535 s |
| 1 | 0 | 12.659 s |
| 0 | 1 | 12.719 s |
| 8 | 0 | 14.100 s |
| 0 | 8 | 13.861 s |
| 0 | 9 | 13.055 s |

This points away from environment-variable interpretation and toward startup
placement. All 64 unprofiled opening replays have exact reference choice/EV/WP
parity. Changing the diagnostic caller itself eliminates the stable bad case;
neither arbitrary environment padding nor thread relocation is a justified
production optimization on this evidence.

The six startup conditions execute 132.470–132.515 billion instructions on
average, a spread of only 0.034%, while consuming 30.649–34.225 billion cycles.
The changed cost per instruction, rather than substantially more executed
instructions, is the useful diagnostic distinction. These process counters
include incidental runtime work and are not exact search-node counts.

## Round one extension: actual execution profiles

Attach Apple's CPU Profiler to the unchanged worker after warm-up; capture
each startup condition twice in reversed order. The discrepancy survives:
slow CPU times 13.956/13.936 s versus fast 13.074/12.892 s. Performance-core
shares are similar, approximately 80–82%. All exact results still match.

Cycle-weighted samples localize essentially all of the excess to
`model91::compact::WpMemo::future`:

| Sampled self-cycle estimate | Slow startup | Fast startup | Difference |
| --- | ---: | ---: | ---: |
| Recursive WP continuation evaluator | 22.868 billion | 20.761 billion | +2.107 billion |
| All sampled code | 31.186 billion | 29.200 billion | +1.986 billion |

The slightly larger function difference than total difference reflects other
functions' small changes and sampling variation. These are profiler estimates,
not exact per-function event counts. It is the recursive evaluation cost that
changes; root ownership adapters are not where the large excess accumulates.

Several large sampled differences occur at state-byte loads and stack stores,
including binary offsets `0x2ec10`, `0x2ec20`, `0x2ecb8`, `0x2ece4` and
`0x2edb8`. Sampling and instruction skid prevent attributing a stall to an
individual instruction from these addresses alone.

Four short CPU Counters captures also complete with exact result parity. The
first pair's Instruments Summary: Metrics reports instruction-processing
bottlenecks of 40.91% slow versus 34.10% fast; instruction delivery is nearly
unchanged at 3.64% versus 3.74%. Useful work is 47.17% versus 51.26%, and
discarded work 8.27% versus 10.89%. These are short-window observations, with
less closely matched core usage than the full CPU Profiler captures. They
support an execution-stall hypothesis but do not establish a particular cache
miss or store-forwarding mechanism. The Mac locked before inspection of the
second pair and deeper UI views; the raw traces are retained.

The initial 23-second CPU Counters recording exceeded its save timeout and is
preserved as an incomplete trace. The repaired job skipped the four completed
CPU Profiler captures and used two-second hardware-counter windows with a
larger save timeout. It completed all eight captures. No failed capture is
counted as a successful measurement.

Apple describes [CPU Profiler and CPU Counters](https://developer.apple.com/videos/play/wwdc2025/308/)
as complementary tools for cycle-based sampling and bottleneck analysis. The
raw counter array was not assigned guessed event names; the reported named
bottleneck percentages were read from Instruments' interpreted view.

## Round two protocol

Compare the retained implementation, the modern owned prototype, an explicitly
128-byte-aligned owned evaluator, and the aligned evaluator in a separate box.
The two placement variants change only `model132_owned.rs` relative to the
owned prototype. Historical models keep their existing interface and solver.

The screen uses three complete hands twice per variant, reversing fixture and
variant order and varying startup environment. Executable names have equal
length. Each hand must match every selected action, exact EV/WP bits and final
state. Pone/dealer first decisions and each role's measured whole-hand pegging
total are kept separate. A promising result requires independent confirmation
through the original gameplay entry point and broader parity validation before
retention. The original baseline and owned PGO profiles are reused for screening;
a retained candidate also needs a clean optimized build.

## Round two: initial screen and scheduling confound

All 24 complete-hand executions match the saved reference decisions, EV/WP
bits and final states. Their unadjusted means must not be used to rank the
candidates: performance-core CPU share falls from 34.0% to approximately 13%
early in the run, then recovers to approximately 79%. The transition coincides
with the Mac being locked, but the test does not establish why scheduling
changed. This is a separate confound from the original startup discrepancy,
which repeats with similar core shares.

The second comparison therefore uses the original `batch-hand-worker` caller,
without the diagnostic stack-padding callback. It runs the same four variants
and three complete hands twice, with rotated/reversed launch order and fresh
warmed processes. All samples retain process counters; core usage must be
reviewed before treating any latency change as a candidate effect. It also
compares the complete results against the first screen's saved reference.
The original profiles are reused for this rejection/confirmation screen; no
candidate is accepted solely from a favorable reused-profile result.

The original-gameplay repeat completes all 24 hands, including 18 candidate
versus reference comparisons covering 192 decisions with exact value-bit and
final-state parity:

| Mac CPU seconds, original gameplay caller | Reference | Owned | Aligned owned | Boxed aligned owned |
| --- | ---: | ---: | ---: | ---: |
| Pone first decision | 10.416 | 10.554 | 10.514 | 10.269 |
| Pone whole-hand pegging | 10.570 | 10.715 | 10.665 | 10.424 |
| Dealer first decision | 1.308 | 1.320 | 1.305 | 1.309 |
| Dealer whole-hand pegging | 1.328 | 1.340 | 1.325 | 1.329 |

One four-variant block has markedly different core usage (46.9–79.6% P-core
CPU). As a post-hoc sensitivity check, keep only entire blocks with at most
five percentage points of core-share spread. Five blocks qualify. In those,
ownership alone is 1.17% slower on pone first decisions, aligned ownership is
1.61% slower, and separately boxed alignment is 0.92% faster. All raw rows are
preserved; this filtering does not convert the small gain into independent
acceptance evidence.

The small boxed signal receives one final focused test: twelve reference/
candidate pairs through the same original gameplay caller, with three hands,
four repeats, startup-entry counts 0/1/8/9, fresh warmed processes and reversed
pair order. This tests repeatability across placement changes, without choosing
the fastest startup environment. No other candidate proceeds to further tuning
in this round.

All twelve pairs complete with similar core shares (every pair within five
percentage points) and exact decisions/value bits/final states. The candidate
wins six of twelve individual pone-opening pairs. Its aggregate improvement is
0.915%, with an approximately 0.8–1.0% gain in each three-hand startup group:

| Focused paired check, Mac CPU seconds | Reference | Boxed aligned owned | Reduction |
| --- | ---: | ---: | ---: |
| Pone first decision | 10.453825 | 10.358186 | 0.915% |
| Pone whole-hand pegging | 10.606397 | 10.514856 | 0.863% |
| Dealer first decision | 1.291190 | 1.298802 | -0.590% |
| Dealer whole-hand pegging | 1.311541 | 1.319108 | -0.577% |

The close-race hand improves in all four repeats (2.1–4.3%, 3.0% aggregate).
The longer `20.3-left-10-h2-s4` opening is 0.72% slower in aggregate; the shorter
`20.3-left-1016-h4-s2` opening is 0.51% faster, with mixed individual results.
The mean gain is about 96 ms, substantially smaller than the original roughly
900 ms discrepancy. All 128 additional candidate decision comparisons match.

Because the discrepancy itself depends on the executable/caller, this small
signal is subjected to a fresh automatic PGO training and optimized rebuild.
The fresh build also checks the normal training/held-out corpus for 20.4 and
20.5, then replays 18 saved isolated positions for exact parity and six further
complete-hand pairs through the original gameplay worker. No placement change
is enabled in the working engine during these checks.

## Fresh PGO result and assessment decision

The clean automatic build completes in 545 seconds. All 26 train/held-out cases
for each of 20.4 and 20.5 retain exact decisions/values between ordinary and
optimized builds; instrumented training also passes the build's parity checks.
All 18 additional isolated positions match the saved reference. Six further
complete-hand pairs match all 64 decisions and their full EV/WP bits, plus final
hand states. Every pair has similar performance-core usage (within five
percentage points); the candidate improves pone first-decision time in all six.

| Fresh PGO build, Mac CPU seconds | Reference | Boxed aligned owned | Reduction |
| --- | ---: | ---: | ---: |
| Pone first decision | 10.064969 | 9.948000 | 1.162% |
| Pone whole-hand pegging | 10.218743 | 10.103199 | 1.131% |
| Dealer first decision | 1.289995 | 1.247787 | 3.272% |
| Dealer whole-hand pegging | 1.309635 | 1.267869 | 3.189% |

The mean pone-opening improvement is **117 ms**. Per-hand mean improvements are
1.31%, 1.64% and 0.71%, respectively. The earlier close-race-specific 3% benefit
does not survive with that magnitude after retraining; the small aggregate gain
does. This supports a modest local opportunity in the combined ownership/
placement/PGO implementation. It does not establish that ownership alone causes
the gain, that arbitrary alignment helps, or that the benefit generalizes to
all hands and callers. CPU seconds under background benchmark load are not
production API latency estimates.

Across round two, 54 candidate/reference hand comparisons cover 576 decision
records, with 18 additional isolated positions: **594 exact comparisons**.
The normal compiler corpus is additional coverage. No playing discrepancy is
observed. This is finite regression coverage, supported by unchanged search and
probability arithmetic, rather than a claim from new playing-strength games.

The exploration has found a small reproducible Mac signal, but it has not
recovered a general 900 ms benefit or produced an AMD result. Keep the complete
prototype and evidence isolated; adoption would need broader native gameplay
coverage and platform-specific validation. The working engine is unchanged,
so this assessment introduces no new live playing or performance behavior.
No production deployment, benchmark restart, commit or push is performed.

## What transfers to the AMD production server?

The current ownership/layout phenomenon has been demonstrated only on the
Apple Silicon Mac. The retained production preflight identifies an AMD EPYC
7713 presented as a one-vCPU x86-64 Linux KVM guest. It does not have the Mac's
performance/efficiency-core split. VM contention and frequency changes can
still affect measurements; removing one confound does not make it noiseless.

`WpMemo::future` is shared engine code, so an optimization that reduces actual
recursive work, instructions or memory traffic could help both environments.
Startup stack placement, allocation alignment, calling conventions and the
compiler's generated instructions differ across ARM64/macOS and x86-64/Linux.
A measured Mac alignment win cannot be advertised as an AMD win without a
corresponding AMD comparison. Nor does the Mac evidence establish that the
production server suffers this same penalty.

The archived production compiler experiment has 238 exact comparisons on
the older `schell_table-peg_table-13.23` build at `08297791363be114d9bfb995c4eb4bef023ef919`.
Its baseline/PGO mean pone first-decision CPU times were 16.260/15.572 s and
dealer first decisions 1.266/1.329 s. Those are partial-hand compiler fixtures,
not current 20.5 ownership tests, live API latency, or whole-hand totals. They
show that platform-specific measurement is necessary; they do not answer this
new optimization's portability question. The exact receipts and their hashes
are recorded in `portability-assessment.json`.

No production workload, build, service restart or deployment is part of these
two rounds. Production benefit remains unverified.

## Evidence and integrity

Seven one-shot jobs complete: startup/placement controls, ignored-argument
controls, execution profiling, the four-variant screen, original-gameplay
comparison, focused placement pairs, and the clean PGO build/parity/gameplay
check. Compilations and diagnostic measurements run sequentially. The already
running head-to-head benchmark remains outside these diagnostic results.

Durable archive:
`benchmarks/model20/evaluation-20260929/layout-rounds-assessment` in the main
repository. It includes prepared source snapshots, placement patches, exact
fixtures and parity oracles, scripts, binaries, PGO profiles, all valid raw
Instruments traces, structured timing/counter rows, job receipts and a SHA-256
manifest. The incomplete initial hardware-counter trace remains under
`/private/tmp`; its file hashes and sizes are recorded separately and it is
excluded from the measurements. Raw trace metadata is local diagnostic data.

The retained working engine's four ownership-boundary files match their
pre-assessment hashes, and the three prototype modules remain absent there.
The active benchmark executable still has SHA-256
`9c584d14491e3708da36143f582c870ffeab9e9bd2d2935787d0013cc97aa067`.
Whitespace validation passes. No retained implementation changed, so the full
unit suite is not rerun solely for these diagnostic artifacts.
