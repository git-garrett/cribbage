# Schell Table + Peg Table 14.6

14.6 is a controlled successor to 14.5.

It keeps the 14.5 pegging frontier asset, but changes discard-time evaluation so frontier alternatives are scored directly by board-position win probability instead of first collapsing them to one `frontier-on` and one `frontier-off` representative.

## Discarding

14.6 evaluates:

- crib policy: EV plus every indexed full-frontier crib policy
- pegging policy: EV plus every indexed pegging frontier policy

The engine scores every crib/pegging policy combination by current-board win probability and uses net EV only as the tie-breaker.

Missing indexed frontier rows fall back to EV for that row.

## Crib Table

14.6 replaces 14.5's three-policy crib frontier binary with a full-frontier binary:

- source JSON: 225 MB
- packed binary: about 13 MB
- stored frontier entries: 14,196
- maximum frontier entries per root: 12

The packed table preserves all frontier entries needed for runtime win-probability evaluation without shipping the large JSON source.

## Pegging

Actual pegging play remains the live model-13 style tree used by 14.5.

For discard-time pegging forecasts, 14.6 uses the 14.5 pegging frontier table but exposes indexed frontier policies instead of only `frontier-on` and `frontier-off`.

## Purpose

This model tests whether the 14.5 frontier data is useful when the runtime evaluates the frontier alternatives directly under win probability instead of using raw point-shape representatives.
