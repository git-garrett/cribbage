# 20.5.pegging: bucketed strategic pegging experiment

Implemented 2026-09-30 as `schell_table-peg_table-20.5.pegging` (short selector
`20.5.pegging`). This is a separate experimental model, not a replacement for
20.5, a production Ace promotion, or a benchmark restart. Discard decisions and
immutable learning assets remain those of 20.5.

## Defined first experiment

This implements a complete best response for the root player against the fixed
20.5 executable opponent policy. It optimizes every remaining root-player choice
through the end of pegging, without a sampled hand population or depth cutoff.
It does **not** recursively replace the opponent policy or solve an equilibrium
between two improved policies. Both real seats may select the new model, but
each live solve forecasts its opponent with the existing observation-only policy.

The initial distribution uses the existing smoothed keep posterior, conditioned
on the live player's known cards and real public history, and conditional
opponent-discard support. It retains every positive-weight world. Opponent
discards are necessary because they affect that player's legal beliefs and moves.

For each root candidate, the engine advances each hypothetical world through
forced plays and the opponent's selected moves. At a root-player choice, it
collects all worlds with the same complete modeled legal observation. It then
evaluates each legal action across the entire bucket, selects the largest
weighted terminal WP, and applies that shared choice to every member. Different
worlds retain their own outcomes. Ties use immediate points, then higher rank,
matching live selection. Only frontiers and the recursion stack are retained;
there is no persistent action table or stored exhaustive pegging-path graph.

Buckets retain role, scores, own cards/discards, cut, ordered public history,
current series/count, go and last player. Opponent private cards never enter the
root player's bucket identity. Numerical chunks only batch independent opponent
queries; no decision is made using a partial bucket.

The opponent receives only its own `Model132Observation`. It reconstructs its own
posterior; it never receives the root-conditioned distribution, which fixes the
root player's actual hand. This prevents the otherwise subtle leak caused by
pooling A's worlds at B's turn.

## Beliefs and utility

Real observed history uses the existing empirical inference model once, at the
root. For hypothetical future history, the frozen opponent policy determines
which worlds reach each observation. Restriction to those worlds supplies A's
conditional posterior. We do not apply empirical decline factors again to those
simulated actions. Hypothetical branches with no positive reach mass need no
decision. At a later real decision the model replans from its empirical posterior.

The terminal objective is the existing root's known-card, counting-aware WP
function. Each bucket compares weighted WPs, not WP of average points. Its root
counting context is held fixed during the solve, as in the existing forecast;
it is not a world-specific exact joint show/crib calculation. This remains an
approximation, as do the opponent model and empirical beliefs.

Within this specified fixed-opponent/root-utility problem, the bucket search
contains the old root player's continuation policy as an available strategy.
Its optimum therefore should not have a lower predicted root WP than that
policy. This is an internal consistency check, **not evidence of higher actual
win rate**, and it does not establish optimal play against the new model itself.

## Integration and validation

Live recommendations, hand-cache calls, selected-action review, and combined
review use the new solver only for its own identifier. It is registered with the
Rust runner, API and local model selector. Other models retain their decision
paths and Ace keeps its existing alias.

Focused tests compare the search with an independently written exhaustive
enumeration of deterministic legal strategies on small positions. Tests include
nonuniform posteriors, duplicate ranks, a real strategy-fusion counterexample,
world reordering, equivalent weight splitting, numerical batch sizes, private
information separation, go/reset sequences, immediate scoreouts, invalid
probabilities/utilities and cancellation. Integration checks cover unchanged
discards, model/cache isolation and agreement between live and review results.
Final validation passed: 445 Rust tests across 22 targets, web tests, TypeScript
typechecking, and the isolated native release build. The screen's frozen Rust
source hashes match the implemented source.

The separate feasibility build and saved-position screen are supervised by
`/private/tmp/cribbage-205-pegging-20260930/job-v1.json`. It freezes source hashes,
uses one ordinary release binary for both model IDs, warms assets, alternates
execution order, and records wall time, CPU and hardware/core counters. It does
not retrain PGO or control core placement. These first measurements establish
feasibility, not a dependable percentage speed estimate. Per-decision screen
timeouts report an incomplete measurement; they do not change the model or
silently substitute a fallback move. Whole-hand timing is not inferred from
these partial-hand fixtures. Playing-strength acceptance remains untested.

## First release screen

All four saved positions completed and chose the same physical card as 20.5.
The new predicted root WP was greater in three positions and equal within
floating-point precision in one. The first-decision measurements were:

| Role | 20.5 wall / CPU | 20.5.pegging wall / CPU | P-core CPU fraction, old / new |
| --- | ---: | ---: | ---: |
| Pone | 18.990 / 18.698 s | 28.243 / 27.906 s | 74.3% / 73.8% |
| Dealer | 2.541 / 2.190 s | 3.330 / 3.211 s | 56.1% / 65.7% |

These are one position per role, no PGO, with concurrent benchmark load. They
show a runnable solver with a substantial cost on the sampled pone opening;
they do not establish a population timing ratio. CPU tick counts were converted
using the host's Mach timebase. No whole-hand totals or actual win-rate improvement
are claimed. Full results and frozen source hashes are in
`benchmarks/model20/evaluation-20260930/model205-pegging-screen` in the main checkout.
