# Rust 16.0 Information-Set Pegging Policy Plan

## Goal

Eliminate pegging strategy fusion in model 16.0 without increasing
human-visible decision latency. Train an information-set-correct pegging
policy offline, then use compact runtime policy lookups instead of allowing
future model actions to depend on the hidden opponent hand.

Production remains on 13.0. Model 15.2 remains unchanged for historical
comparison.

## Compute Budget

The completed 13.0-versus-15.2 10k run is the reference workload:

- 10,000 games at 0.184590 games/second with eight workers;
- about 15.05 wall-hours;
- 498,881 timed pegging decisions totaling 63,223 CPU-seconds;
- 180,592 timed discards totaling 147,428 CPU-seconds;
- about 58.5 aggregate decision CPU-hours.

An exhaustive full-tree CFR build is rejected because repeated complete passes
over all deals and information sets would likely exceed 10 times this budget.
The implementation will use external-sampling Monte Carlo CFR (MCCFR): each
iteration samples a hidden deal and opponent/chance actions while traversing
all actions only for the updating player.

Budget gates:

- prototype target: no more than 3 reference-10k wall equivalents;
- hard training cap: 5 reference-10k wall equivalents (about 75 wall-hours on
  the current eight-worker machine);
- mandatory stop/replan if measured completion projects to 10 equivalents
  (about 150 wall-hours) or more;
- runtime p50/p95/p99 must not exceed the existing 15.2 pegging baselines.

Recorded 15.2 runtime baselines:

| Legal cards | p50 | p95 | p99 |
|---|---:|---:|---:|
| 2 | 6.7 ms | 20.3 ms | 25.3 ms |
| 3 | 28.7 ms | 51.8 ms | 59.4 ms |
| 4 | 284.0 ms | 1327.0 ms | 1513.6 ms |

## Commit Protocol

For every numbered step:

1. implement the step without marking it complete;
2. run the listed QA;
3. commit and push the implementation;
4. document results and mark the step complete;
5. commit and push the completion record before starting the next step.

The user-provided `pasted-text.txt` is reference material and must remain
untracked.

## Steps

### 0. Freeze Architecture and Cost Guardrails

- [x] Record the reference compute and latency measurements.
- [x] Select external-sampling MCCFR rather than exhaustive CFR.
- [x] Define stop conditions and the per-step commit protocol.

QA:

- verify measurements directly against the retained benchmark database;
- Markdown/diff validation;
- confirm the worktree contains no accidentally staged benchmark or pasted
  reference data.

### 1. Legal Information-Set Identity and Pegging Simulator

- [x] Define a packed information-set key containing only legally observable
  public state plus the acting player's private cards and own crib discards.
- [x] Preserve ordered pegging play/reset/go history needed for perfect recall.
- [x] Add a deterministic rank-level pegging simulator shared by training and
  runtime policy validation.
- [x] Prove by tests that two hidden opponent hands with the same information
  set produce the same key and available policy actions.

QA:

- Rust unit/property fixtures for scoring, go/reset, terminal wins, key
  invariance, and deterministic replay;
- full Rust workspace tests and formatting.

### 2. External-Sampling MCCFR Trainer

- [x] Implement alternating-player external-sampling regret updates.
- [x] Keep the acting player's actions unified at each information set.
- [x] Sample legal hidden deals and cut cards without exposing them in keys.
- [x] Use ordered terminal scoring and board-aware utility near 121.
- [x] Add deterministic seed, worker count, checkpoint, resume, status, ETA,
  and explicit wall-budget arguments.
- [x] Run 10k/100k-iteration probes and project the capped build cost.

QA:

- deterministic single-worker checksum;
- checkpoint/resume parity;
- regret/strategy normalization and zero-illegal-action tests;
- measured projection remains below the 10-equivalent stop threshold.

### 3. Compact Policy Artifact

- [x] Convert cumulative strategy into an average-policy artifact.
- [x] Pack keys and rank-action probabilities with deterministic ordering.
- [x] Include schema, training provenance, checksum, coverage, and backoff
  metadata.
- [x] Add a loader and byte-for-byte deterministic pack test.

QA:

- unpacked policy equals trainer output within documented quantization error;
- corrupt/truncated artifact rejection;
- server package asset check.

### 4. Model 16.0 Runtime Integration

- [x] Route 16.0 pegging through the information-set policy.
- [x] Never fall back to the per-hidden-hand optimal solver.
- [x] Use a cheap legal-information heuristic when a key is missing.
- [x] Keep 15.2 and earlier behavior unchanged.
- [x] Retain policy state/cache across turns where it reduces work without
  changing decisions.

QA:

- strategy-fusion regression: hidden-world substitutions cannot change the
  selected future action at a shared information set;
- policy legality and deterministic-choice tests;
- full Rust/frontend/release build QA.

### 5. Bounded Training and Release Evaluation

- [x] Train only within the approved five-equivalent hard cap.
- [x] Report actual iterations/second, wall time, CPU time, artifact size,
  coverage, and exploitability/regret proxies.
- [x] Compare runtime p50/p95/p99 against the frozen 15.2 baseline.
- [x] Run paired-deal, side-swapped validation against 15.2 and 13.0 with
  held-out seeds.
- [x] Keep the policy in 16.0 only if wall-clock latency does not regress and
  play evidence is non-inferior or promising.

QA:

- frozen-seed smoke and paired validation;
- analyzer timing/calibration checks;
- clean worktree and pushed completion record.

### 6. Decision-Source Telemetry and Paired Ablations

- [x] Persist whether each contested Model 16 decision used a learned policy
  entry or the legal-information fallback.
- [x] Persist the selected entry confidence and selected policy weight without
  exposing hidden cards or changing live decisions.
- [x] Add runner-only controls for learned-policy, fallback-only, deterministic
  argmax, and reproducibly sampled average-policy evaluation.
- [ ] Run paired, side-swapped ablations on held-out deals to isolate policy,
  fallback, and deployment-selection effects.

QA:

- database migration and round-trip tests for the new compact fields;
- hidden-hand invariance and deterministic seeded-replay tests;
- unchanged behavior when diagnostics and runner overrides are absent;
- full Rust formatting, tests, Clippy, and release build.

### 7. Correct Average-Policy Deployment

- [ ] Preserve MCCFR's learned mixed strategy with per-game reproducible
  sampling rather than collapsing every information set to its argmax action.
- [ ] Keep production on 13.0 while Model 16 remains experimental.
- [ ] Require sampled-policy evidence to beat deterministic argmax before
  retaining the change.

QA:

- probability-boundary, legality, repeatability, and different-seed tests;
- paired, side-swapped validation against 13.0 and the deterministic 16.0
  baseline;
- runtime p50/p95/p99 remains below the frozen 15.2 baseline.

### 8. Realistic Training Distribution and Generalizing Backoff

- [x] Replace independent uniform board scores with a deterministic corpus of
  board states reached by actual non-clairvoyant engine games.
- [x] Replace the trainer's simplified discard heuristic distribution with
  retained hands generated by the production Rust discard path or a frozen
  corpus produced by that path.
- [ ] Train and validate a compact legal-information action scorer for policy
  misses so unseen keys generalize from learned action advantages.
- [ ] Add legally known cut, own-discard, and richer board-position features to
  the scorer without exploding the exact lookup key.
- [ ] Keep the tactical heuristic as a final safety backstop only.

QA:

- training-corpus checksum and train/validation split are deterministic;
- no hidden opponent cards enter runtime or training features;
- scorer inference remains inside the latency gate;
- held-out policy-miss decisions improve against the tactical fallback.

### 9. Weekend Training and Promotion Gate

- [x] Launch the best validated trainer/configuration in a detached,
  resumable local session with status, ETA, checkpointing, and a hard stop
  inside the existing five-reference-equivalent budget.
- [x] Store checkpoints, status, logs, and artifacts below a documented
  `/Volumes/Elements/cribbage/model16-policy/` run directory.
- [ ] On completion, pack candidates by evidence threshold and run paired,
  side-swapped held-out validation.
- [ ] Promote an artifact only if it is non-inferior or promising against
  13.0, improves on the current 16.0 baseline, and meets latency limits.

QA:

- detached runner survives terminal exit and exposes a current ETA;
- checkpoint resume is verified before the long run;
- production remains 13.0 unless the promotion gate passes;
- clean worktree and pushed completion record.

Completed first-generation local run:

- durable root: `/Volumes/Elements/cribbage/model16-policy/2026-07-17`;
- 100k calibration checkpoint/status: `model16-100k.cfr` and
  `model16-100k.status.json` (checksum `131c5ab696f06fdf`);
- calibration artifacts: `model16-100k-min2.bin` (22,797,232 bytes,
  518,869 entries) and `model16-100k-min5.bin` (5,613,293 bytes, 126,678
  entries);
- completed deterministic final checkpoint/status: `model16-250k.cfr` (289
  MB) and `model16-250k.status.json`, seed `0x16c0ffee`, one worker, checkpoint
  checksum `3e3b4554816e72e1`;
- selected release candidate: `model16-250k-min5.bin`, 451,192 entries,
  19,886,119 bytes, artifact checksum `1cd4954985859055`, SHA-256
  `2205e83f4fd75ce92960f5087f92e4dee5c92cb0d326fb44edb7659c4cef516c`;
- rejected repository release asset retained temporarily for correction
  ablations:
  `rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin` (an exact
  copy of the selected candidate, currently untracked);
- paired held-out evaluation root:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/release-eval`;
- resumable evaluator: `scripts/run-model16-release-eval.sh`; each matchup
  writes `status.json`, `games.db`, and append-only `sessions.jsonl` below the
  evaluation root. Matchups are 16-vs-13, 13-vs-16, 16-vs-15.2, and
  15.2-vs-16 with the same seeds used for each side swap.
- completed evaluator: detached screen session `cribbage-model16-eval` ran
  with four workers, 500 games per side ordering/2,000 total, and exited
  normally. Supervisor output is `release-eval/runner.log`; each leg's final
  status remains in its `status.json`. No launchd job was created.

The final trainer completed 250,000 iterations in 117.7 seconds at 2,134
iterations/second, retaining 3,213,626 trained plus 7,139,584 singleton states.
It used 3.27 GB maximum RSS/4.66 GB peak footprint with no swap. Relative to
the 100k calibration, positive-regret-per-update fell from 0.004257215 to
0.003423015 and max-positive-regret-per-update fell from 0.003585713 to
0.002903875. The minimum-five candidate covered 237/404 (58.7%) contested
choices in an eight-game held-out smoke. Minimum three covered 252/419 (60.1%)
but doubled the artifact to 40,657,581 bytes, so minimum five was selected.

Active correction work:

- Step 6 implementation commits: `a0114e0` adds row-level learned/fallback,
  confidence, and selected-weight telemetry plus reproducible argmax, sampled,
  and fallback runner modes; `bad6e86` adds the resumable paired ablation
  runner.
- active Step 6 ablations: detached screen `cribbage-model16-ablations`
  (screen id `63512`), writing sample and fallback-only 16.0-versus-13.0
  side-swapped legs of 500 games each below
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/correction-ablations`.
- realistic training source: 90,296 actual hands from the retained
  `rust-13.0-vs-15.2-10k-20260716.sqlite` benchmark, stored at
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-corpus/model16-13-vs-15_2-10k-hands.tsv`;
  5,757,294 bytes, SHA-256
  `385c287497049d7791d2350d988894b2102a0d3d21bd48ac723418e2289ce961`,
  trainer FNV checksum `6e929b7c33560abd`.
- realistic-corpus trainer implementation commit: `66adc51`. Corpus identity
  is recorded beside checkpoints and enforced during resume. A 10k-to-20k
  resume QA passed with checkpoint checksum `9abd815cb8d26863`.
- calibration: one-worker 100k completed at 15,409 iterations/second with
  1,449,872 trained plus 2,919,613 pending sets; 250k completed at 15,067
  iterations/second with 3,563,640 trained plus 4,313,311 pending sets. The
  realistic corpus reduced total state growth from the synthetic run's
  10,353,210 to 7,876,951 at 250k while increasing revisited/trained states.
- fixed-support implementation commit: `9e3eb7c`. The trainer can now freeze
  new information-set admission at an exact configured capacity while
  continuing to refine admitted frequent states; QA froze at exactly 100
  states and completed all 1,000 requested iterations.
- weekend supervisor implementation began at `691d4ca`. The original
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-2b` launch
  was stopped before its first 10M checkpoint after live measurement exposed
  that singleton-to-node promotion continued after the nominal support freeze
  and masked the projection gate. It is retained only as run-history/status;
  it is not an active or promotable checkpoint.
- fixed-support correction commits: `e81322c` prevents promotion after freeze
  and makes the wall/projection guards independent; `6764c09` removes
  singleton fingerprints that can no longer become trainable nodes;
  `f6ed8b6` excludes checkpoint reconstruction/checksum time from training
  ETA; `7f004e3` explicitly preserves frozen support across resume;
  `10d9db8` adds read-only resume probes; `8905d69` sizes the default run from
  measured steady throughput; and `27ca0ec` requires a 100k post-resume sample
  before enforcing the projected-work ceiling. Release-mode QA held compacted
  support constant, exercised stop/resume, passed 26 focused unit tests plus
  doc tests, strict trainer Clippy, and the release build. Only the pre-existing
  shadow-engine dead-code warning remains.
- steady-state sizing probe: 100,000 resumed iterations completed in 20.045
  seconds at 4,989 iterations/second with 3,678,229 trained nodes, zero pending
  fingerprints, and no checkpoint mutation. The selected target is therefore
  1,000,000,000 iterations: approximately 55.7 hours/3.69 reference workloads
  at the probe rate, below both the 60-hour wall budget and five-reference
  ceiling.
- active corrected run: detached screen `cribbage-model16-weekend-fixed`
  (screen id `86746`), one worker, target 1,000,000,000, 10M-iteration
  checkpoints, 60-hour wall budget, seed `0x16c0ffee`, and immutable support
  of 3,678,229 trained nodes. Durable root:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-1_75b-fixed-support`.
  The directory name and reused checkpoint filename retain the superseded
  1.75B launch label so the saved 310k checkpoint did not need to be copied;
  `status.json` is authoritative for the current 1B target. Checkpoint:
  `model16-realistic-1750000000.cfr`; live trainer status: `status.json`;
  supervisor status: `supervisor-status.json`; append-only console log:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/realistic-1_75b-fixed-support.log`.
  At 450,000 completed iterations it was healthy at 5,113 iterations/second,
  with a 54.3-hour ETA/3.61 projected reference workloads. Production remains
  on 13.0.

## Completion Log

- 2026-07-17, Step 0: Queried the retained 10k database directly and froze
  the 15.05-hour reference workload, aggregate decision CPU time, and pegging
  latency percentiles above. Selected external-sampling MCCFR, capped the
  prototype at five reference equivalents, and established a mandatory
  replan threshold below ten equivalents. QA confirmed that only this plan
  was staged; `pasted-text.txt` remains untracked. Implementation commit:
  `1814b24`.
- 2026-07-17, Step 1: Added a packed legal information-set key, current-hand
  public play/go/reset history, and a deterministic rank-level pegging
  simulator. Tests cover hidden-hand key/action invariance, ordered-history
  identity, deterministic replay, 31/reset scoring, go/last-card scoring, and
  immediate terminal wins. `cargo fmt --all -- --check` and the full Rust
  workspace suite passed (60 unit tests plus doc tests). Implementation
  commit: `6e9b6a0`.
- 2026-07-17, Step 2: Added the alternating-player external-sampling MCCFR
  trainer as a Rust workspace crate. It samples legal deals using a
  non-clairvoyant discard heuristic, expands every traverser action, samples
  opponent actions, and evaluates terminal play in pone-hand, dealer-hand,
  crib order with board-aware continuation utility. The learned key groups
  exact legal views by observable retained/revealed ranks, current-series
  order, go/last state, role, and board pressure; it intentionally omits cut
  and own-discard ranks to make repeat learning feasible without introducing
  hidden-hand information. One-use states retain only deterministic 64-bit
  fingerprints and become full regret nodes when revisited.

  The CLI supports deterministic seeds, parallel workers, atomic status with
  ETA, deterministic checkpoint/resume, per-run wall limits, projected
  reference-work limits, and an information-set memory guard. The final 10k
  release probe trained at 10,048 iterations/second, completed in 1.0 second,
  retained 101,053 trained plus 517,382 singleton states, and wrote an 11 MB
  checkpoint. The non-persisting 100k probe completed in 12.5 seconds at
  8,007 iterations/second with 1,277,862 trained plus 3,658,245 singleton
  states, projecting to 0.00023 of the 15.05-hour reference workload. CLI
  resume from 10k to 11k and a forced information-set-limit stop both passed.
  Formatting, all 70 workspace unit tests plus doc tests, and warning-as-error
  Clippy for the trainer passed; only pre-existing shadow-engine dead-code
  warnings remain. Implementation commit: `ebed86c`.
- 2026-07-17, Step 3: Moved the learned policy key into the runtime engine and
  added a versioned compact artifact with deterministic key ordering, FNV
  checksum, atomic save/load, training provenance, source-checkpoint checksum,
  source/included coverage counts, minimum-evidence threshold, and the named
  legal-information heuristic backoff. Legal rank/go probabilities use sparse
  largest-remainder weights totaling 65,535; decoded values are within one
  quantum (`1 / 65,535`) of the normalized cumulative average strategy, with
  regret-matched current strategy used only when a node has no average sample.

  A new `pack_policy` CLI converts any retained checkpoint into
  `rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin`; the existing
  server packager already includes that entire asset directory. A real
  single-worker 1,000-iteration release probe retained 8,035 trained plus
  57,571 singleton information sets. With minimum evidence 2, it emitted 2,267
  entries in 98,732 bytes; two independent packs were byte-identical with
  artifact checksum `02ffc7f680ec7f9a` and SHA-256
  `14c2d417f11da9729260344d188b33ac150e5879ac5f2f903aeb17b6417af16f`.
  Formatting, all 78 workspace unit tests plus doc tests, warning-as-error
  Clippy for the trainer, corruption/truncation rejection, and server-package
  path/syntax checks passed. The probe files were removed after QA; no
  provisional policy asset was committed. Implementation commit: `07360f1`.
- 2026-07-17, Step 4: Routed only Model 16 pegging away from the legacy
  opponent-hand enumeration/optimal-response solver. Runtime now constructs
  the same observable rank key as the trainer, performs a deterministic
  average-policy lookup, and picks the highest-weight legal rank (stable ties
  and duplicate-rank suits are deterministic). A missing policy file or key
  uses a bounded one-reply tactical heuristic over public and own-known cards;
  it cannot inspect or specialize future actions to an opponent's hidden hand.
  Models 13.0 through 15.2 retain their existing paths.

  The validated policy artifact is loaded at most once per server process and
  retained with the other runtime tables; a corrupt present asset fails closed
  rather than silently falling back. Trainer/runtime key-parity, learned-policy
  override, hidden-world independence, legal choice, deterministic choice, and
  cache-reuse regressions passed. Six complete 16.0-versus-16.0 release games
  produced 298 timed multi-card decisions: p50 0.001 ms, p95 0.003 ms, p99
  0.003 ms, and max 0.028 ms. By legal-card count, maxima were 0.001 ms (2),
  0.002 ms (3), and 0.028 ms (4), all far below the frozen 15.2 baselines.
  Full QA passed: Rust formatting, 62 unique workspace unit tests plus doc
  tests, shadow-engine Clippy with only pre-existing warnings, workspace
  release build, frontend TypeScript check, and production frontend build with
  its protected-artifact check. The temporary timing database was removed.
  Implementation commit: `3f5f908`.
- 2026-07-17, Step 5: The deterministic 250k-iteration candidate completed in
  117.1 seconds at 2,134 iterations/second, far inside the hard compute cap.
  Its 451,192-entry minimum-five artifact was 19,886,119 bytes and achieved
  29,150/50,207 learned-policy hits (58.06%) over the final 2,000-game held-out
  evaluation. Regret proxies and memory measurements are recorded above.

  Model 16 won 434/1,000 games (43.4%) against 13.0 and 413/1,000 games
  (41.3%) against 15.2 after side swapping, so the play-quality promotion gate
  failed decisively. Across 50,207 timed contested Model 16 decisions, latency
  remained far below the frozen 15.2 gate: for 2/3/4 legal cards respectively,
  p50 was 2/3/4 microseconds, p95 was 13/10/15 microseconds, and p99 was
  22/21/27 microseconds. The candidate is rejected for release, production
  remains on 13.0, and the untracked asset is retained only to support the
  Step 6 correction ablations. Evaluation record commit: `e07e145`.
