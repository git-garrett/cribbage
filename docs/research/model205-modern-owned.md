# Model 20.5: a dedicated owned decision entry point

Follow-up: [timing discrepancy diagnosis](model205-timing-discrepancy.md) reproduces
the approximately 900 ms difference with an unchanged reference binary by
varying process startup conditions. The exact memory-layout mechanism remains
unresolved; the isolated timing gain cannot be attributed to ownership alone.

Assessment date: 2026-09-29. **Complete; prototype not enabled.** The requested
modern ownership boundary was built and evaluated. It preserves playing
behavior, but shows a small repeated gameplay slowdown and no recovery of the
apparent 900 ms benefit. The four modified engine files are restored exactly
and the three prototype modules removed from the working engine. Existing
retained 20.5 optimizations remain in place. The complete candidate source,
patch, executable receipts and results are preserved in the assessment archive.

This follows the [first ownership assessment](model205-owned-solver.md). The
user requested ownership for new models without migrating historical models,
and a closer investigation of the apparent 900 ms isolated-opening improvement.
Visible first-decision latency is a separate acceptance criterion from total
throughput; a real opening improvement need not be rejected merely because a
later, less visible decision costs more.

## Architecture

In the prototype, Model 20.5 selects `OwnedDecision` at the live decision boundary. It owns its
mutable Model91 evaluator, likelihood cache and prepared posterior. Immutable
belief rows and the board matrix remain shared. The forecast calls the owned
policy through mutable references with static dispatch. Ownership is selected
once at the root, rather than through an enum on every simulated policy query.
Future versions can continue through this modern entry point.

Models through 20.4 retain their shared policy interface and configuration. The
forecast traversal and likelihood calculation are shared kernels with small
adapters; there is no second search algorithm or per-version solver fork.
One root allocation boxes the modern prepared decision. Decision-local caches
are released at the end of the solve, in accordance with ADR 0001.

Cache capacities, admission/clearing, world order, posterior arithmetic, batch
size, evidence support, score utility, pruning, tie handling, cancellation and
legal-information boundaries are unchanged. This experiment keeps observation
validation and conversion; their removal is not implied by exclusive ownership.

## Investigating the missing opening improvement

The old binaries first reproduced the discrepancy on the same opening:
13.631274 → 12.657115 CPU seconds in the isolated worker, but
12.528171 → 12.678190 in the complete-hand worker. This reproduces an apparent
974 ms isolated benefit without a gameplay benefit.

Next, four byte-identical copies of the reference decision executable ran at
four paths, twice each with reversed order. All outputs matched. Mean times
ranged only from 12.533704 to 12.590452 seconds. The reference itself therefore
ran near the earlier candidate time without any ownership change. File location
did not explain a stable 7.5% benefit; the source of the runtime variability was
not established.

A separate ordinary-release diagnostic switches shared/owned ownership inside
one executable, before each request, with identical loaded assets. Five
caller/cache combinations, each repeated in reverse order, cover direct calls,
the gameplay API, absent/fresh/persistent hand caches and presence of the older
Model911 hand-cache argument. Exact decisions/values and the available counters
match in all ten pairs. Those counters cover the root posterior but do not
instrument the WP continuation search; they cannot establish identical total
search work. CPU changes range from 1.52% slower to 2.63% faster;
gameplay improves 1.52% on this diagnostic fixture. These small, variable results
do not reproduce a consistent 900 ms ownership benefit. The diagnostic hooks
exist only in the separate snapshot, not the working engine or timed PGO build.

The benchmark's native playout calls `evaluate_decision_with_caches`; the
complete-hand fixture calls `recommend_peg_for_side_with_caches`. Both paths are
therefore included in the final validation rather than treating their timings
as interchangeable.

## Final evaluation protocol

Compare the retained 20.5 baseline (prepared continuation bases and reusable
outer rollouts) with a clean PGO build of this architecture, using the same
compiler, target, assets and training corpus. Alternate and reverse reference
and candidate execution. Replay 18 isolated positions twice and three complete
hands twice, requiring exact choices, EV/WP bits and final states.

Additionally build the native baseline runner using its retained matching PGO
profile. Play two fresh-seed diagnostic games through both native runners in
balanced order and separate databases. Compare every canonical game, hand,
discard and pegging record, excluding only timing fields. These diagnostic
games are excluded from the active head-to-head benchmark. Native timing uses
recorded wall time; fixture timing uses process CPU. First decision means each
role's first pegging decision in the whole hand, and whole-hand pegging means
the measured sum of that role's decisions, never extrapolated partial fixtures.

The active 20.3 versus 20.4 benchmark and production are untouched.

## Initial clean PGO fixture results

All 36 isolated comparisons and all 64 decisions within six complete-hand
replays match exact choices and EV/WP bits. All final hand states match. The
PGO build also passes its 26-case corpus for each of 20.4 and 20.5, comparing
ordinary and optimized compilation.

| Mac process CPU measurement | Retained baseline | Modern owned | Reduction |
| --- | ---: | ---: | ---: |
| Isolated pone first decision | 11.913043 s | 11.161688 s | 6.307% |
| Isolated dealer first decision | 1.735015 s | 1.697128 s | 2.184% |
| Complete-hand pone first decision | 9.933844 s | 10.008714 s | -0.754% |
| Complete-hand pone whole-hand pegging | 10.086818 s | 10.158916 s | -0.715% |
| Complete-hand dealer first decision | 1.245311 s | 1.280762 s | -2.847% |
| Complete-hand dealer whole-hand pegging | 1.264808 s | 1.300212 s | -2.799% |

The isolated opening benefit remains executable dependent. The complete-hand
measurements do not demonstrate recovery of 900 ms, and the small slowdowns
require confirmation with fresh processes and reversed launch order. The
follow-up uses one worker at a time, releasing it after each complete hand.

Native runner comparisons check exact persisted rows; that runner formats
valuations to 12 decimal places. Only the separate fixture comparisons claim
full EV/WP bit parity.

## Native benchmark result

Both paired games match all canonical records: 205 pegging rows and 38 discard
rows, plus hand and game results. The two seed positions produced 19 hands in
each implementation. Reference/candidate order was reversed for the second
game. The seed is 3406924983, with game indexes 0 and 1; all four executions
have separate databases and are excluded from the active benchmark.

| Native Mac wall-time measurement | Retained baseline | Modern owned | Reduction |
| --- | ---: | ---: | ---: |
| Pone first decision | 11.874578 s | 11.909265 s | -0.292% |
| Pone whole-hand pegging | 12.147704 s | 12.190263 s | -0.350% |
| Dealer first decision | 1.425693 s | 1.445807 s | -1.411% |
| Dealer whole-hand pegging | 1.452838 s | 1.473504 s | -1.423% |

Forced actions retain the runner's existing zero/unrecorded decision-time
convention. Totals include only actual play up to hand completion or game end.
These local Mac wall times are not production-server latency estimates. The
native check supports functional parity and shows a small measured slowdown,
not the isolated executable's roughly 750 ms opening improvement.

## Fresh-process confirmation and decision

Six further complete-hand pairs use one freshly warmed process at a time,
reversing fixture and variant order. All 64 additional decisions and full EV/WP
bits match, as do all six final hand states.

| Complete-hand CPU measurement | Retained baseline | Modern owned | Reduction |
| --- | ---: | ---: | ---: |
| Pone first decision | 9.950659 s | 10.017270 s | -0.669% |
| Pone whole-hand pegging | 10.101566 s | 10.167681 s | -0.654% |
| Dealer first decision | 1.245544 s | 1.256919 s | -0.913% |
| Dealer whole-hand pegging | 1.264719 s | 1.276204 s | -0.908% |

This confirms that the opening benefit did not transfer to gameplay. It is not
a demonstrated opening gain offset by slower later moves: the first decision
itself remains slightly slower in the native/gameplay tests. The isolated
binary's large gain is real within that measured setup, but cannot be attributed
solely to ownership or applied as a general UX estimate. Identical-reference
controls also show sensitivity outside the source change. The exact compiler
or runtime cause remains unresolved.

Ownership for modern models remains architecturally feasible. This particular
boundary requires additional compatibility adapters and produces no measured
critical-path benefit, so it is preserved as a prototype rather than enabled.
No playing regression was observed in 164 full-bit fixture comparisons and two
paired native games. Finite replay coverage is supported by reusing the same
evaluator and probability arithmetic; it is not a new playing-strength claim.

The candidate passes all 441 Rust tests across 22 targets, including three new
tests for ownership isolation, posterior/forecast parity through a hand,
mixed-actor/reordered batches, validation errors and recovery, selected-action
reviews, and repeated hand-cache use. After exact restoration, all 438 retained
tests pass across 22 targets. Whitespace checks pass. The active benchmark
executable's SHA-256 is unchanged. Only the existing WeightedEntry dead-field
compiler warning remains.

## Reproduction

Assessment directory: `/private/tmp/cribbage-205-modern-owned`.
The one-shot job `model205-modern-owned-pgo-v1` contains clean PGO build,
reference-runner build, fixture validation and native parity stages.
`model205-modern-owned-confirm-v1` contains the fresh-process confirmation.
Both completed successfully. Earlier one-shot jobs preserve the discrepancy
reproduction, identical-binary control and unified diagnostic.

Durable archive:
`benchmarks/model20/evaluation-20260929/modern-owned-assessment` in the main
repository. Its SHA-256 manifest covers source snapshots, job specifications
and statuses, raw timings, native databases, diagnostics and verification.
No commit, push, production deployment or benchmark restart was performed.
