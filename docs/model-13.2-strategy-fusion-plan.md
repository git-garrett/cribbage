# Model 13.2 Strategy-Fusion Plan

## Goal

Model 13.2 will replace fused pegging continuations with one high-quality executable policy used from each actor's legal perspective. It will use no persistent observation-to-action table and no exhaustive pegging-path asset. Models 13.0 and 13.1 remain frozen baselines.

## Design

### Executable policy

Implement one deterministic `choose_action(observation)` algorithm. Its observation contains the actor's remaining keep, own crib discards, cut, exact scores, role, and ordered public plays/go/reset history. It never contains the opponent's unrevealed keep or crib discards.

For each legal play, the policy enumerates compatible opponent worlds from the existing belief model, evaluates the weighted continuation, and selects the best action with a fixed tie-break. At every later decision, worlds with the same acting-player observation are grouped and receive one action. A public play filters and reweights compatible worlds before the next decision.

The solver may memoize results during one decision. The memo is discarded afterward and is not a policy asset.

### Live pegging

For each legal root card:

1. Force that card in every compatible world.
2. On an opponent turn, give the policy that world's opponent hand and opponent-owned discards, plus public information; never give it our hidden cards or discards.
3. On our later turn, group worlds by our legal observation and select one action for each group, independent of the hidden opponent hand.
4. Evaluate the resulting paired pegging-score distribution with Model 13's existing board objective.

This retains Model 13's belief enumeration and board evaluation while correcting only continuation action selection.

### Discard pegging forecast

Build one reusable terminal pegging outcome for each compatible ordered dealer-keep/pone-keep pair. Both sides are represented only by four-card rank keeps. The frozen role-specific empirical keep prior marginalizes each player's original six-card deal and discard choice; it combines separately normalized Model 9.x, Model 13.x, and production-human observations.

The reusable offline rollout omits both players' crib discards and the unknown cut. This is deliberately under-informed but information-set legal. At discard-selection time, runtime starts from the retained four-card keep and removes the candidate's two crib discards from physical opponent-hand availability before aggregating the stored pair outcomes under the empirical prior. Thus the two discarded cards affect probabilities without multiplying the durable asset by every six-card/discard context.

Live pegging remains separate and stronger: the acting policy receives its actual private crib discards and the public cut, and public opponent plays continue to filter its belief worlds. The initial 13.2 asset uses a score-neutral pegging-point objective; live pegging remains score-aware.

## Feasibility assessment

### Asset size: low risk

A dense matrix for 1,820 by 1,820 ordered keep pairs requires about 6.6 MB at two bytes per terminal score pair, plus roughly 30 KB for the two role priors. Monte Carlo may initially use the same simple dense layout with missing-pair sentinels; packing can follow after measurement. Do not add cut, exact-score, observation, or path dimensions.

There is no asset-size cap. Build the correct straightforward representation, record its size, and optimize packing afterward if warranted.

### Gameplay speed: medium risk

The current Model 13.0 benchmark averaged 31.971 ms per pegging decision. Legal information-set grouping adds belief work but the subgame contains at most eight cards. Shared root-world enumeration and decision-local memoization should keep it practical, but this must be measured before integration.

Gate: on a frozen corpus of contested positions, target p95 at or below 100 ms and p99 at or below 250 ms; stop and simplify if p99 exceeds 500 ms or any ordinary decision exceeds one second. Optimization may aggregate equivalent rank worlds or improve local memoization, but may not introduce a persistent policy table.

### Build time: high risk if exhaustive; bounded risk with sampling

There are 1,820 four-card rank keeps and about 3.3 million compatible ordered dealer/pone pairs. Each pair rollout is reusable for every six-card deal that produces that keep. The production build evaluates every compatible pair needed by either role prior.

Run ten deterministic contiguous dealer-keep shards concurrently on the local 12-core M3 Pro, leaving two cores for the operating system. Each shard is independently resumable; a checked merger requires exact, gap-free coverage and identical priors before publishing one asset. There is no build-time cap.

## Execution

1. Define the legal observation and write hidden-world invariance tests. Completion: replacing only an actor-invisible opponent holding cannot change that actor's action.
2. Extract the current Model 13 continuation evaluator behind the executable policy interface, then change decisions to aggregate compatible worlds at each actor information set. Completion: small exhaustive fixtures show one action per identical observation and correct go/reset/scoring behavior.
3. Prototype live Model 13.2 on a frozen decision corpus, then run a paired live-pegging-only ablation with both sides using the same Model 13.0 discard logic. Completion: the latency gate passes, every future action is traceable to an actor-legal observation, and the policy is not clearly inferior to Model 13.0 live pegging.
4. Build a frozen, provenance-labelled opponent-keep prior from role-specific game observations, normalizing each source cohort before blending. Completion: every weight represents a four-card keep, known dead cards correctly adjust physical availability, and production-human data is reduced to anonymous aggregate counts.
5. Build the reusable keep-pair outcome asset with resumable deterministic shards and checksums. Completion: all required compatible pairs validate, runtime dead-card reweighting covers both discarded cards, and no policy call received hidden opponent information.
6. Integrate the new pair asset and live solver only under Model 13.2. Completion: Models 13.0 and 13.1 remain byte-for-byte behavior baselines and missing/corrupt 13.2 assets fail closed.
7. Run paired, side-swapped held-out games against 13.0 and 13.1. Completion: report strength, score differential, discard changes, latency, build cost, asset size, and invariance-test results; promote only with a clear quality gain and all feasibility gates passing.

## Scheduled build sequence

The deterministic one-shot queue runs these after the 9.1-versus-Myrmidon
benchmark and its reports:

1. Build and verify the frozen four-card keep prior, legal-observation policy
   adapter, and both builder modes.
2. Build the keep-pair matrix exhaustively in ten deterministic, independently
   resumable dealer-keep shards.
3. Merge only after the shards provide exact, gap-free coverage with identical
   priors, then publish the exhaustive asset and manifest.

“Exhaustive” applies only to the finite keep-pair forecast. It
does not create an observation-to-action table or a pegging-path graph. The
shard builders execute the same policy through the acting player's legal
observation and store only terminal paired scores. Runtime creates the local histogram by
reweighting opponent keeps after removing the actor's four-card keep and two
candidate crib discards.
