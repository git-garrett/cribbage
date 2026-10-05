# 20.5.pegging2: symmetric backward bucket decisions

Implemented 2026-09-30 as `schell_table-peg_table-20.5.pegging2`, with short
selector `20.5.pegging2`. Discards and immutable learning assets come from 20.5.
This is a separate experimental model; the earlier `20.5.pegging` remains the
one-sided best response against the original executable opponent policy.

Correction after the first screen: this implementation recursively rebuilds
hidden worlds for uncached observations. It does **not** implement the requested
single backward pass over equivalence-grouped continuations. Its cost must not
be presented as a measured cost of that proposed implementation. The first
screen also changed root valuation, which was an unrelated change; that change
has been removed as described below.

## Decision rule

Both simulated players use the new continuation-choice rule. The live root
retains the original counting-aware valuation. For an acting player's complete
modeled legal observation, construct
their posterior over compatible opponent keeps and discards. For each legal
rank, finish every positive-weight world using the same rule for later choices.
Average the resulting terminal win probabilities using that bucket's weights,
then select the best rank. Ties use immediate points, then higher rank.

Later choices are resolved before earlier choices. The implementation visits
dependencies recursively rather than materializing the entire public game tree.
Each nested nonforced choice has fewer cards remaining, so this is a finite
backward calculation. Go, reset, forced plays and immediate game termination
are handled by the existing rules engine. Inner candidate pruning uses an
optimistic remaining-probability bound and a floating-point allowance; root and
review forecasts return complete candidate distributions.

Completed choices are memoized by full observation equality for this solve
only. The key includes role, board scores, own cards and discards, cut, ordered
public history, current series/count, go and last player. Once 200,000 entries
are admitted, further misses are recalculated; there is no policy substitution,
partial-answer acceptance, persistent action table or stored exhaustive graph.

## Information and beliefs

An opponent's bucket is reconstructed from that opponent's observation. It is
not taken from the root's collection of worlds: that collection fixes the root
player's actual hand and would leak it. Rebuilding the opponent's posterior
restores uncertainty about the root's hand. Each indistinguishable observation
gets one shared action; individual worlds retain their own resulting scores.

Both players use the existing empirical keep prior and history-likelihood
model, including its legal-support fallback when empirical support is empty.
These are fixed belief rules. The search does not re-estimate them from the
reach probabilities of its newly optimized strategies. Consequently this is
symmetric strategic search under fixed empirical beliefs, not an equilibrium
solver or a claim that its beliefs are consistent with the resulting policy.

The existing policy object is reused to obtain beliefs only. Its move chooser
and its averaging of future legal actions are not used by this variant.

## Preserve the valuation being controlled

The first implementation incorrectly replaced the live root's counting-aware
valuation with the generic inner after-pegging WP table. Symmetric strategic
choice did not require that removal. The original root valuation is restored:
the exact own hand score, posterior opponent-hand score distribution, and
known-card-conditioned crib distribution are counted in the original order,
including immediate wins at every counting stage.

Both simulated actors retain 20.5's existing inner after-pegging WP objective.
This preserves the baseline's live/inner valuation distinction rather than
silently changing it during a continuation-strategy trial. It does not claim
that the live and simulated decision problems now have identical valuations.
Changing that distinction would be a separately specified experiment.

For this and subsequent trials, preserve existing valuations, beliefs, legal
information, assets and tie rules unless changing that exact behavior is the
stated experiment. Do not simplify them merely to make a trial easier to build.

## Requested backward grouping versus this implementation

The requested traversal groups equivalent states at each remaining-card stage,
compares legal moves using their weighted state values, and passes the chosen
continuations to the preceding stage. The current recursive implementation
instead generates a new posterior population at each uncached decision. The
small bottom-up test reference verifies a decision rule; it does not prove the
production traversal matches the requested architecture.

The terminal unseen-card alternatives describe different hidden deals. They
are not all playable alternatives within one bucket. With one card remaining,
each actor's legal bucket has a forced play or go. Maximization applies only
between moves legal in the same bucket; uncertainty across hidden deals stays
weighted. Go/reset events also mean the eight card plays need not alternate
strictly between players.

Any shared population for a backward traversal must preserve the opponent's
uncertainty about the live player's hand. Grouping only worlds conditioned on
the live player's actual hand cannot supply that uncertainty. This information
requirement does not prescribe rebuilding a population at every observation,
and does not by itself establish the cost of a grouped implementation.

## Validation

An independent small-position reference enumerates legal continuations, collects
observations, and solves them in increasing remaining-card order. The production
recursive solver matches its decisions and values for both roles with
nonuniform priors, midgame and near-terminal boards. Other checks cover hidden
information separation, go/reset transitions, world order, split weights,
cache order, pruning versus no pruning, cancellation, scoreouts and invalid
weights. Integration checks cover live/review/hand-cache agreement, unchanged
discard decisions, and isolation from the other model identifiers.

The first screen passed 451 Rust tests across 22 targets, web tests and TypeScript
typechecking. A regression test added with the correction checks bit-identical
root utilities against 20.5 and 20.5.pegging across both roles and 702 score pairs
per role/model, plus identical selection and valuation for identical candidate
forecasts. These checks establish implementation behavior, not playing strength
or conformance to the requested backward-grouping architecture.
After restoring the original root valuation, the full Rust suite passes
452 tests across 22 targets. The correction does not alter the search traversal.

## Historical release screen, before the valuation correction

The isolated job is
`/private/tmp/cribbage-205-pegging2-20260930/job-v1.json`. It freezes the source
hashes and assets, builds an ordinary optimized release, and screens five saved
positions with a 60-second cancellation limit per search. Cancellation is a
diagnostic limit only; the model has no timed fallback. A cancelled search
produces no decision and is not counted as a completed opening.

The screen does not train PGO or control CPU placement, and the existing paired
benchmark continues concurrently. It records wall time and search work, not a
reliable population timing ratio. These fixtures do not provide whole-hand
pegging totals. Verified results are saved in the main checkout under
`benchmarks/model20/evaluation-20260930/model205-pegging2-screen`.

All five screens and the optimized reference tests finished. Two decisions
completed; three searches were cancelled at the limit without returning a move:

| Position | Wall time | Completed candidate/world continuations | Completed buckets |
| --- | ---: | ---: | ---: |
| Near-terminal position, four cards remaining | 0.064 s | 67,188 | 3,277 |
| Pone later decision, four cards remaining | 0.358 s | 369,399 | 14,149 |
| Dealer later decision, five cards remaining | >60 s, incomplete | 56,049,258 | 74,229 |
| Dealer first decision | >60 s, incomplete | 67,969,954 | 150,553 |
| Pone first decision | >60 s, incomplete | 61,580,547 | 180,753 |

The three cancelled searches recorded respectively 46.7, 37.4 and 39.0 million
memo hits, with **zero cache-admission skips**. None reached the memo capacity.
This screen therefore exposes a large amount of required recursive work even
with effective reuse; cache eviction is not its cause. In the pone opening,
only one five-card bucket and no six- or seven-card buckets had completed when
the screen stopped. The counts are work completed before cancellation, not
estimates of the full tree's size or time to finish.

This recursive implementation has not demonstrated practical opening
performance. Neither these timings nor the old root WP values establish the
performance or playing strength of the requested grouped implementation. The
saved source hashes identify the pre-correction build; no corrected timing run
has replaced it. No production deployment or paired benchmark restart occurred.
