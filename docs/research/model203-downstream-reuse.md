# Model 20.3 downstream reuse assessment

Assessment against `1bacdbf134f26d7badc7c9decfd8d36dc0bf908b`. No production
engine change or benchmark restart was made. Diagnostic code and the retention
prototype exist only in `/private/tmp/cribbage-203-downstream-probe/engine`.

## What an exhaustive lead actually computes

The live adapter prepares a root posterior, forecasts root candidates across
the complete hidden-card-world support, and values their terminal scores with
known-hand and conditional opponent/crib counting distributions. Its rollouts
call `Model911Policy` with Model 20.3 assets for nonforced simulated decisions.
That inner chooser evaluates candidates using its own posterior and the compact
average-continuation kernel, ending at the after-pegging board matrix. It does
not recursively invoke the complete live Model 20.3 evaluator at every node.

Thus, exhaustive hidden-world enumeration and inner continuation arithmetic do
not mean every subsequent live decision has already received the same full
evaluation it will receive when actually played. The outer rollout follows a
chosen inner-policy action per world; observed play can depart from those paths.
Filtering only worlds that followed an observed action would also change the
soft-evidence posterior into a different opponent-behavior assumption.

## Existing reuse and board position

One policy instance is shared by all root candidates and worlds in one solve.
Its caches already reuse:

| Cache | Key/context | Capacity | Lifetime |
| --- | --- | --- | --- |
| Inner WP actions | Model91 observation, likelihood vector, both scores | 100,000 entries | One live solve |
| Action-by-hidden-hand WP evidence | Observation without own discards/cut, both scores; current weights reapplied | 300,000 outcome cells | One live solve |
| Compact continuation WP | Packed card/series/go/turn state, role, both scores | 1,000,000 entries; only admitted states | One live solve |
| Immediate series scoring | Complete series/count scoring key | 1 MiB direct-mapped memo | One live solve |
| Compatible card populations and conditioned discard priors | Current hand and asset fingerprint | Hand scoped | Survives live turns |

Simulated plays update scores before subsequent keys are formed. Score changes
do not invalidate every downstream cached result: an exact state/score match is
reusable. Reusing a value keyed only by cards, or using the opening scores at a
later node, would be wrong. A production hand-scoped solver would also have to
bind model/asset/board identity and keep each player's legal information distinct.

Currently `PreparedDecision` owns the policy and drops its decision/evidence/
continuation/scoring caches after returning the live recommendation. The existing
`HandCache` retains population/prior preparation, not those solve results.

## Same-hand retention prototype

The disposable prototype holds the existing policy in the existing per-actor
hand cache, retaining its current capacity limits. It still recomputes each
root posterior and runs the complete live forecast; it never returns an inner
action as the live answer. Identity includes the existing hand/asset binding;
scores remain in the existing value/action keys. Separate caches are used for
baseline/candidate and for each actor. Each tested hand starts fresh.

Three hands, including a close race, were played twice with reversed evaluation
order. All 64 paired actions, EVs, and WPs matched by serialized comparison.
Both players use Model 20.3 in this focused probe. Asset inputs are the frozen
speed-v4 snapshot; the long six-worker benchmark continued independently.

Aggregate measured CPU: 55.070522 s fresh versus 54.979729 s retained, a 0.165%
difference. The three per-hand aggregate reductions were 0.247%, 0.146%, and
0.084%. This is a small instrumented pilot, not convincing evidence of a
production throughput gain. New counters and diagnostic output were present in
both variants. First-decision differences below are noise: both variants start
that actor's hand with an empty policy cache.

Mean CPU seconds over two repetitions:

| Hand | Role | First, fresh | First, retained | Whole hand, fresh | Whole hand, retained |
| --- | --- | ---: | ---: | ---: | ---: |
| Recorded hand 10/h2 | pone | 9.768701 | 9.749165 | 9.999431 | 9.975614 |
| Recorded hand 10/h2 | dealer | 1.247912 | 1.246540 | 1.283625 | 1.279600 |
| Recorded hand 1016/h4 | pone | 5.068097 | 5.059364 | 5.157235 | 5.144229 |
| Recorded hand 1016/h4 | dealer | 1.211659 | 1.215243 | 1.225180 | 1.228875 |
| Close race | pone | 8.576119 | 8.568976 | 8.772096 | 8.759357 |
| Close race | dealer | 1.071499 | 1.075500 | 1.097696 | 1.102191 |

Later pone calculations saved approximately 4.3, 4.3, and 5.6 ms per hand in
these examples. Dealer later-turn results were mixed. Retention keeps substantial
caches alive while waiting for a player; production memory/concurrency behavior
was not validated. This experiment does not justify adopting blanket retention.

## Cached inner actions are not interchangeable with live decisions

A separate comparison evaluated 10 historical later-turn regression positions
and 20 constructed board-score/role variants. Inner and full-live actions differed
in four positions. The historical fixture IDs describe source positions; all
evaluations here used Model 20.3.

| Position | Inner action | Full live action | Full-model WP of inner action | Full-model WP of live action |
| --- | --- | --- | ---: | ---: |
| Historical dealer position, scores 2–8 | Jack | Ten | 0.363515 | 0.371441 |
| Pone, scores 110–109 | Five | Ten | 0.999914 | 1.000000 |
| Pone, scores 116–118 | Five | Ten | 0.378434 | 0.669381 |
| Dealer, scores 105–110 | Five | Ten | 0.571044 | 0.623717 |

The last three use count 14, remaining cards five/ten, own previously played
ace/four, opponent previously played three/six, cut jack, and own discards two/
seven. Exact inputs and selected-action reviews are retained in the artifacts.
These are estimated WPs under the full model, not measured real-world win rates.
They demonstrate that promoting an inner-policy cached move to the live answer
is a policy change with a material regression risk.

The whole-hand retention probe found eight cached live-root inner actions across
its six executions; those eight happened to agree. Many later actual roots were
absent from the retained action map. Agreement on those cached examples cannot
establish interchangeability, as the independent counterexamples demonstrate.

## Reuse inside the lead remains a credible target

The first ordinary pone opening recorded:

- 1,927,201 inner decision requests; 749,653 action-cache hits (38.9%).
- 11 full clears of the 100,000-entry action cache.
- 1,177,548 evidence requests; 1,159,838 evidence hits (98.5%).
- 33 evidence-cache clears; the cache still avoided most evidence reconstruction.
- 35,510,963 compact continuation hits, 225,636 retained entries, and no
  continuation-capacity clears. The hit count is not a hit rate over eligible
  states: most recursive states are deliberately excluded from admission.

These are one opening's measurements, not a benchmark-wide profile. They identify
action-cache churn as a more credible next experiment than retaining everything
after the opening. Protecting frequently reused current-player entries from the
stream of opponent-private-card variants, or grouping equivalent observations
before invoking the policy, may help the opening itself. Neither idea was
implemented or timed in this assessment.

A further alternative is on-demand memoization of exact rollout suffix results
within a solve, where convergence can first be demonstrated. It would need the
complete relevant state/history and unchanged aggregation order. Do not build an
exhaustive observation-to-action graph or treat partial root histograms as solved
future decisions. Full next-turn precomputation would perform additional live
evaluations; it would not merely save outputs already calculated by the lead.

## Artifacts

`/private/tmp/cribbage-203-downstream-probe` contains the isolated instrumented
engine, Rust driver, `run.py`, `results.json`, `diagnostics.jsonl`, `summary.json`,
`compare-policies.py`, `inner-comparisons.json`, `review-mismatches.py`, and
`reviewed-mismatches.json`. No diagnostic code was added to the production branch.
