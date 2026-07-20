# Archived: Rust Model 16.0 Correction Plan

> Historical implementation record. The active execution plan is
> [`docs/model-improvement-roadmap.md`](../../model-improvement-roadmap.md).
> Do not treat the checklist below as current instructions.

## Goal

Create `schell_table-peg_table-16.0` as a distinct successor to 15.2. Keep
15.2 reproducible, and correct known architectural defects in 16.0 one at a
time with focused tests and a written completion record.

Production remains on 13.0 unless a later benchmark and explicit deployment
decision justify changing the public default.

## Checklist

### 1. Preserve Current-Hand Scoring Order

- [x] Register model 16.0 in the Rust engine, runner, API metadata, and browser
  development selector.
- [x] Keep pegging totals and both hand scores as separate distribution
  components through discard evaluation.
- [x] For 16.0 only, evaluate current-hand outcomes in this order:
  1. current pegging block;
  2. pone hand;
  3. dealer hand;
  4. crib.
- [x] Stop as soon as either player reaches 121, before evaluating later
  scoring phases.
- [x] Preserve 15.2 behavior unchanged for historical comparisons.
- [x] Treat the irreducible case where both aggregate pegging totals reach 121
  as 50/50, matching 15.2's exact-joint ambiguity policy. The pairwise asset
  does not contain card-by-card pegging event order.
- [x] Add regression tests for pone-first count-out, dealer hand before crib,
  pegging before hands, and aggregate pegging ambiguity.
- [x] Run formatting, Rust tests, frontend typecheck/build, a release build,
  and a 16.0 runner smoke game.

## Completion Record

- 2026-07-17: Registered `schell_table-peg_table-16.0` as a native Rust
  strength model. It inherits 15.2's exact-joint future-pegging evaluator and
  existing runtime assets. Application/package metadata is now 16.0.0.
- 2026-07-17: Added a 16.0-only current-hand outcome path that retains own
  pegging, opponent pegging, own hand, and opponent hand as separate weighted
  components. Models through 15.2 retain the historical collapsed path.
- 2026-07-17: Ordered terminal evaluation now stops after the first winning
  phase: aggregate current pegging, pone hand, dealer hand, then crib. If both
  sides cross inside the aggregate pegging block, the result is 0.5 because
  the pairwise table cannot recover the missing card-by-card event order.
- 2026-07-17: Rust workspace tests passed (55 tests), along with Rust format,
  TypeScript typecheck, client artifact validation, production client build,
  and optimized API build. A release runner smoke game completed in eight
  hands and 100 steps: 16.0 scored 114 and 13.0 scored 121.
- Production was not deployed or switched. The public default remains 13.0.

## Future 16.0 Corrections

- Add subsequent 15.2 problem reports here as separately testable checklist
  sections. Do not fold unrelated behavior changes into item 1.
