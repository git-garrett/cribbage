# Observation simplification assessment

Date: 2026-10-01. Decision: do not incorporate this proposal or register Model
20.7 on its account. Stop at the complexity gate. The active frozen Model 20.6
versus Ace benchmark and all retained engine code are unchanged.

The requested acceptance criteria are simpler maintained code, exact legal
information and playing behavior, and no demonstrated performance regression.
This assessment does not establish that every possible observation redesign
would fail. It finds that the proposed regrouping does not yet provide enough
deletion or simplification to justify an engine implementation and timing run.

## Finding that changes the original recommendation

The simulator already has one owner of the relevant public state:
`RankPegState`, in `information_set.rs`. Its play, go and reset operations update
history, sequence, count, last player and go player together. The public fields
are not a fully encapsulated interface, but separating them into another object
does not itself consolidate scattered implementations of the game rules.

The two played-rank totals in `Model132Observation` are constructed from public
history when an acting-player snapshot is made. They are not two more public
state caches that the simulator currently has to keep synchronized after every
move. Adding them to an incrementally maintained public object would introduce
that maintenance obligation.

The three views have distinct consumers:

| View | Consumer | Consequence of removing it |
| --- | --- | --- |
| Ordered public events | Opponent likelihoods and their cache | Losing order/go/reset evidence changes beliefs. |
| Per-player played-rank totals | Legal posterior/deck depletion | Reconstruct totals when preparing the compact policy query. |
| Current sequence and count | Legal actions and pegging scoring | Reconstruct the current sequence and count at their point of use. |

`Model911Policy::model91_observation` prepares the fixed-size `Model91Observation`
used by the recursive solver and cache keys. Moving the outer fields behind
getters would leave this conversion and its required information in place.

## Approaches evaluated

1. **One public owner with summaries.** A small executable representation probe
   confirms it is possible to reconstruct the summaries without private cards.
   In the actual engine, replacing the already-centralized public part of
   `RankPegState` would mainly regroup its current responsibilities. Maintaining
   played totals in that object would add derived state. This does not yet
   remove the actor-relative observation, likelihood-history key, compact query,
   or root reconstruction contract.
2. **History as the only stored public representation.** This removes fields,
   but consumers still require their values. Reconstruction is extra work unless
   summaries are cached, which returns to the first design. No speed result is
   asserted for this approach.
3. **Borrowed legal view.** It could avoid copying the current series and
   actor-relative history. However, the current batch rollout stores observations
   alongside mutable lane states, reuses their buffers, and invokes a policy
   interface that accepts the owned observation. A borrowed route must replace
   this storage/interface arrangement and account for relative history cache
   lookup. An additional adapter or materialized compact-query path would add
   machinery without deleting the historical paths required by frozen 20.6.
   This remains a potential larger design study, not a demonstrated simplification.

No Rust engine prototype was incorporated or built. In particular, no second
policy path, model switch, public-state cache, or version identifier was added.

## Checks actually performed

The standalone public-state representation probe uses only public play/go/reset
events. It compares its summaries with independently stored table cards,
sequence, count and turn flags from:

- 128 saved decision inputs;
- 64 distinct saved whole-hand replays;
- both actor perspectives: **384 exact public-view comparisons**.

Those whole-hand histories contain 503 plays, 114 go events and 73 resets. Some
games end on the board before all eight cards are played. These are saved inputs
and results, not newly evaluated games or new whole-hand timing measurements.
The probe tests representation equivalence; it does not run a modified model or
establish its physical-card/EV/WP parity.

Six existing tests were rerun against the previously built, unchanged final
20.6 test executable. All passed. They cover 512 randomized transition hands,
reused versus fresh observations across actors/worlds/go/reset/error recovery,
hidden opponent information exclusion, own-discard/cut inclusion, and ordered
history preservation. Test names, executable hash and outputs are archived.
They validate the existing implementation; they are not claimed as tests of an
unimplemented engine refactor.

No compilation, new recursive decision workload, or comparative timing run was
started. The ongoing six-worker benchmark and the other chat's three background
calculations were not stopped or altered. Tiny representation checks and the
six focused existing tests were ordinary foreground correctness checks.

## Decision and evidence

The safety of a compact public representation is credible, but that alone does
not satisfy the user's requirement to reduce complexity. The simple designs
examined either regroup existing ownership, move reconstruction work, or add a
second interface. Therefore no performance or playing-strength claim about a
new model is made, and 20.7 is not created by this assessment.

Artifacts are in
`benchmarks/model20/evaluation-20261001/model207-observation-assessment`:
the probe, results, input hashes, focused-test outputs, and a snapshot/hash of
the four reviewed frozen source files. Original saved cases are identified by
their source paths and hashes in the results.
