# Model 13.22 six-card builder calibration

> Historical calibration: the direct six-card cross-product described here
> was rejected on throughput. The selected design is the Model 9.11 baseline
> plus sparse dead-card correction in
> [model-9.11-13.22-sparse-build.md](model-9.11-13.22-sparse-build.md).

Model 13.22 replaces the reusable four-card keep key with the complete
six-card rank hand plus its candidate two-card discard. Dealer and pone are
evaluated in the same physically compatible hidden world, and each available
cut rank is run once with its remaining physical-card multiplicity. The
calibration exercises the production-shaped inner loop; it is not yet a
complete production asset.

## Playing-engine contract

1. Forced play or forced go is applied without invoking the policy.
2. An opponent go makes every rank that was legally playable at that count
   impossible in the opponent's remaining hand.
3. If the opponent legally could have completed a scoring rank and played
   another rank, compatible opponent cards receive the versioned empirical
   likelihood from
   `rust/cribbage-shadow-engine/assets/model1322-decline-factors.json`.
   The schema-3 asset stores both the directly observed probability that the
   opponent held that rank given the decline and the likelihood multiplier
   used to update the policy's current opponent-hand prior.
   Pair evidence distinguishes a declined pair royal after a pair, a declined
   four of a kind after a pair royal, and the stronger cases where a pair or
   pair royal could not be punished because the reply card was dead, held,
   already played, could not be played under 31, or the opponent had already
   said go in that round. Factors are split by the player's first, second, and
   third card. Empirical opportunities are excluded once the other player has
   no cards remaining and whenever the chosen alternative itself scores,
   because that is a competing scoring choice rather than evidence of avoiding
   the candidate score.
   Counts and source-database checksum are retained so a later model can
   regenerate the factors. Multiple decline observations are currently
   combined as independent likelihood evidence.
4. One paired rollout returns both dealer and pone pegging totals. Builders
   must aggregate both outputs rather than rerun the reversed role solely to
   recover the second total.
   The offline builder may enumerate both complete hands and use them for
   exact state advancement, scoring, weighting, and physical compatibility.
   Both simulated players select moves through the same bounded executable
   policy, which receives only that player's legal observation. This retains
   Model 13.0's fast exact-pair traversal without allowing its
   `optimalPegging` routine to select an action from the hidden opponent hand.
5. Pone opening-lead output is thirteen 13-bit masks per six-card/discard
   context: mask `r` contains the cut ranks for which lead rank `r` is best.
   Runtime can therefore select a lead after the cut by a bounded lookup.
6. The builder has two executable-policy modes. `fast` follows only the
   realized exact path. `complete-hand` uses Model 9.1's architecture: from the
   actor's legal observation it enumerates compatible complete four-card
   opponent hands, reweights them for all known dead cards plus go/decline
   evidence, and evaluates the continuation EV. Builder clairvoyance never
   enters this policy call.
7. Complete-hand fallback enumeration uses one immutable rank-hand index shared
   by every policy instance. It pre-enumerates the 0- through 4-card rank hands
   once and stores compatibility bitsets for each rank/copy limit. Each legal
   observation intersects those bitsets using its currently known dead cards,
   then computes the same exact physical multiplicity as the recursive
   enumerator. The empirical played-card prior remains preferred when it has a
   matching row and is filtered by the same legal availability limits.
8. Complete-hand action and continuation caches are in-memory and local to one
   worker. The action key contains the entire legal observation and posterior
   likelihoods; continuation entries contain exact hypothetical solver states.
   Exact worlds are streamed in deterministic order. The first occurrence of
   an observation computes its action and later identical observations reuse
   it naturally; the builder neither scans ahead to group worlds nor retains
   materialized posterior-hand vectors. The continuation capacity is checked
   between decisions, so a recursive decision may temporarily exceed the
   target. These caches are pure memoization of the executable policy, are
   discarded when the worker exits, and are never packed into the model asset.
   Pone opening leads are evaluated once per six-card/discard/cut context and
   reused across compatible exact opponent worlds.
9. The production Model 13.22 release must execute the same policy mode used
   to build its asset. The builder and live engine may not maintain separate
   interpretations of go, safe retaliation, card ordinal, competing scores,
   held-card decline evidence, or compatible-hand weighting.

`Model1322FastPolicy` scores only the actor's legal ranks and the at most
thirteen possible public-information reply ranks. It evaluates no reply after
the opponent has said go. `Model1322HeuristicPolicy` is the stronger
complete-hand mode used by the maximum-memoization throughput test. Neither
mode writes an observation-to-action table or pegging graph. Durable output
contains only aggregated six-card/discard score summaries and opening-lead cut
masks, consistent with ADR 0001.

## Calibration workload

For each sampled six-card root the test determines the exact number of rollouts
required by every own discard/role row, every compatible opponent four-card
keep with nonzero role-prior weight, every physically compatible private
discard in the stored conditional histogram, and every available cut rank.
The expensive timing sample executes a deterministic spread of opponent keeps;
the exact workload counter still visits the complete prior. The report projects
the mean exact root workload across all 18,395 canonical six-card hands and
states measured aggregate throughput and full wall-time.

## Maximum-safe-memoization throughput test

The 2026-08-31 test used the conditional discard histograms, complete-hand
policy, one deterministically selected opponent keep per role, all own
discards, all cuts, and roots spread across the canonical range. Hidden exact
hands were supplied only to the builder loop; the policy-invariance regression
test verifies that changing the builder's hidden opponent hand cannot change
an action when the legal observation is unchanged.

The cache sweep found that a 100,000-entry action cache was already ample and
never cleared. Continuation throughput improved sharply from a two-million to
a five-million capacity target, while eight million was slower because its
larger hash table and memory traffic outweighed one fewer clear. A recursive
decision temporarily peaked at 6,776,047 entries under the five-million target.
Four, six, and eight worker tests selected six workers as the local optimum.

The final implementation adds the shared compatibility index and streams exact
worlds through the existing action cache. Its matched six-worker, 60-root test
produced 194,572 rollouts in 53 seconds, or 3,671.17 rollouts/second including
static-shard load imbalance. Total worker time was 207.48 seconds, or 937.77
rollouts/worker-second. Against the otherwise identical pre-index run, this is
a 9.43% aggregate and 12.34% per-worker improvement. The decision action-cache
hit rate remained 74.57%, confirming that sequential traversal already reuses
matching information sets without a grouping pass.

A separately measured materialized posterior-vector cache was rejected. At a
100,000-hand capacity it hit on 19.39% of posterior requests and reduced hand
generation, but fell to 3,474.5 rollouts/second—3.57% slower than the indexed
streaming version measured in that comparison. Hashing, allocation, retained
vectors, and 513 capacity clears cost more than the saved filtering. The
production-shaped builder therefore keeps the immutable compatibility index
and decision-local action memoization, but no posterior-vector cache.

The prior 50-root full-workload sample projects 99,181,545,503 rollouts; the
new 60-root sample projects 106,345,707,762. At the final measured static
throughput those are 312.69 and 335.28 days. If a dynamic queue perfectly
balanced all six workers at the measured per-worker rate, they would still be
204.02 and 218.76 days. Indexed streaming therefore improves the complete-hand
builder, but does not make the full conditional-histogram build a week-scale
local job.

The deterministic report for the final run is
`benchmarks/model1322/streaming-indexed-throughput-20260831/report.json`.

`model1322-opponent-discard-histograms.json` stores
`P(opponent discard ranks | opponent four-card keep, role)`. Model 9.x and
Model 13.x cohorts are normalized independently within each role/keep before
blending, so a larger benchmark cohort does not silently dominate. If a keep
has no conditioned observations, the builder uses the role-level discard
fallback. Own six-card dead cards reweight both the keep prior and conditional
discard histogram; impossible combinations are removed before cut enumeration.

The calibration also has an explicit `keep-only` approximation mode. It keeps
the same empirical role-specific opponent four-card prior but supplies no
guessed private discard to the simulated opponent. Cut ranks are then weighted
by the physical multiplicity remaining after the actor's six cards and the
opponent keep. This mode deliberately leaves the simulated opponent
under-informed by its two private discards; it preserves the actor's complete
six-card/discard/cut context and exists to measure the build-cost and forecast
quality tradeoff independently of the conditional histogram.
