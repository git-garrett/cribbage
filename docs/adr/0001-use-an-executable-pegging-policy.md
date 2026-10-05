---
status: accepted
---

# Use an executable legal-information pegging policy

Pegging moves will be computed by an algorithm from the acting player's legal observation and beliefs. The project will not build a persistent table mapping pegging observations to actions, nor an exhaustive graph of pegging paths: the observation space is combinatorial, prior Model 16 lookup experiments had poor held-out coverage and strength, and full path materialization produced impractical size projections.

Decision-local memoization is permitted because it only avoids repeated work inside one solve. Offline discard assets may store terminal score outcomes for finite four-card keep pairs or aggregated distributions for finite six-card/discard contexts; they must not store actions keyed by pegging observation. Runtime may reweight keep-pair outcomes using legally known dead cards.

## Scoped opening-asset exception, 2026-10-05

The user authorized the measured 28.3 opening accelerator for production. It may
persist the identical executable dealer policy for a fixed cut rank, post-cut
board and lead rank. The actual pone still evaluates its legal choices with its
known discards and suited counting at runtime. A missing or incompatible asset
must use the unchanged executable solver, never an approximation. Build full
chunks locally, retain them for local runs, and publish only the first two dealer
card replies to production. Assets must bind to the exact policy and learning
inputs, preserve legal uncertainty and ties, and pass exact parity checks. This
does not authorize a general exhaustive pegging-path graph or an approximate
observation lookup policy. See `docs/research/ace283-production-rollout.md`.
