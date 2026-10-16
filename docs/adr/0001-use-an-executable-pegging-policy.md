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

## Model 29 training exception, 2026-10-16

The user authorized a rolling, approximate opening cache for Model 29 self-play.
Each chunk records its computation's completed-game count, generation and code
identity. It is eligible for fewer than 50,000 subsequent completed full games;
hits do not change its birth count. On a miss or expiry the current executable
solver supplies the decision and captures its public dealer choices for reuse.
No early fresh-solve audits and no proactive refresh are scheduled. Incompatible
code invalidates immediately. The inherited 28.3 bank starts at game zero after
an explicit generation-zero parity check; its original fingerprint and checksums
remain enforced. The production exact-cache contract above is unchanged.

This exception knowingly permits policy lag between asset updates. Record cache
generations with learning evidence. It does not authorize a general pegging-path
graph. Fresh-policy evaluation disables this approximation. The sparse modern
discard forecast stores sampled full-hand score outcomes for suit-canonical six,
discard, role and actual pre-cut board; it stores no actions and never translates
these outcomes to other boards.
