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

Active local run (not yet a completion record):

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
- repository release asset pending held-out validation:
  `rust/cribbage-shadow-engine/assets/model16-pegging-policy.bin` (an exact
  copy of the selected candidate, currently untracked);
- paired held-out evaluation root:
  `/Volumes/Elements/cribbage/model16-policy/2026-07-17/release-eval`;
- resumable evaluator: `scripts/run-model16-release-eval.sh`; each matchup
  writes `status.json`, `games.db`, and append-only `sessions.jsonl` below the
  evaluation root. Matchups are 16-vs-13, 13-vs-16, 16-vs-15.2, and
  15.2-vs-16 with the same seeds used for each side swap.
- active evaluator: detached screen session `cribbage-model16-eval` (screen id
  `73687`), started 2026-07-17 at approximately 17:34 PDT with four workers,
  500 games per side ordering/2,000 total. Supervisor output is
  `release-eval/runner.log`; the currently active matchup's live ETA is in its
  `status.json`. No launchd job was created.

The final trainer completed 250,000 iterations in 117.7 seconds at 2,134
iterations/second, retaining 3,213,626 trained plus 7,139,584 singleton states.
It used 3.27 GB maximum RSS/4.66 GB peak footprint with no swap. Relative to
the 100k calibration, positive-regret-per-update fell from 0.004257215 to
0.003423015 and max-positive-regret-per-update fell from 0.003585713 to
0.002903875. The minimum-five candidate covered 237/404 (58.7%) contested
choices in an eight-game held-out smoke. Minimum three covered 252/419 (60.1%)
but doubled the artifact to 40,657,581 bytes, so minimum five was selected.

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
