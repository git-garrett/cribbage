# Model 20.5: investigating the apparent ownership speedup

Follow-up: [two exploratory rounds with execution profiles](model205-layout-rounds.md)
localize the extra sampled cycles to the recursive WP evaluator and test modern
ownership, explicit alignment and separate allocation through gameplay.

Assessment date: 2026-09-29. **Diagnosis complete to the process-startup level;
the exact memory-layout mechanism remains unresolved.** The apparent roughly
900 ms ownership benefit can be reproduced without changing the solver at all.
It is not established as a gameplay improvement subsequently lost on later
moves. No engine change is retained from this diagnosis.

This follows [the modern owned-solver assessment](model205-modern-owned.md).
All detailed measurements below replay one fixed pone opening on the local Mac.
They are not averages across hands or production-server latency estimates.

## Decisive unchanged-binary control

Use the same PGO reference executable, assets, input, warm-up and process
priority. Add otherwise unused environment entries before launching the worker.
Run each case three times, reversing order for the second pass. Measure CPU,
instructions and cycles with `proc_pid_rusage`, including separate performance
core counters. No library injection is used in this control.

| Extra environment entries | Opening CPU time | Instructions | Performance-core CPU share | Performance-core cycles/instruction |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 13.645057 s | 132.476 billion | 85.164% | 0.23224 |
| 1 | 12.685686 s | 132.474 billion | 85.421% | 0.21312 |
| 8 | 13.957188 s | 132.456 billion | 85.530% | 0.23682 |
| 9 | 12.715152 s | 132.440 billion | 85.620% | 0.21322 |

Adding one unused entry produces a **959 ms / 7.03% reduction**, of the same
size as the supposed ownership benefit. The second pair differs by 1.242 s.
Every choice and EV/WP bit matches. All timed calls in this control record zero
disk reads and page-ins. Nearly identical instruction counts, core allocation
and effective clock rates locate the difference primarily in the cost of
executing the instructions, rather than extra solving work or disk access.

An earlier sweep of 0–15 entries found the two slow cases at 0 and 8; the
confirmation above interleaves and reverses them with fast cases to guard
against simple run-order drift. Merely changing the length of one unused
environment value from 0 to 112 bytes did not reproduce the slow cases.
This establishes sensitivity to process startup conditions. Memory placement
and its effect on CPU caches is a plausible explanation, not a measured cache
miss diagnosis.

## Why this explains the misleading ownership comparison

The original isolated/complete-hand discrepancy reproduced with saved binaries.
Reference isolated opening time was 13.596945 s, versus 12.510454 s for the
same root decision called directly from the reference hand-worker executable.
Their instruction counts differ by only 0.0053%; cycles per instruction differ
by approximately 7.4%. Neither reference direct-opening route read from disk
or paged in during measurement.

Across three hot functions, the two reference executables have matching
instruction mnemonics and sequences, with relocated addresses and constants.
The owned candidate has some instruction scheduling/register differences; it
is not byte-identical to the reference. Its isolated instruction count falls
by about 0.32%, far less than its apparent 7.5% time reduction. These controls
do not prove ownership has zero cost or benefit, but invalidate attributing
the large isolated gain to ownership alone.

The earlier native gameplay comparison remains the relevant acceptance result:
pone first-decision means were 11.874578 → 11.909265 s. There is no demonstrated
900 ms gameplay gain to recover from later decisions.

## Stack and scheduling checks

A clock interposer recorded the call-site stack position. One startup placement
repeated at 13.829/13.853 s, while other positions were around 12.5–12.6 s.
That correlation does not distinguish stack placement from other changes
caused by process startup.

The final control changes stack depth inside one running process, using an
otherwise unchanged reference engine and its retained PGO profile. Eight
padding values from 0 to 112 bytes, followed in reverse order, cover every
16-byte position modulo 128. Mean opening times range from 12.695 to 12.890 s;
the approximately one-second gap does **not** recur. All 16 results match the
original reference choice and EV/WP bits. This rules out a simple universal
128-byte stack-alignment explanation in that executable. It does not exclude
larger stack offsets, stack/heap interactions or other startup-dependent
placement. Hard-coding a padding value is not a justified engine optimization.

An attempted QoS control could request user-initiated priority, but the
supervised job still accrued utility-class CPU time. That stage deliberately
failed its effective-priority assertion. It is not evidence from a successful
higher-priority comparison. The separate performance-core counters above are
the stronger scheduling control.

## Measurement and preservation

Use actual gameplay/native entry points for acceptance, with fresh processes,
balanced order and multiple startup layouts. Process CPU time removes waiting
time but does not remove memory-layout sensitivity. Small source changes can
also change binary layout; exact decision parity alone cannot attribute timing
differences to reduced algorithmic work.

Mac rusage time fields were converted from Mach ticks using the measured
125/3 ns timebase and checked against the worker's `clock()` time. Apple XNU's
[task rusage implementation](https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/task.c)
identifies the performance-only time/instruction/cycle fields used here.
The initial counter summary's time conversion was corrected from preserved raw
data; scripts and archived summaries use the corrected conversion.

Assessment scripts, raw results, source snapshot, compiled diagnostic helpers,
PGO profile, executable hashes and job statuses are preserved with a SHA-256
manifest at `benchmarks/model20/evaluation-20260929/timing-discrepancy-assessment`
in the main repository. Working location:
`/private/tmp/cribbage-205-timing-cause`. `core.py` is the repeated unchanged-binary
control; `stack-call.py` is the single-process stack-depth control. Run long
replays through their saved one-shot supervisor specifications. Recorded startup
effects need not occur at the same environment-entry counts in another launcher.

The working engine still matches the restored baseline. Production and the
active 20.3-versus-20.4 benchmark were not modified. No commit or push was made.
