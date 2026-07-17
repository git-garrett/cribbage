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

- [ ] Implement alternating-player external-sampling regret updates.
- [ ] Keep the acting player's actions unified at each information set.
- [ ] Sample legal hidden deals and cut cards without exposing them in keys.
- [ ] Use ordered terminal scoring and board-aware utility near 121.
- [ ] Add deterministic seed, worker count, checkpoint, resume, status, ETA,
  and explicit wall-budget arguments.
- [ ] Run 10k/100k-iteration probes and project the capped build cost.

QA:

- deterministic single-worker checksum;
- checkpoint/resume parity;
- regret/strategy normalization and zero-illegal-action tests;
- measured projection remains below the 10-equivalent stop threshold.

### 3. Compact Policy Artifact

- [ ] Convert cumulative strategy into an average-policy artifact.
- [ ] Pack keys and rank-action probabilities with deterministic ordering.
- [ ] Include schema, training provenance, checksum, coverage, and backoff
  metadata.
- [ ] Add a loader and byte-for-byte deterministic pack test.

QA:

- unpacked policy equals trainer output within documented quantization error;
- corrupt/truncated artifact rejection;
- server package asset check.

### 4. Model 16.0 Runtime Integration

- [ ] Route 16.0 pegging through the information-set policy.
- [ ] Never fall back to the per-hidden-hand optimal solver.
- [ ] Use a cheap legal-information heuristic when a key is missing.
- [ ] Keep 15.2 and earlier behavior unchanged.
- [ ] Retain policy state/cache across turns where it reduces work without
  changing decisions.

QA:

- strategy-fusion regression: hidden-world substitutions cannot change the
  selected future action at a shared information set;
- policy legality and deterministic-choice tests;
- full Rust/frontend/release build QA.

### 5. Bounded Training and Release Evaluation

- [ ] Train only within the approved five-equivalent hard cap.
- [ ] Report actual iterations/second, wall time, CPU time, artifact size,
  coverage, and exploitability/regret proxies.
- [ ] Compare runtime p50/p95/p99 against the frozen 15.2 baseline.
- [ ] Run paired-deal, side-swapped validation against 15.2 and 13.0 with
  held-out seeds.
- [ ] Keep the policy in 16.0 only if wall-clock latency does not regress and
  play evidence is non-inferior or promising.

QA:

- frozen-seed smoke and paired validation;
- analyzer timing/calibration checks;
- clean worktree and pushed completion record.

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
