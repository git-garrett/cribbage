# Model 20.1 streamlining and benchmark restart

Date: 2026-09-26. Baseline: `3e5494e4b5353014a6e7ae44915b6bc5d121045d`, including the previously accepted cache and engine optimizations. Retain only the checked-entry WP continuation change described below. No cache policy, size, representation, or lifetime change.

## Benchmark restarted

The previous run was stopped through the one-shot supervisor, and all 902 completed games were preserved: 452 candidate-left and 450 opponent-left. Both databases were copied and byte-verified under `benchmarks/model20/evaluation-20260925/20.1-vs-20.0-10k/`. Higher indices had completed before lower ones; the old run was archived rather than resumed from a row count.

A fresh 10,000-game run started at approximately 02:09 PDT on September 26. It uses 5,000 games per orientation, six workers per orientation, and the new independent seed `0x26d96a96`. The rebuilt runner includes all gains through `3e5494e`; the opponent remains the frozen Model 20.0 engine from `1925d15bb13a1c4ac8d39a7d87a6d89b7fc7aeed`. Both orientation smoke games completed and passed provenance checks before the full run.

- Active specification: `/private/tmp/cribbage-model201-vs-model200-10k-20260926-v2/job-v2.json`.
- Runtime output: `/private/tmp/cribbage-model201-vs-model200-10k-20260926-v2/benchmark/`.
- Frozen setup archive: `benchmarks/model20/evaluation-20260926/20.1-vs-20.0-10k/setup/`.
- Runner SHA-256: `d50aa1251bbfc20e253e69c9b505379c8fe81eb90bbf5f20f352eca142ddbd78`.
- Opponent SHA-256: `89c659f74590483f4f956dd7dcf4dabb781f7b54ed95bdf5f33bf3f9dbaa8eb9`.

The initial restart job finished both smoke games but failed while reopening a completed SQLite database through a read-only WAL connection. A separate versioned orchestration helper now rejects any nonempty WAL and opens only completed databases using an immutable read connection. The corrected job reused the completed smoke games and frozen binaries. It did not alter model code or game results. Original and corrected job specifications and the operational patch are retained.

**Archive limitation:** a launchd preflight demonstrated that macOS denies the background job write access to the external volume. Computation, integrity checks, and reports use internal storage and can finish. The final external sync stage will require a foreground run after completion. Frozen setup and the stopped old results were already archived from the foreground. The benchmark must not be reported complete until that final sync passes.

The new optimization below was developed after this restart and is not part of the active frozen run.

## Measurements

Full Model 20.1 pegging decisions through the benchmark streaming adapter, with three repetitions and rotated execution order. Each discovery and validation corpus contains 12 retained real-game observations, six dealer and six pone. The corpora are disjoint; they are the established replay corpora from the previous engine experiment, not fresh whole-game strength tests.

Initial experiment, CPU reduction versus baseline:

| Candidate | Discovery | Validation | Decision |
| --- | ---: | ---: | --- |
| Share immutable empirical beliefs using Arc | 1.52% | 1.76% | Do not retain in final combination |
| Choose the required crib distribution before context construction | 0.09% | 0.18% | Too small to justify this change |
| Reuse a prepared rollout state and public validation | -0.53% | 1.20% | Inconsistent gain; leave out |
| All three | 1.06% | 0.89% | Slower than sharing alone |

A fourth hypothesis targeted redundant legality checks in the hottest recursion. It was tested independently and stacked with belief sharing:

| Candidate | Discovery CPU | Validation CPU | Discovery wall | Validation wall |
| --- | ---: | ---: | ---: | ---: |
| Belief sharing, repeated | 0.44% | 1.10% | 0.47% | 0.55% |
| Checked entry, recursive legal enumeration | **2.38%** | **0.93%** | **1.39%** | **0.38%** |
| Both | 0.69% | 0.91% | 0.39% | 0.87% |

Retain the checked-entry change alone: it is small, reduces work in a demonstrated hot path, and the combination did not improve aggregate CPU time in either corpus. Belief sharing showed a modest positive effect across runs, but the effects did not add. The initial tentative choice to retain sharing was superseded by this stacking experiment.

The retained change improved the CPU-dominant pone cases by 2.64% and 1.04%; dealer aggregate CPU was 0.37% and 0.62% slower. These small effects are measurements under concurrent benchmark load, not statistical guarantees or whole-game throughput estimates. Process CPU is the primary metric; wall time is more affected by scheduling. Test builds and sampling did not overlap timed comparisons. No peak-RSS improvement is claimed.

All 648 timed outputs across the four comparison runs preserved the selected card and exact serialized EV and WP. The retained variant was tested in 72 paired comparisons across 24 positions. No persistent decision/action table was introduced.

## Retained implementation

`WpMemo::forced_play` checks the caller-supplied rank, card presence, and count legality. The private recursive `play` function relies on those entry checks and on `future`'s existing enumeration of present ranks that fit under 31. Debug assertions retain internal invariant checks. The runtime series-length guard remains because malformed internal input can overflow the packed series even after a legal first move. There are only these two callers of the private function.

Move order, weighting, floating-point accumulation, scoring, first-winner termination, and memo behavior are unchanged. The only final engine edit is in `model91_compact.rs`; the normal decision worker and other model files were restored.

## Verification

The final retained source passed the Model 9.1 unit suite and Model 20 live/review integration suite in release mode. Coverage includes compact scoring against the reference, complete-game EV continuation equivalence, WP continuation equivalence and first-winner termination near 121, invalid-rank/count/recursive-series rejection, and live/review hand-cache equivalence. Only the pre-existing warning about unused `WeightedEntry` fields remained.

Baseline guard tests were added and passed before the prototype. Separate belief-clone independence and rollout-validation regressions also passed against the baseline before their corresponding prototypes; those tests remain with the rejected prototypes in the experiment archive.

## Further work

The optimized baseline's 10-second sample still places the largest leaf counts in continuation traversal (2,222), packed scoring (1,366), and applying plays (1,120), followed by empirical weighting (451). These samples identify where to look, not universal percentages. Allocation and standard hashing are visible but the direct belief-sharing experiment demonstrates that removing a plausible cost does not guarantee an additive overall gain.

A controlled worker-count sweep remains useful for total games per hour, since the current 12 workers share six performance and six efficiency cores. A dynamic next-index queue could reduce the final completion tail from uneven game durations; it is unlikely to materially improve steady-state throughput. Neither scheduling change was applied to the active benchmark.

Experiment artifacts: `benchmarks/model20/streamlining-20260926/`. Internal working directory: `/private/tmp/model201-streamlining-20260926`; executable snapshots remain in its `bin/`. Retained artifacts include source prototypes, input fixtures, per-decision results, sampler output, supervisor specifications, and final verification/provenance records.
