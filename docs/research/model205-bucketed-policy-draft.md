# Draft: strategic pegging search through legal-knowledge buckets

Status: design discussion, 2026-09-30. The user subsequently requested a build as
20.5.pegging. See [the implemented first experiment](model205-pegging.md) for its
fixed-opponent scope, belief treatment and validation. No benchmark restart,
deployment, or adoption into a released model is implied.

## Objective

Evaluate whether replacing the inner policy's averaging over future legal moves
with strategically selected moves can improve playing strength at an acceptable
cost, especially pone's first pegging decision. Seek the simplest executable
solver that respects each player's knowledge. Performance and playing strength
are separate acceptance criteria; neither improvement is established yet.

The current inner continuation evaluator averages later legal physical-card
plays. The surrounding rollout calls an observation-based policy at subsequent
decisions, and the root already weights hypothetical opponent hands. The proposed
change concerns strategic continuation valuation, not eliminating averaging over
genuine uncertainty.

## Agreed decision rule

A bucket represents states the acting player cannot distinguish from legally
available information. For each legal action, evaluate its continuation across
the bucket's possible worlds and take the posterior-weighted mean. Select the
best action and use it throughout that bucket:

```
Q(bucket, action) = sum(posterior(world | bucket) * continuation_WP(world, action))
chosen_action(bucket) = argmax_action Q(bucket, action)
```

The WP above is from the acting player's perspective. Compare actions within a
bucket; do not choose which hidden world or future observation will occur.
Future decisions must obey the same information restriction. Independently
optimizing each world's later moves would retain strategy fusion even if the
current move were shared. Likewise, averaging all play orders within each hand
would retain the present continuation-averaging approximation.

Use the smoothed hand priors as the starting point for a posterior conditioned
on known cards, card availability, public plays, go, and behavioral evidence.
Distinguish evidence from events already observed from likelihoods assigned to
hypothetical future actions. Decide explicitly whether the latter follow the
existing empirical model or the policy being simulated. Avoid applying the same
evidence twice. Average terminal WPs rather than converting mean points into WP.

## Knowledge and representation requirements

- Bucket identity covers the acting player's complete modeled legal observation:
  own remaining and played cards, own discards, cut, scores, role, ordered public
  history, current series/count, and go/last-player state. Include any additional
  legally known information used by a richer terminal evaluator. Prove any
  proposed compression sufficient before merging distinguishable observations.
- Each player receives its own posterior. A's root worlds all contain A's actual
  hand; pooling those worlds at B's turn would incorrectly make B certain of A's
  hand. Either construct B's legally conditioned alternatives or invoke an
  observation-only B policy that does so.
- C, the engine, can inspect complete hypothetical worlds for transitions,
  scoring, and safe bounds. Actions, bucket membership, and actor beliefs must
  not depend on private information unavailable to that actor. The live
  opponent's actual hidden cards cannot replace the actor's hypothetical range.
- Aggregate adequate weighted evidence before finalizing a bucket's action.
  Reusing the first encountered world's preferred action is insufficient.
  Numerical batches may be partial; they must not become different beliefs or
  different policies merely because traversal order or batch size changed.
- Preserve each world's continuation value separately when propagating results.
  Sharing an action does not mean every world has the same outcome or that an
  actor's bucket-average value can replace another actor's conditional value.
- Reuse compact states, scoring, and immutable belief assets. Follow
  [ADR 0001](../adr/0001-use-an-executable-pegging-policy.md): executable policies
  and decision-local memoization; no persistent observation-to-action table or
  exhaustive stored pegging-path graph.

## First refinement: what is a single backward pass?

It means evaluating endings, then using their values to select the final
decisions, then the preceding decisions, until reaching the opening. Each
decision is finalized once, without returning to decisions already evaluated.

For bucketed play, the posterior at a later decision can depend on an earlier
opponent strategy. For example, seeing B play a ten could suggest B also holds a
five under one strategy, but provide little evidence under another. If the
backward calculation changes B's earlier strategy after choosing A's later
response, the probabilities used for that response may need revision.

A fixed opponent policy permits a best-response calculation using its associated
reach probabilities. Joint optimization of both players is a different problem;
one pass is not a general guarantee of mutually optimal play. See the
[information-set, reach-probability, and best-response definitions in Burch et al.](https://poker.cs.ualberta.ca/publications/aaai2014-cfrd.pdf).

## Choices still to refine

1. First experiment: improve A's future choices against the existing fixed,
   legal-information B policy, or attempt a bounded method for improving both?
   The former is a proposed starting point, not an agreed restriction.
2. Beliefs: retain the existing empirical inference approximation, derive future
   action likelihoods from the simulated policy, or compare both? Specify
   treatment of actions assigned zero likelihood without silently dropping a
   decision that later becomes relevant.
3. Scope: begin with small remaining-card positions, then extend to opening
   analysis. Decide the terminal WP/counting context and any depth limit before
   interpreting strength results.
4. Joint optimization, if attempted: specify how strategies and beliefs are
   updated, whether action mixtures are needed, and what convergence or stopping
   evidence is required. Do not assume repeated greedy updates converge.
5. Version and adoption: isolate the experimental policy from frozen benchmark
   models; settle its final model identifier and acceptance criteria before
   promotion.

## Proposed evaluation after refinement

1. Establish a small, independently checkable reference. Verify forced moves,
   go, resets, final points, and scoreouts. Compare weighted action values with
   explicit enumeration. Include a fixture where independent per-world choices
   overstate the achievable value, and one where rare bad hands should not
   dominate the expected-WP choice.
2. Test legal information directly: the same actor observation must yield the
   same result when the enclosing world's hidden cards change. In particular,
   vary A's private cards while keeping B's observation unchanged. Check
   invariance to world ordering, equivalent weight splitting, and batch size.
3. Measure actual work and timing against the retained engine. Record states,
   buckets, posterior work, reuse, memory, and both CPU and wall time. Use matched
   builds/assets/PGO training, alternating runs, an A/A noise check, and account
   for Mac performance/efficiency-core scheduling. Do not infer production-server
   gains from Mac measurements.
4. Report pone and dealer first pegging decisions separately, plus directly
   measured whole-hand pegging totals for each role. Prioritize pone opening.
5. Test playing strength on held-out positions and paired games, including late
   score races and counting-sensitive decisions. Changed decisions are expected;
   bit-identical action parity is not an acceptance criterion for this redesign.
   Report uncertainty: finite tests cannot prove absence of every playing
   regression. Set a practical adoption standard with the user.

The raw opening count, assuming 45 unseen physical cards, is
`C(45, 4) * 4! * 4! = 85,821,120` card-order combinations across all A leads.
Enumerating unordered B hands does not multiply this by another 24. This is a
combinatorial baseline, not a runtime estimate or a bound on the extra work of
representing both players' uncertainty or revising strategies.

The previous [observation-grouping assessment](model203-observation-groups.md)
only attempted to save repeated preparation around the existing policy. Its
mixed speed results do not settle this proposed change to the policy itself.
