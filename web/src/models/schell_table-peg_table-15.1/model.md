# Schell Table + Peg Table 15.1

15.1 is the Rust strength model based on 15.0 with a revised future board
win-probability evaluator.

When future board evaluation enters the pegging phase, 15.1 treats the
aggregate pone and dealer pegging score distributions as one joint pegging
block. If both players cross 121 in that aggregate pegging block, the outcome
is scored as indeterminate at 50/50. If only one player crosses 121, that
player is awarded the win. This avoids giving automatic precedence to
`peggingPone` merely because the aggregate board model enumerates it before
`peggingDealer`.

The Rust evaluator also keeps board states as integer score states internally.
Outcome uncertainty stays in weights, not fractional board scores.

At `peggingPone` cycle boundaries, 15.1 collapses the full future hand cycle
into one exact transition:

1. joint pegging block
2. pone hand
3. dealer hand
4. crib
5. role swap

Terminal outcomes are still checked in that order inside the transition, so the
cycle transform is a performance optimization rather than an intentional
playing-strength approximation.
