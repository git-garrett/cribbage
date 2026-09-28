# Obsolete opening work assessment

The preceding action-cache improvement is committed and pushed as
`9bb8adf404ba3631bc187cc32568bc4dbe38239e` on
`work/model203-forced-choice`. This assessment builds on that revision.

## Does obsolete work arise normally?

Yes, through the ordinary Ace Forfeit flow. Ace begins its pone opening after
its discard recommendation, while the human can still be selecting discards.
The normal Home/Back dialog offers Forfeit without waiting for that calculation.
The API previously marked and persisted the game as forfeited but left its
opening thread and waiting play requests alive until the engine finished.
A deterministic API regression test reproduced this through `game_action`:
the game ended successfully while the blocked opening remained registered and
its waiting result remained unresolved.

This is a lifecycle issue, not evidence of repeated wasted opening solves during
an uninterrupted hand. Preparation projects the actual discard and cut; existing
tests cover all 15 opponent discards over 32 seeds, including heels. Confirmation,
reveal, duplicate play requests, and active resume reuse the same legal key.
The game cannot advance past that opening until its result is available, so a
normal next-hand replacement occurs after the old job has completed. A hidden
or saved game remains resumable; its calculation is not automatically obsolete.

The native benchmark runner does not use the API opening registry. Its playout
and frozen-engine adapter wait synchronously for a decision before advancing.
There is no corresponding obsolete-opening queue to remove from the benchmark,
and this change is not a benchmark throughput optimization. A general priority
scheduler has no demonstrated requirement from this assessment.

## Narrow change

A successfully persisted forfeit removes its opening job and signals cooperative
cancellation. Replacing a still-running registry job also cancels the old one.
Matching preparations remain deduplicated. Cancellation immediately resolves
waiting requests with an error, while the worker exits at its next checkpoint:
preparation checks between hidden hands, and forecasts check once per 256 worlds.
There are no per-node cancellation checks inside the expensive inner solver.

Result publication and cancellation share the result mutex. A late success
cannot overwrite cancellation, and a cancelled forecast never publishes a
partial candidate or a fallback move. A failed persistence operation or an
unauthorized forfeit leaves valid work available. The original legal-position
check before applying a prepared move remains in place.

Saving or hiding a game keeps valid preparation. No process-priority change,
worker pool, speculative search expansion, or model-policy change was added.
No benchmark restart or deployment was performed.

## Verification

- The normal-forfeit regression failed before the fix and passed afterward.
- Matching requests continue to share work; a changed observation cancels only
  its obsolete job, and the replacement can complete normally.
- Unauthorized and failed-to-persist forfeits preserve the existing calculation.
- Cancellation is sticky within its job and does not contaminate another job.
- Both forecast paths return cancellation rather than partial candidates when
  interrupted during a rollout; existing uncancelled histogram comparisons
  retain every terminal probability bit-for-bit.
- `npm test`: 425 tests passed across 21 targets. Only the existing
  `WeightedEntry` and test-build `send_feedback` warnings were emitted.

A release test started the real Ace 13.23 opening and sent the ordinary Forfeit
request after the first progress batch. The worker stopped in **6.295 ms**,
including the request's database work and cancellation polling. Progress moved
from 256 to 512 out of 143,648 candidate/world pairs before the worker exited;
it returned cancellation, not a move. This is one measured cancellation latency,
not a bound: initial asset loading or an individual long rollout is not forcibly
preempted. The current Ace forfeit path uses 13.23; the same engine checkpoints
also serve the 20.x opening registry.

## Uncancelled decisions and overhead

The first diagnostic build used Cargo's standalone default release profile and
showed added CPU time (about 1.6% on discovery positions). That build does not
match this repository's production settings. Both workers were therefore rebuilt
with `codegen-units = 1` and `lto = "thin"`, matching `rust/Cargo.toml`, without
changing the cancellation implementation. The initial binaries and results are
retained rather than discarded.

Production-profile aggregate CPU:

| Path | Comparisons | Baseline | Cancellation capable | CPU change |
| --- | ---: | ---: | ---: | ---: |
| No progress observer (benchmark path) | 6 | 22.911322 s | 22.574349 s | -1.47% |
| Progress observer (live opening path) | 20 | 40.915365 s | 40.549536 s | -0.89% |
| Held-out positions with progress | 12 | 17.971434 s | 17.852854 s | -0.66% |

All 26 production-profile comparisons matched serialized action, physical card,
EV, and WP exactly. The 26 preliminary comparisons also matched. The production
results show no aggregate slowdown in this sample; the small CPU reductions are
not claimed as an algorithmic speedup from cancellation. Individual cheap
positions vary slightly in either direction. Fixtures include both roles, first
and later decisions, held-out positions, and two close-endgame positions. Worker
order alternates, both variants use the same frozen speed-v4 model assets, and
measurements use in-process CPU time. These are individual decision tests, not
whole-game throughput or population-wide UX estimates.

## Artifacts

`/private/tmp/cribbage-203-cancel-work` contains the real-cancellation measurement,
clean baseline/candidate release workers, timing adapter, paired replay, and raw
results. The baseline is the committed action-cache improvement, so comparisons
do not conflate that speedup with this cancellation change.
