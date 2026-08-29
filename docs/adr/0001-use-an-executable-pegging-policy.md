---
status: accepted
---

# Use an executable legal-information pegging policy

Pegging moves will be computed by an algorithm from the acting player's legal observation and beliefs. The project will not build a persistent table mapping pegging observations to actions, nor an exhaustive graph of pegging paths: the observation space is combinatorial, prior Model 16 lookup experiments had poor held-out coverage and strength, and full path materialization produced impractical size projections.

Decision-local memoization is permitted because it only avoids repeated work inside one solve. Offline discard assets may store terminal score outcomes for finite four-card keep pairs or aggregated distributions for finite six-card/discard contexts; they must not store actions keyed by pegging observation. Runtime may reweight keep-pair outcomes using legally known dead cards.
