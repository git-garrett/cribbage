# Model Improvement Roadmap

> Canonical active plan for engine-playing quality work. This replaces the
> overlapping Model 16.0, Model 16.1, six-card discard, and pegging-state
> plans. Historical detail, measurements, and completed implementation logs
> are preserved under [`docs/archive/model-improvement/`](archive/model-improvement/).

## Objective and Non-Negotiables

Build a successor that is demonstrably stronger than the production Model 13.0
and the historical Model 15.x engines without adding human-visible decision
latency. The successor remains experimental until it passes the evaluation
gate in this plan.

- Production stays on Model 13.0 until a candidate passes every promotion
  gate.
- A decision may use only the acting player's private cards and public game
  history. It must never use the opponent's unrevealed hand or crib cards.
- Preserve the actual scoring order: pegging events, pone hand, dealer hand,
  then crib; stop immediately when a player reaches 121.
- Prefer offline construction and compact runtime assets over online rollout.
  A full joint six-card reconstruction or exhaustive tree search must never
  be put on the human decision path.
- A compact representation may approximate only when its error and fallback
  behavior are measured. It must not silently turn an unknown state into a
  favorable hidden-information state.
- Each numbered implementation step follows: implement, QA, commit/push,
  document and mark complete, then begin the next step.

## Current Evidence and Status

- [x] Fixed current-hand scoring order in experimental Model 16.0.
- [x] Removed hidden-crib/clairvoyant information from the relevant engine
  paths. Earlier 13.0-versus-15.2 results from before this correction are not
  legal-information strength evidence.
- [x] Eliminated pegging strategy fusion in experimental Model 16.0 by using
  a legal-information MCCFR policy and a deterministic rank-level simulator.
- [x] Added a deterministic point-EV tie-break after win probability.
- [x] Built the versioned `C16TRN01` ordered-event reference format and an
  actor-only adapter. The completed 37-context reference matrix is an oracle,
  not a deployable Model 16.1 asset.
- [x] Measured the first 16.0 candidate as unacceptable for promotion: it won
  434/1,000 side-swapped games against 13.0 and 413/1,000 against 15.2, with
  learned-policy hits on only 29,150/50,207 contested decisions (58.06%).
  It was fast, not strong enough.
- [~] The realistic-corpus 2B Model 16.0 training continuation is running in
  detached screen `cribbage-model16-2b`. It retains the original seed,
  corpus, one worker, frozen support, 10M-iteration checkpoints, and no wall
  or projection stop limit. Authoritative status:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-2b/status.json`.
- [ ] No Model 16.x asset is promotable yet. The untracked
  `rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin` remains a
  rejected experimental artifact, not a release asset.

## Required End State

The promoted candidate must combine all of the following:

1. Joint six-card discard reconstruction that retains the correlation among
   keep, opponent discard/keep, cut, crib, hand scores, and pegging.
2. A legal-information pegging policy that covers common states, has a learned
   generalizing backoff for policy misses, and preserves its learned average
   strategy rather than forcing deterministic argmax play.
3. An ordered-scoring transition asset that replaces the score-independent,
   perfect-information pairwise pegging assumption in discard evaluation.
4. Ordered empirical board distributions and calibrated endgame evaluation.
5. Opponent-belief features derived only from public plays, goes, scores, role,
   known cards, and legal own information.

## Dependencies and Execution Order

| Phase | Depends on | Cannot be skipped because |
|---|---|---|
| 1. Finish and dissect current training | existing 2B runner | It tells us whether the admitted 16.0 policy states are worth retaining. |
| 2. Joint six-card discard foundation | Phase 1 evidence; discard memoization | All downstream discard and policy evaluations need realistic correlated deals. |
| 3. Legal policy coverage and deployment | Phases 1–2 | A fast but frequently missing policy cannot be a strength engine. |
| 4. Model 16.1 ordered transition asset | Phase 3 final average policy; Phase 2 deal model | The asset must represent the actual policy and scoring chronology. |
| 5. Ordered board distributions | Phase 4 event schema | Board evaluation needs the ordered outcomes the transition asset supplies. |
| 6. Opponent-belief refinement | Phases 2–5 baselines | It needs a correct baseline to attribute its benefit. |
| 7. Promotion evaluation | Phases 2–6 | Strength, coverage, calibration, and latency must be tested together. |

Only one numbered implementation phase is active at a time. The background
training run may continue while documentation and read-only analysis proceed;
it does not authorize starting another implementation phase early.

## 1. Finish and Dissect the Current Model 16.0 Run

- [x] Make the runner resumable, checkpointed, and ETA-visible on
  `/Volumes/Elements`.
- [x] Remove the artificial 60-hour and projection ceilings so the existing
  2B target, not an arbitrary wall clock, determines normal completion.
- [ ] Let the active run reach 2,000,000,000 iterations or stop only for a
  verified operational failure.
- [ ] Pack policy candidates at multiple evidence thresholds without changing
  the frozen checkpoint.
- [ ] Run held-out, paired, side-swapped ablations for fallback-only,
  deterministic argmax, and reproducibly sampled average-policy modes.
- [ ] Report on-book rate, fallback rate, confidence/weight distribution,
  strength, calibration, and p50/p95/p99 latency separately.
- [ ] Decide whether any Model 16.0 policy becomes a useful input baseline for
  later phases. It is not eligible for production merely because training
  completes.

QA and gate:

- Checkpoint/resume checksum, corpus identity, and frozen-support identity
  must match the manifest.
- A held-out candidate must beat its fallback-only control before it is used as
  the base policy for Model 16.1.
- Sampled average policy must be non-inferior to argmax at unchanged latency.

## 2. Restore Joint Six-Card Discard Reconstruction

This is the missing high-impact upstream correction. Existing historical
prototypes showed that a fully joined all-outcomes table is multi-gigabyte and
far too slow for runtime. Do not revive that architecture.

- [x] Preserve the historical result: compact opponent discard policy tables
  and componentized reconstruction are feasible; full joined artifact builds
  and live reconstruction are not production designs.
- [ ] Profile current Rust discard evaluation and add bounded, hand-scoped
  memoization for candidate outcomes, opponent-policy lookups, and reusable
  score components. Record memory, hit rate, and latency by candidate count.
- [ ] Define a compact offline component schema keyed by six-card rank hand,
  role, discard candidate, compatible opponent policy distribution, cut rank,
  and necessary suit-shape cases.
- [ ] Reconstruct joint distributions offline so own keep, opponent keep,
  both discards, crib, hand scores, pegging, and cut remain correlated.
- [ ] Retain compact suit-shape information for keep/discard/crib flushes and
  nobs; do not discard suit effects merely to keep a rank-only key small.
- [ ] Add a compact runtime reader that scores local discard candidates from
  the precomputed joint components, never via live full reconstruction.
- [ ] Validate against exhaustive small fixtures, current Model 13 behavior,
  and opponent-perspective discard choices.

QA and gate:

- The same source deal must never be represented as independent hand, crib,
  and pegging marginals when their correlation affects a candidate choice.
- Runtime p99 stays within the existing human-latency budget.
- Memoization improves repeated work without changing a deterministic result.

## 3. Complete Legal-Information Policy Coverage

- [x] Legal-information identity, perfect-recall public history, ordered
  pegging simulator, policy artifact format, telemetry, and realistic-corpus
  training are implemented for Model 16.0.
- [x] Defined the lossless Model 16.1 key and separate `C161POL1` artifact,
  including exact scores, own retained/discard ranks, cut rank, role, count,
  and ordered public history.
- [ ] Build the compact learned action scorer for exact-policy misses. It must
  use only legal features and predict action advantages, not hidden cards.
- [ ] Add explicitly measured public-history opponent-belief features to that
  scorer: role, public plays, go declarations, known-card depletion, score,
  and relevant cut/own-discard context.
- [ ] Train the final four-card Model 16.1 policy using exhaustive CFR where
  tractable and an explicit exact chance partition plus long MCCFR only where
  exhaustive traversal is not tractable. Checkpoints and frozen average-policy
  artifacts live on `/Volumes/Elements`.
- [ ] Preserve the learned average strategy with stable per-game sampling;
  retain deterministic argmax only as an evaluation control.
- [ ] Measure coverage and backoff quality on a held-out legal-information
  corpus, including positions reached after unusual public play sequences.

QA and gate:

- Hidden-world substitutions at one information set must never change legal
  actions or policy probabilities.
- The learned scorer must beat the tactical fallback on held-out policy misses
  and stay inside the runtime latency budget.
- Report convergence/proxy metrics honestly; sampled-CFR regret proxies are
  not a full-game exploitability proof.

## 4. Build the Deployable Model 16.1 Ordered Transition Asset

- [x] Implemented `C16TRN01`, resumable compiler controls, the actor-only
  engine adapter, and reference builds. These are explicitly non-deployable
  reference matrices.
- [ ] Enumerate every compatible retained-rank pair and reachable public
  pegging history under the frozen final Model 16.1 average policy.
- [ ] Traverse both actors' mixed policies exactly; do not select an argmax
  action and do not condition on invisible opponent cards.
- [ ] Record every ordered pegging scoring event and terminal outcome required
  for proper count-outs before hands and crib.
- [ ] Losslessly intern equivalent score regions and public subtrees into a
  versioned compact transition DAG with checksums and resumable status.
- [ ] Integrate a Rust runtime reader into Model 16.1 discard evaluation only.
  Models 13.0–16.0 remain unchanged comparison baselines.
- [ ] Test corruption, missing-asset failure, count-out ordering, exact
  compiler resume, and no runtime rollout.

QA and gate:

- Small exhaustive fixtures must match a direct legal-information simulator.
- The artifact contains no score-independent perfect-information pairwise
  behavior.
- Runtime discard p50/p95/p99 is no slower than the accepted human budget.

## 5. Replace Board Normals with Ordered Empirical Distributions

- [ ] Inventory all normal/aggregate board approximations still used by the
  candidate, including simultaneous pegging terminal handling.
- [ ] Define compact empirical distributions over ordered score events for
  relevant 13+ score regions, role, phase, and policy context.
- [ ] Generate deterministic, versioned offline samples from the corrected
  joint discard and pegging policy pipeline; retain calibration counts and
  confidence metadata.
- [ ] Replace normal approximations with compact joint-cycle lookups where
  they improve calibration without increasing online latency.
- [ ] Validate probability calibration, late-game decisions, terminal order,
  and fallback behavior against exact small cases.

QA and gate:

- Calibration improves on an independent held-out corpus.
- Ordered events, not aggregate simultaneous totals, decide terminal games.

## 6. Opponent-Belief Refinement

- [ ] Establish a baseline using Phase 3 public-history policy features before
  adding a separate belief model.
- [ ] Build a compact posterior or action-conditioned hold distribution from
  publicly observable play, go/pass events, role, board score, and known-card
  constraints.
- [ ] Integrate it only where ablations show a decision-quality improvement;
  leave a stable legal fallback when evidence is insufficient.
- [ ] Measure benefit by game phase and information richness, not only overall
  average win rate.

QA and gate:

- Posterior must normalize, respect known-card depletion, and assign zero
  probability to impossible ranks.
- No private opponent data may appear in keys, training rows, or telemetry.

## 7. Evaluation and Promotion

- [ ] Freeze candidate checksum, build flags, training corpus, evaluation
  corpus, seed manifest, and asset provenance before benchmarking.
- [ ] Run fresh legal-information paired, side-swapped matches against Model
  13.0, Model 15.2, and the preceding Model 16 baseline. Earlier pre-fix
  benchmarks remain historical only.
- [ ] Report win rate with uncertainty, score differential, on-book/fallback
  split, decision calibration, and latency distributions.
- [ ] Reproduce gains on a second held-out seed set before deployment.
- [ ] Deploy only if the candidate is clearly non-inferior to Model 13.0,
  improves the prior Model 16 baseline, does not regress latency, and has no
  unresolved information-boundary or ordered-scoring defect.
- [ ] Otherwise retain Model 13.0 in production and record the negative result
  before selecting the next correction.

## Durable Locations

- Active Model 16.0 training and its status:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-2b/`.
- Model 16.1 ordered-event reference builds:
  `/Volumes/Elements/cribbage/model16.1-pairwise/2026-07-19/`.
- The completed 37-context `C16TRN01` reference matrix:
  `c16trn01-policy1b-pressure-matrix/`; 242,303,750 records,
  6,299,897,602 bytes, checksum `595a1d487a7a40dc`.
- The completed calibration reference:
  `c16trn01-policy1b-calibration/`; 6,530,759 records, checksum
  `92d0ce68944808b3`.
- Generated assets, checkpoints, corpus copies, database benchmarks, and logs
  remain outside Git on `/Volumes/Elements`. Source, schemas, tests, and this
  roadmap are versioned in Git.

## Archive Policy

The documents in `docs/archive/model-improvement/` are historical evidence,
not active execution instructions. They remain available for implementation
provenance, previous measurements, and rejected designs. Changes to future
model quality work must update this roadmap rather than revive an archived
checklist.
