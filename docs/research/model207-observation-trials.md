# Model 20.7: small observation and policy-path trials

Authorized 2026-10-01. Any retained change goes into **20.7**. Historical models,
including the actively benchmarked 20.6, must keep their implementations.

## Trial register

| ID | Idea | Status | Exact behavior | Pone opening / other timings | Complexity | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Use an iterator for the zero/one/multiple legal-rank question | Accepted by user after bounded confirmation | 462 Rust tests; 128 exact decisions; 8 review/discard/hand cases; all timed decisions and complete hands exact | Confirmation pone opening 8.691 → 8.423 CPU s (+3.08% nominal); whole-hand pone +0.50%; unequal core use limits attribution | Reuses the existing predicate; removes a temporary vector; production diff +8/−7 lines | Include in cumulative 20.7 candidate; reduced work demonstrated, timing benefit qualified |
| 2 | Reuse rank-only scoring for immediate tie-breaking points | Bounded confirmation complete | 463 Rust tests; 128 exact decisions; 8 review/discard/hand cases; 140 timed decisions and 36 complete-hand replays exact | Pone opening 0.62% slower in screen and 1.12% slower in confirmation; confirmation whole-hand pone 0.40% slower, dealer 0.23% faster | Replaces repeated rank-vector/Card-vector conversions with one short helper; incremental production diff +10/−24 lines | Set aside: no demonstrated incremental critical-path win; no more measurement |
| 3 | Use the apply operation's existing legality checks | Screen complete; no confirmation warranted | 463 Rust tests including invalid-action recovery; 128 exact decisions; 8 review/discard/hand cases; 52 timed decisions and 12 complete-hand replays exact | Pone opening 1.38% slower; whole-hand pone 4.08% slower, dealer 4.16% slower; opening instructions decrease 0.22% | Removes a duplicate rank scan; preserves error recovery; incremental production diff +5/−6 lines | Set aside: no demonstrated incremental timing win; no more measurement |
| 4 | Validate action-cache misses, not identical validated hits | Bounded confirmation complete | 463 Rust tests; 128 exact decisions; 8 review/discard/hand cases; 140 timed decisions and 36 complete-hand replays exact | Confirmation pone opening 0.27% faster (interval −0.23% to +0.70%); whole-hand pone 0.15% faster, dealer 0.20% faster; instructions fall 0.21% | Moves existing checks; adds no representation or cache; incremental production diff +2/−2 lines | Set aside under delegated review: benefit remains too small and uncertain; no more runs |
| 5 | Index the likelihood cache's 14 cut buckets directly | Bounded confirmation complete | 463 Rust tests; exact physical choices and EV/WP bits on all tested cases | Confirmation pone opening +1.44% nominal; whole-hand pone 0.61% slower and dealer 1.09% slower; no hardware-matched positions | Removes outer hashing; adds fixed bucket storage | Set aside: incremental benefit not established; no additional runs |
| 6 | Acquire the likelihood-cache lock once per batch | Bounded confirmation complete | 463 Rust tests; exact physical choices and EV/WP bits on all tested cases | Confirmation pone opening +0.81% nominal; whole-hand pone 1.15% slower and dealer 2.35% slower; no hardware-matched positions | Adds a small private helper and explicit lock scope | Set aside: incremental benefit not established; no additional runs |

All six trials and the verified foreground archive completed on 2026-10-02.
Only #1 is accepted. The [complete trial report](../../benchmarks/model20/evaluation-20261001/model207-observation-trials/report.md)
preserves every screen, confirmation, decision and timing qualification. Exact
parity passed throughout. Versioned 20.7 integration and its final regression
checks completed on 2026-10-02. Only #1 is enabled for 20.7; historical 20.6
retains its route. See [the version boundary](model207-version-boundary.md)
for fresh-PGO, full-suite and saved-result parity verification. The six-worker scored benchmark was subsequently stopped at the
user's request, after all trial measurements had finished.

The order ranks plausible **net benefit**, including simplicity and risk, rather
than predicting a measured speedup:

1. Assembly confirms an allocation and complete rank scan just to ask whether a
   second legal rank exists. Reusing the predicate is a small, direct removal of work.
2. Three WP paths allocate rank and card vectors for an integer score; a tested
   rank scorer already exists. The saving is direct, though invocation frequency
   and the cost of the short stack copy determine its overall value.
3. The apply operation already checks legality before mutation. Removing the
   preceding full rank scan eliminates duplication, but error recovery needs care.
4. Exact cache keys make repeated validation redundant on a hit. Benefit depends
   on hit frequency; invalid-input behavior must remain identical.
5. Fourteen possible cut contexts permit direct indexing, but fixed bucket storage
   costs more space and outer hashing may be only a small part of lookup time.
6. Batching locks can save repeated lock operations, but adds a helper and broadens
   the lock scope. Prior profiling suggests locking is not a dominant cost.

Background and code/assembly evidence:
[small-opportunity investigation](model207-small-observation-opportunities.md).
Existing tests reported there concern the unchanged engine. They do not count
as passing tests for these candidates.

## Evaluation protocol

Use a **greedy cumulative sequence**, as requested by the user: start at the top,
test one item against the currently accepted candidate, and advance that baseline
only after an incremental win. A rejected item stays out of all later candidates.
There is no independent-candidate or combinations matrix. Record the exact parent
and included items for every build so incremental gains cannot be confused with
gains over the original 20.6 baseline. The user has now delegated all remaining
accept/reject decisions: decide from the bounded evidence and advance either way,
without waiting for the user. Keep patches, hashes, compiler/profile receipts and results.
Use temporary, explicitly labelled experiment binaries; they do not replace any
retained model or scored benchmark binary. Accepted changes form the cumulative
20.7 candidate. Before retaining them, verify the versioned 20.7 route and ensure
that historical models keep their original implementation.

Required correctness:

- Full Rust suite plus focused tests for the changed behavior, including invalid
  inputs, cache misses/hits/clears, duplicate ranks, go/reset/31 and recovery from
  a failed speculative batch.
- Exact physical choices and EV/WP bits against the frozen reference corpus;
  identical complete-hand decisions and terminal states.
- Preserve public/private information boundaries, posterior support, arithmetic
  order, tie rules, model assets and historical version behavior.

Required performance evidence:

- Normal release builds with fresh PGO for each implementation, with the same
  training corpus and compiler settings.
- Paired, balanced-order screen followed by held-out confirmation where needed;
  separate pone/dealer first decisions from actual whole-hand pegging totals.
- Record CPU and wall time, instructions, performance/efficiency-core use and
  frequency. Do not treat core-placement or frequency drift as a code gain.
- Keep unsuccessful hardware-control attempts and report incomplete comparisons.
  No unlimited retries or selective reporting of favorable fixtures.
- Run one experimental worker at a time. Do not overlap the other chat's CPU
  assessment without an explicit revised schedule from the user.

The frozen screen contains six pone openings, three dealer first decisions and
two later decisions per role. Every position runs twice per binary in balanced
ABBA/BAAB order. A potential winner then receives the preselected, disjoint
confirmation set: twelve pone openings, six dealer first decisions and two later
decisions per role. Three complete hands span early, middle and endgame boards;
six different complete hands are reserved for confirmation. These supply actual
whole-hand totals, not totals inferred from partial fixtures.

All hardware samples remain in the record. A diagnostic matched subset requires
at least 99% performance-core CPU time and at most 2% between-build frequency
difference. There are no retries selected by a favorable timing result. Agreement
between CPU time, instruction counts, matched hardware and repeated same-binary
controls matters more than a small raw wall-time difference. The six scored
benchmark workers remain active, so these are paired comparisons under that load,
not measurements on an otherwise idle machine.

Decision rules:

- Any unexplained choice/value difference blocks retention until resolved.
- A clear speed gain with equal or lower complexity is a winner, provided the
  other measured stages do not show a meaningful repeatable regression.
- A real simplification can also win with performance demonstrated to be
  effectively unchanged; absence of statistical significance alone is not proof
  of equivalence. Report the uncertainty and the size of any plausible regression.
- Added machinery needs a convincing measured payoff. Do not retain it for an
  isolated microbenchmark improvement alone.
- Reject clear losers and retain their evidence separately. Following the user's
  2026-10-02 delegation, resolve remaining inconclusive calls conservatively and
  continue. Preserve the evidence for end-of-sequence review or rollback.

The remaining automatic decisions preserve all existing decisions, including
the user's explicit acceptance of #1. There is at most one fixed confirmation
sample. A negative opening interval together with more than 1% slower complete
hands in both roles can end a screen without confirmation. Otherwise confirmation
runs automatically. Retention requires a positive opening screen, a positive
confirmation interval, fewer instructions, positive gains in the predeclared
hardware-matched subset covering at least 75% of confirmation positions, and no
material dealer-first or whole-hand regression. The minimum opening gain is 0.5%
for a simple change and 1% for #5/#6, which add storage or broader lock handling.
Whole-hand pone time must not worsen; the dealer-first and dealer-total limits
are 0.5% slower. Unmet evidence requirements mean **set aside**, not proof of an
intrinsic slowdown. The policy and its six guard tests are archived with the
controllers. No failed correctness check may be converted into an acceptance.

## Scheduling

The user released the CPU slot after cancelling the other chat's calculations.
Its supervisor and three workers were independently confirmed gone. The existing
six-worker scored benchmark continues unchanged; run one trial worker at a time
on the remaining capacity, recording core use and frequency. The fresh baseline
PGO build has completed. Candidate #1's screen and bounded confirmation are now
complete. The user explicitly accepted #1, and its decision gate has been
released. Candidate #2 is to be measured against #1, with both changes in its
source. No additional measurement of #1 alone has been authorized or launched.

On 2026-10-02, #2's completed screen was reviewed and its one planned held-out
confirmation released. Its separate-position pone opening interval is −3.13%
to +2.37%; opening instructions decrease 0.13%. The mixed timing evidence does
not yet justify retention. The same accepted #1 binary remains its parent.

#2 confirmation subsequently completed. Separate-position pone CPU time increased
from 8.549283 to 8.645008 seconds (1.12% slower; nominal gain interval −2.01% to
−0.34%). Dealer first decisions were 1.29% slower. Actual whole-hand pone time
increased from 11.087173 to 11.131969 seconds (0.40% slower); dealer totals fell
from 1.106292 to 1.103769 seconds (0.23% faster). Opening instruction savings were
only 0.10%. All tested choices and values remained exact. Core matching again
failed, so this is not proof of an intrinsic slowdown; it is insufficient evidence
of the required incremental win. #2 is set aside and excluded from subsequent
candidates. #3 has been released against accepted #1, with no further #2 runs.

#3's screen was subsequently reviewed. Pone opening CPU time increased from
8.511949 to 8.629064 seconds (1.38% slower; nominal gain interval −2.12% to
−0.55%). Dealer first decisions improved 1.15%, but actual whole-hand totals
increased from 6.493362 to 6.757985 seconds as pone (4.08%) and from 1.270601 to
1.323485 seconds as dealer (4.16%). Opening instructions decreased only 0.22%.
All tested physical choices, EV/WP values and invalid-action recovery were exact.
Hardware matching was imperfect, so an intrinsic slowdown is not proven; the
screen nevertheless provides no timing case for retention or further measurement.
#3 is set aside. #4 has been released using only accepted #1 as its parent.

#4's screen passed 463 Rust tests and the exact decision/value corpus. Pone
openings were 0.19% slower, dealer first decisions 0.50% faster, and whole-hand
pone time 0.47% slower. Opening instructions fell 0.20%. Its single bounded
confirmation then showed only a 0.27% opening gain, with an interval spanning
−0.23% to +0.70%; instruction savings were 0.21%. Actual whole-hand gains were
0.15% as pone and 0.20% as dealer. Exact choices and values remained unchanged.
The evidence does not establish the required incremental speed win, so #4 is
set aside under delegated authority. #5 advances using only accepted #1.

Observed active duration through the initial screen is 34.3 minutes for #1 and
30.3 minutes for #2. #1's confirmation took 12.7 minutes. Review gates are separate
from computation and extended earlier wall-clock completion. Remaining decision
gates have now been replaced by automatic bounded adjudication under the user's
delegation. Versioned incorporation and final regression checks follow the
completed list and are not yet timed.

First screen completed on 2026-10-01. The pone-opening 95% fixture-bootstrap
interval is −0.67% to +1.86%; instruction count falls 0.45%. Dealer first decisions
are 0.46% slower in this small screen, while complete-hand totals are 0.14% slower
as pone and 0.93% faster as dealer. These results do not establish a winner.
No screen fixture meets the predeclared 99% performance-core condition; average
first-decision performance-core shares are around 84–85%. The planned held-out
confirmation has completed, with these results:

| Confirmation measure | Parent CPU seconds | Candidate CPU seconds | Nominal change |
| --- | ---: | ---: | ---: |
| Pone first decision, 12 separate positions | 8.690523 | 8.423255 | 3.08% faster |
| Dealer first decision, 6 separate positions | 0.944548 | 0.934753 | 1.04% faster |
| Pone first decision, complete-hand sample | 10.949045 | 10.894951 | 0.49% faster |
| Dealer first decision, complete-hand sample | 1.076002 | 1.080357 | 0.40% slower |
| Actual whole-hand pegging, pone | 11.137956 | 11.082150 | 0.50% faster |
| Actual whole-hand pegging, dealer | 1.093801 | 1.096808 | 0.27% slower |

The separate-position pone opening interval is +1.95% to +4.26%, and all twelve
positions have positive mean changes. However, performance-core shares differ:
79.47% for the parent versus 81.86% for the candidate. No fixture meets the
predeclared 99% condition. Same-binary opening drift has a 2.76% median absolute
value and reaches 9.97%. The interval does not account for systematic hardware
differences and must not be presented as a clean causal speed estimate.

Opening instruction counts consistently fall: 0.45% in the screen and 0.49% in
confirmation. This supports reduced work, but does not establish an equally
reliable elapsed-time benefit. Exact physical choices and EV/WP bits remain
unchanged across all 140 timed decision replays and 36 complete-hand replays,
in addition to the correctness corpus and Rust suite.

Per the user's bounded-confirmation instruction, measurement of #1 alone stops
here. This was a close call, not a demonstrated performance loser. The user
resolved it explicitly: “I’m ok with that. Accept it.” #1 is therefore accepted
into the cumulative 20.7 candidate for its small simplification and consistent
reduction in work, with the timing uncertainty preserved. This approval applies
to #1; later calls are now delegated to the agent. Candidate #2 uses #1's frozen
binary as its parent. The retained versioned route remains subject to final
integration checks; the scored 20.6 binary and production engine are unchanged.

No commit, push, deployment, or scored-benchmark restart is part of these trials.
