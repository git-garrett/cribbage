# Model 28.3 — Score-block pegging

Canonical ID: `schell_table-peg_table-28.3`. The native model parser also accepts `28.3`. This experimental model is available to the normal native runner, streaming decision worker, API identity handling and saved-play review. Ace and existing model defaults are unchanged.

## Frozen strategy definition

28.3 replaces the pegging forecast with the compact, decision-local score-block backward policy developed in the 2026-10-03 experiments. Both actors choose one action per own four-card hold and public information state, averaging the conditional terminal scores under their own empirical opponent-hold weights. Parents consume these selected scores. No older model selects future pegging moves, and there is no timeout fallback or sampling.

Each actual live decision uses the actor's known discards, original keep, cut and public history through the normal 20.7 posterior. A single extra decision-local result row now preserves those known discards in that actor's later choices against the existing shared opponent policy. Its private constraints never narrow the opponent's legal uncertainty or alter that opponent policy. When the other actor becomes live, the same mechanism uses its own known discards. Unknown hypothetical opponent discards are not enumerated. See [the known-discard continuation assessment](model283-known-discards-continuations-20261004.md).

Future selections now retain each hold's rank-based show score and count pone then dealer before applying the engine's generic unknown-crib forecast and next-hand board WP. No extra private contexts are added. Future suits and unknown opponent discard contexts remain approximations; currently known own discards are retained in continuations; see [the future-counting and 20.x strength audit](model283-future-counting-20261004.md). The live root now retains each opposing hold's pegging result through **joint, hand-conditioned show/crib valuation**, using 20.7's legal posterior and conditional discard priors. Compact suit classes preserve flush/nobs and physical hand/crib exclusions without adding future private contexts. See [the compact-counting assessment](model283-compact-counting-20261003.md) for the measured correction and decision-local reuse changes. 28.3 also retains 20.7 discard selection, tie breaking, empirical assets, depletion, likelihood factors, physical-card selection and forced-rank choice shortcut. Root crib valuation averages over possible opponent discards, as 20.7 does; those variants are not expanded into pegging-tree worlds. No training data or asset was changed. The source base is commit `e8098cc828793bcc1faf46fae3eb113f3124a13c`.

This restores the root valuation omitted from the earlier standalone trial. Its previous WP values and decisions are not assumed to be the final native model's values or decisions.

## Representation and information boundary

Public history is validated and prepares the two hold domains once at the root. The solver discovers legal public branches, resolves their children before choosing the parent, and releases child results when consumed. Conditional scores occupy two-byte cells or one shared score when constant. Physical transitions retain meaningful zero-scoring choices. Only forced and publicly uncontested suffixes bypass belief selection.

The implementation does not retain an exhaustive path graph or a production observation-to-action table. A test-only diagnostic map is enabled solely for small finite-reference tests. Immutable assets are shared; mutable solve state belongs to the decision. Engine knowledge of a hypothetical pair is used for scoring and deck compatibility, while action selection combines all the actor's legally possible opposing holds before choosing.

This implementation still visits many public branches. It is not the original few-thousand-scoring-sequences representation, and this registration makes no claim that the current compute cost is unavoidable or appropriate for production UX.

## Validation contract

- Bounded independent terminal-to-root reference and compressed/uncompressed score-block parity.
- Hidden 4/7 witness: one legal-information action, 75% WP rather than a clairvoyant 100%.
- Native posterior agreement through both actors, own discards, Go and reset histories; private discards cannot change public hypothetical domains.
- Compact physical transitions compared with the native rules across all continuations of bounded hands, including 31, Go and race-to-121 endings.
- Bit-identical 20.7 discard decisions. Joint root counting is checked against physical enumeration, show marginals, exact certain outcomes and counting-order scoreouts; it intentionally supersedes the original separate-marginal valuation.
- Live choice, selected-action review and combined review agree on values and recommendation.
- Release-only check against the frozen standalone opening's posterior-weighted distribution/choice under its original board-only utility.
- Full Rust suite, TypeScript typecheck, native runner/worker release build and six serial complete-hand feasibility checks, three per model.

Initial feasibility builds explicitly use the build script's `--no-pgo` diagnostic option. Normal Mac benchmark builds retain automatic PGO; train the requested matchup with `--model schell_table-peg_table-28.3 --model schell_table-peg_table-20.7`. No CPU-specific tuning is added.

## Running further tests

The native runner accepts `--left schell_table-peg_table-28.3` or `--right schell_table-peg_table-28.3`. Long benchmarks must use the repository's one-shot supervisor and benchmark-runner skill, with fresh recorded seeds and frozen source/assets/binary.

The small `model283-hands` Cargo example accepts a model-root argument and optional model ID, then one JSON hand per stdin line. A fixture has `own` and `opponent` six-card ID arrays (first four kept, last two discarded), `cut`, `dealer` (0 or 1), and **pre-cut** `scores`. Native rules apply Jack-cut points. It reports legal full-hand decisions, first/whole-hand timing inputs, and terminal pegging scores. It can also run 20.7 for matched comparisons.

Optional `CRIBBAGE_283_PROGRESS` records block/group counts and completed root candidates. `CRIBBAGE_283_HAND_PROGRESS` records completed real decisions in the small hand harness. These counts are activity diagnostics, not a calibrated ETA or completion percentage.

Validation work directory: `/private/tmp/cribbage-model283-validation-20261003-v1`.

Verified results follow. No production deployment or strength claim is part of this integration.

## Verified native integration results

These are the original frozen integration results, before the compact-counting and reuse follow-up. Later results are reported separately in the linked assessment.

The frozen validation job passed the full Rust suite, TypeScript typecheck, native release runner/worker/harness builds and the release comparison against the prior standalone opening. All six hand runs use the normal native game and decision interfaces, validate legal plays and complete all eight cards in every hand. Source, assets and binaries match their frozen hashes.

These are three saved fixture reproductions per model, with matched cards, known discards, cut and post-cut board. The third Jack-cut fixture uses pre-cut 118–114 to begin pegging at 118–116. Each hand uses a fresh process. Work is serial at background priority/nice 20 alongside the six existing workers. Builds are standard release without PGO. Timings include the normal native root valuation.

Times are **wall / CPU seconds**. Whole-hand columns sum every actual decision by the named actor.

| Model | Hand | Pone first | Pone whole hand | Dealer first | Dealer whole hand | Peak process MB | P-core share |
|---|---|---:|---:|---:|---:|---:|---:|
| 20.7 | deal-2095846253 | 23.463 / 23.083 | 24.284 / 23.903 | 5.147 / 5.080 | 5.239 / 5.165 | 86.10 | 0.00% |
| 20.7 | deal-2095846285 | 48.225 / 47.593 | 49.257 / 48.617 | 3.352 / 3.274 | 3.528 / 3.450 | 121.70 | 0.00% |
| 20.7 | deal-2095846309 | 51.806 / 50.728 | 52.990 / 51.890 | 3.093 / 3.011 | 3.260 / 3.176 | 73.11 | 0.00% |
| 28.3 | deal-2095846253 | 89.503 / 87.396 | 89.962 / 87.838 | 11.541 / 11.236 | 11.602 / 11.296 | 22.99 | 0.00% |
| 28.3 | deal-2095846285 | 153.672 / 150.673 | 154.433 / 151.425 | 14.870 / 14.656 | 14.953 / 14.738 | 19.53 | 0.00% |
| 28.3 | deal-2095846309 | 160.634 / 156.682 | 161.393 / 157.431 | 15.284 / 15.039 | 15.340 / 15.095 | 21.73 | 0.00% |
| 20.7 | **Mean** | 41.165 / 40.468 | 42.177 / 41.470 | 3.864 / 3.788 | 4.009 / 3.931 | — | — |
| 28.3 | **Mean** | 134.603 / 131.584 | 135.263 / 132.232 | 13.898 / 13.644 | 13.965 / 13.710 | — | — |

| Hand | Same lead as 20.7? | Same complete rank-action line? | Final pegging scores: 20.7 → 28.3 |
|---|---|---|---|
| 1 | True | True | [16, 15] → [16, 15] |
| 2 | True | True | [68, 73] → [68, 73] |
| 3 | True | False | [119, 119] → [119, 119] |

All three leads match 20.7. The first two complete rank-action sequences also match. On the third deal, the dealer chooses an 8 where 20.7 chooses a 6; later play order also differs, but both finish at 119–119.

Across these three fixtures, 28.3 mean pone-opening wall time is 3.27 times 20.7. Every run recorded zero performance-core CPU share. Peak process memory is 19.53–22.99 MB for 28.3 versus 73.11–121.70 MB for 20.7. These are single-pass, background efficiency-core measurements without PGO, not isolated production-hardware timings.

These checks establish native integration, defined strategy behavior and measured feasibility on these fixtures. They do not establish equal or superior playing strength. Differences from the standalone trial can arise from restoring the normal live-root hand/crib valuation. A wider paired playing-strength assessment remains a separate task.

Durable evidence: `benchmarks/model28/model283-native-20261003`. `summary.json` records all raw decisions, per-actor timing, memory/core counters and paired lines. `frozen.json` records the base commit, full source/asset hashes, compiler and scheduling. Source changes and new files are archived with the binaries and verification receipts. No production deployment, default-model change or ongoing benchmark restart was performed.
