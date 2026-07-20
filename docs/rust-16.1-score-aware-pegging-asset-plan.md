# Model 16.1 Score-Aware Information-Set Pegging Asset

## Objective

Build a new, offline-generated Model 16.1 discard-pegging asset that improves
on the retained `model13-pairwise.bin` without adding human-visible decision
latency. The asset must preserve the legal-information boundary: a simulated
player may use its own cards and public history, but never the other player's
unrevealed cards.

Model 13.0 and Model 16.0 remain immutable comparison baselines. No
production-model change is implicit in this work.

## Target Design

The production artifact will be a compact, versioned transition DAG rather
than a table containing only aggregate `(own_pegging, opponent_pegging)`
totals. For each compatible four-card rank pair, role, public pegging state,
and relevant score region, it will represent the exact distribution induced by
the final Model 16.1 average policy. A leaf carries the ordered scoring events
needed to evaluate count-outs before hands and crib.

`C16TRN01` is the first, fixed-width reference format. It records those
ordered scoring events for a supplied set of exact score contexts and is
resumable/checksummed. It deliberately precedes the deployable DAG compaction:
the reference matrix gives us a correct oracle and measurements before adding
lossless interning or a runtime reader.

The builder will enumerate chance and policy branches exactly. MCCFR/CFR is
used to learn the policy; it is not used to estimate artifact rows. Equivalent
subtrees and score regions are interned losslessly so the deployed reader can
select a leaf with a compact lookup instead of a live rollout.

The final policy must use all legally observable features relevant to a
pegging decision: exact scores, own retained/discard information, cut context,
role, count, and public pegging history. Any generalized backoff must be
explicitly measured and recorded.

## Work Log

### 1. Durable Contract and Build Controls

- [x] Preserve Model 13.0 and Model 16.0 artifacts and decision paths.
- [x] Record artifact requirements, legal-information boundary, and promotion
  gates in this document.
- [x] Define versioned `C16TRN01` reference records with ordered score events,
  deterministic byte encoding, and malformed-header/record rejection tests.
- [x] Add a resumable local reference compiler with atomic `status.json`,
  checkpoint truncation safety, throughput, ETA, and output checksum reporting.

QA and release gate:

- Artifact format round-trips byte-for-byte.
- Two hidden opponent holdings that are indistinguishable to the actor select
  the same policy action distribution.

### 2. Full Legal-Information Pegging Policy

- [x] Add a lossless Model 16.1 policy-key serialization containing the exact
  legal observation: scores, own retained/discard ranks, cut rank, role,
  count, relative actors, and ordered public history.
- [x] Add a separately versioned, checksummed full-observation policy artifact
  (`C161POL1`) so Model 16.1 cannot accidentally load a compressed 16.0
  policy table.
- [ ] Train the four-card pegging subgame with exhaustive CFR where feasible;
  use only an explicitly documented exact chance partition where exhaustive
  traversal is not tractable.
- [ ] Save resumable checkpoints and frozen average-policy artifacts outside
  the repository on `/Volumes/Elements`.

QA and release gate:

- No policy key includes unrevealed opponent data.
- Deterministic checkpoint/resume and policy pack tests pass.
- Coverage, regret/exploitability proxies, and fallback rate meet the recorded
  release threshold.

### 3. Exact Transition Compiler

- [x] Add an engine-owned rank-state policy adapter that invokes the existing
  Model 16 selector using only the acting seat's cards and public history.
- [x] Compile compatible retained-rank pairs through the current deterministic
  Model 16 policy for configured exact score contexts, preserving every
  reached scoring event in order.
- [ ] Enumerate every compatible retained-rank pair and every reachable public
  pegging history under the final Model 16.1 average policy.
- [ ] Traverse both actors' final information-set policies exactly; do not
  select actions using hidden cards.
- [ ] Record ordered scoring transitions and terminal outcomes, then intern
  equivalent subtrees and score regions losslessly.
- [ ] Make compiler status, ETA, checkpoint, and checksum durable on
  `/Volumes/Elements/cribbage/model16.1-pairwise/`.

QA and release gate:

- Small exhaustive fixtures match a direct legal-information simulator.
- The adapter matches the live learned-policy decision and is invariant when
  only the actor-invisible opponent holding changes.
- A two-unit release compiler smoke build completed 3,093 rows in 0.046 seconds
  at `/private/tmp/cribbage-model161-transition-smoke`; the resulting record
  file checksum was `bf839d067d4354a9`.
- Repeated builds with the same checkpoint are byte-identical.
- Aggregate rows differ from the old P12 asset only where the legal-policy or
  ordered-scoring change warrants it.

### 4. Runtime Reader and Model 16.1 Integration

- [ ] Add a compact reader and use it only for Model 16.1 discard evaluation.
- [ ] Preserve the current fast Model 13/14/15/16.0 paths unchanged.
- [ ] Use a stable per-game sampling seed if the final average policy remains
  mixed; compiler and runtime must use identical behavior.

QA and release gate:

- Ordered count-out fixtures are exact.
- Artifact corruption and missing-asset behavior fail safely.
- Discard p50/p95/p99 is no slower than the established human-latency budget.

### 5. Evaluation and Promotion Decision

- [ ] Run paired, side-swapped held-out matches against Model 16.0 and Model
  13.0, with confidence intervals and a fixed seed manifest.
- [ ] Compare fallback/on-book behavior and latency distributions.
- [ ] Deploy only if Model 16.1 clears both quality and latency gates.

## Status and Artifact Locations

- Local source and this plan: `/Users/garrett/Dev/cribbage`.
- Durable generated checkpoints, compiler status, logs, and non-source assets:
  `/Volumes/Elements/cribbage/model16.1-pairwise/`.
- Active reference build: `C16TRN01` matrix using the frozen 1B Model 16.0
  policy (`checksum 1cd4954985859055`) over 37 exact score contexts. It began
  on 2026-07-19 in detached screen session `cribbage-model161-reference`.
  Durable root:
  `/Volumes/Elements/cribbage/model16.1-pairwise/2026-07-19/c16trn01-policy1b-pressure-matrix/`.
  `status.json` is authoritative; `checkpoint.txt` records the safe resume
  boundary; `records.bin` is the raw reference matrix; the sibling `.log` file
  is append-only process output. The first ten units measured 2.47 units per
  second, projecting roughly 24.5 minutes; the live ETA supersedes this note.
- Completed calibration reference:
  `/Volumes/Elements/cribbage/model16.1-pairwise/2026-07-19/c16trn01-policy1b-calibration/`.
  It compiled 6,530,759 rows across the same contexts in 49.069 seconds with
  output checksum `92d0ce68944808b3`.
- The final deployable asset will be copied into
  `rust/cribbage-shadow-engine/assets/` only after validation. It will not
  replace `model13-pairwise.bin`.
