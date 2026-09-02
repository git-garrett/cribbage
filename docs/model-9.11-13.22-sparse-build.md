# Model 9.11 baseline and Model 13.22 sparse correction

## Decision

Build Model 9.11 as the context-free 4-card-keep by 4-card-keep matrix used by
Model 9.1, but make every non-forced decision with the updated executable
pegging policy. That policy includes the Model 13.22 go and scoring-decline
likelihood updates. It receives only the acting player's legal observation.

Build Model 13.22 by applying actor-owned dead cards and the cut to Model 9.11.
For each baseline action:

1. Reweight the cached complete-opponent-hand evidence for the actor's two
   discards, the cut, observed goes, and observed scoring declines.
2. Reuse the Model 9.11 terminal cell while the chosen action is unchanged.
3. At the first changed action, replay only the corrected suffix and save the
   resulting terminal delta. Pone lead corrections may be packed as cut-rank
   masks.

The baseline cell is durable. Its action trace and all action-by-hidden-hand
evidence are builder-local and are never shipped as an observation-to-action
table or exhaustive path graph.

## Cache organization

The expensive continuation evidence is keyed without the actor's private
discards or cut. A correction reuses it and changes only the physically valid
hand weights and the empirical go/decline likelihoods. The cache is bounded by
the number of action-by-hidden-hand outcomes, not just by key count.

Baseline creation and correction remain separate logical stages, but a worker
processes them consecutively for each keep pair. This keeps the baseline's
evidence hot for its corrections. Calibration rejected clearing the evidence
for every pair and rejected a cold second correction pass; both lost most of
the available reuse.

Before the first changed action, screening factorizes by actor. For a fixed
keep pair, an actor's baseline-path decision depends on that actor's own
two-card discard, the rank-only cut, and public history—not the opponent's
private two-card discard. Therefore the production pass screens at most
`2 * 91 * 13 = 2,366` actor contexts per compatible keep pair instead of the
cross product of both players' discard contexts. The other actor's context is
joined only when a changed action requires an exact suffix replay.

## Calibration

Run:

```sh
cargo run --release -p cribbage-policy-trainer --bin calibrate_model911_delta -- \
  --output /tmp/model911-delta \
  --beliefs rust/cribbage-shadow-engine/assets/model91-pegging-beliefs.bin \
  --factors rust/cribbage-shadow-engine/assets/model1322-decline-factors.json \
  --pairs 100 --contexts-per-pair 8 \
  --action-cache-limit 100000 \
  --evidence-cache-outcome-limit 500000 \
  --future-cache-limit 5000000
```

The calibrator compares every sparse result with a fresh full Model 13.22
rollout and fails on any mismatch. It reports baseline throughput, edit
throughput, cache reuse, action and terminal change rates, full-replay speed,
and both raw and actor-factorized projections.

The September 1, 2026 row-major 100-pair calibration measured 4,581 corrected
contexts/second on one worker, 183.1 times the fresh full-replay rate. Actions
changed in 7.875% of sampled contexts and terminal scores changed in 6.375%.
All 800 sparse outcomes matched fresh full rollouts exactly. At that measured
rate the 7.747-billion actor-screen upper bound is about 3.26 ideal days on six
workers, before adding the less common changed suffix work. This makes the
architecture feasible enough for a production-distribution pilot, but does
not yet prove the final full-build wall time.
