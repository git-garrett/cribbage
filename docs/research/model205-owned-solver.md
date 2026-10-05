# Model 20.5 owned decision solver assessment

Date: 2026-09-29. **Not retained.** Exclusive ownership is a reasonable architectural direction, but this isolated migration did not provide a meaningful speed gain in the complete-hand gameplay measurement. Keeping compatibility with historical interfaces added adapter code overall. The four changed engine files were restored byte-for-byte and both prototype modules removed; earlier retained 20.5 optimizations remain.

This records the first prototype. A subsequent user-requested architecture and
investigation are documented in [the modern owned entry-point assessment](model205-modern-owned.md).

## Ownership conclusion

Use one common executable solver implementation, with mutable caches owned by one decision and immutable beliefs/board assets shared. Models should select their configuration. Duplicating the solver algorithm per model creates maintenance risk; a long-lived solver per model must not retain observation-to-action decisions across live decisions (ADR 0001).

The current `Model911Policy` wraps a mutable `Model91Policy` in `Arc<Mutex<...>>` and uses a separate mutex for its likelihood cache. The historical offline context-free adapter intentionally shares its evaluator, so its shared interface still serves a purpose. The outer Arc is not cloned on every policy query. Existing generic calls use static dispatch; this was not a virtual-dispatch removal.

## Prototype

Only 20.5 selected a plain owned evaluator and likelihood cache through mutable references. Shared Model91 algorithms, observation conversion and likelihood arithmetic were reused. Immutable asset sharing, action/evidence/future cache capacities, admission, clearing, posterior order, weighting, batching, continuation preparation, pruning, tie handling and cancellation were preserved. Prepared counting/review/pegging queries still shared their posterior.

This first experiment deliberately retained validation and conversions. It tests the ownership change, not the separate proposal to introduce a validated internal representation or eliminate additional checks. The latter remains unproven by this experiment.

## Performance

Independent PGO builds used the same compiler, target, flags, model corpus and assets. Their input manifests differed only in the six prototype source files. Reference and candidate executable hashes matched their build receipts. All tests ran on the local Mac; these are process CPU times, not production-server latency estimates. The active 20.3 versus 20.4 benchmark and production were untouched.

The complete-hand worker uses `recommend_peg_for_side_with_caches`, the native gameplay recommendation entry point. Three complete hands, each repeated twice in alternating order, gave:

| Measurement | Retained baseline | Owned prototype | Change |
|---|---:|---:|---:|
| Pone first decision | 9.915746 s | 9.904262 s | 0.116% faster |
| Pone whole-hand pegging | 10.065852 s | 10.054770 s | 0.110% faster |
| Dealer first decision | 1.239836 s | 1.241881 s | 0.165% slower |
| Dealer whole-hand pegging | 1.259828 s | 1.260962 s | 0.090% slower |

These changes are effectively neutral. First decision means the player's first pegging decision in the whole hand. Whole-hand totals sum every decision for that role; they are measured totals, not extrapolations from partial fixtures.

The initial isolated decision-worker test appeared much better: pone first decisions improved 7.755% and dealer first decisions 4.104%. However, the reference executable was slower than in preceding assessments while the complete-hand worker showed no comparable benefit. Four additional fresh process pairs, reversing launch and execution order, reproduced the isolated result:

- Pone first decision: 11.938155 → 11.045728 seconds, 7.475% faster (16/16 pairs faster).
- Dealer first decision: 1.726595 → 1.668524 seconds, 3.363% faster (15/16 pairs faster).

A final matched-position diagnostic sent the three complete-hand pone openings through the isolated executable, with two fresh process pairs. Decisions and exact EV/WP bits matched both implementations and the corresponding complete-hand result. This route improved 6.723% (10.636218 → 9.921127 seconds), whereas the complete-hand route for those same positions improved only 0.116% (9.915746 → 9.904262 seconds).

The isolated gain therefore did not transfer across the measured executables/call paths. The exact compiler/runtime cause was not established; this does not prove locks are free or rule out a future ownership refactor. It does rule out presenting the isolated result as a demonstrated general gameplay/benchmark improvement. Given neutral complete-hand throughput and additional compatibility machinery, retain the simpler current implementation.

## Parity and verification

- 440 candidate tests passed across 22 targets. Two new tests cover exact posterior weights/forecast histograms through a hand, both actors, reordered repeated batches, matching memo statistics, independent decision ownership, and invalid-input rejection/recovery.
- 138 reference/candidate decision and value comparisons matched exactly: 36 isolated requests, 64 decisions in six complete-hand replays, 32 fresh-process opening comparisons, and six matched-position route comparisons. All six final hand states matched.
- PGO baseline-versus-optimized parity passed all 26 corpus cases for each of 20.4 and 20.5. Timing inputs did not duplicate PGO training inputs.
- No playing difference was observed. These replay checks are finite coverage, supported by reuse of the unchanged evaluator and arithmetic; they are not a new playing-strength claim.
- All 438 restored baseline tests passed across 22 targets (see `restored-qa.json`). Whitespace and exact restoration hashes are recorded.

## Reproduction

Internal assessment: `/private/tmp/cribbage-205-owned-solver`.

Durable archive: `benchmarks/model20/evaluation-20260929/owned-solver-assessment` in the main repository. It contains source snapshots, the rejected patch, fixtures, PGO receipts, raw timings, all three completed supervisor specifications/statuses, parity reports, restoration hashes and a verified archive manifest. No experiment code is enabled in 20.5, and no commit, push, production deployment or head-to-head restart was performed for this assessment.
