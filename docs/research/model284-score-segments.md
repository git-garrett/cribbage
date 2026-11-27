# Ace 28.4: dealer/pone controls and score segmentation

This experiment searches every last-early score from 100 through 120. Break
110 means early scores 0–110 and late scores 111–120, at the subject player's
hand start. Break 120 is the no-split control. It tests hold and rank-discard
beliefs; it does not measure playing strength or activate production assets.

## Protocol

The [frozen protocol](model284-score-segments-protocol.json) was saved before the
run. Source revision: `c467e92caced7d958560a85b987e01c35f2629f4`.

- Use the same ten qualified frozen sources and neutral physical foundation as
  the preceding early-data ablation. Never borrow old production probabilities.
- Keep the original training seeds. Split the original tuning seeds by a saved,
  fresh random salt into 392 smoothing and 358 cutoff-selection seed groups.
  All roles, hands and paired orientations of a seed remain together.
- Fit a role-separated no-split baseline and a role-pooled control. The latter
  removes role as a predictor while using the same data and estimator.
- For each of 100–119, train the early model only below/equal to the break, then
  update its probabilities with the late training observations. Tune each regime
  only on its own smoothing cases. Unobserved late tuning groups retain the
  early prior. Fit the 120 no-split model on all scores.
- Rank every candidate on the **same fixed all-score selection population**.
  Each player-hand contributes half its discard log loss plus half its mean
  hold-prefix log loss. Give dealer and pone equal weight. Report a common
  optimum and separately selected role optima; prefer no split on exact ties.
- Also report the fixed 100–120 window, without using it to change the primary
  selection rule. Do not compare changing early subsets to select a cutoff.
- Assess only the selected common/role-specific models and controls on the
  25,082 player-hands in 690 original test seed groups. Report whole-seed paired
  intervals, individual components, and fixed score windows.

The role-pooled comparison measures whether retaining role information helps.
The separate-versus-common comparison measures whether different cutoffs help
beyond role-specific probability tables. Neither alone proves that every Ace
component adequately models role or opponent behavior.

The test corpus appeared in the earlier 111 split and early-only investigations.
It remains excluded from this run's fitting and cutoff selection, but this is
not new blind confirmation. Selection-bootstrap intervals and winner frequencies
describe cutoff uncertainty; they do not establish a unique exact optimum.

## Execution and artifacts

The one-shot job is `ace284-segments-20261126-v1`, using the repository supervisor,
one compute process and one numerical-library thread. Its frozen scripts, source
snapshots, Python/NumPy environment, protocol and mutable output live under
`/Users/garrett/Library/Application Support/StrongCribbage/runtimes/ace284-segments-20261126-v1`.
`KeepAlive` is false. Stages separately prepare data, fit each candidate, select,
confirm, report, verify, synchronize and verify the durable copy.

Durable result directory:
`/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model284/segmentation-20261126-v1`.
The final archive includes all candidate weights and identities, selection curves,
confirmation results, frozen scripts and the exact job specification.

The runner is `scripts/model284_score_segments.py`. The four regression tests in
`npm run test:score-segments` verify boundary semantics, role pooling, routing,
hand weighting, separate role selection, no test-label access during selection,
and consistent no-split tie handling. The earlier scalar/vector conditioning
tests continue to cover the shared probability evaluator.

## Results

Keeping dealer and pone separate strongly improves predictions overall. The role-separated no-split control beats the role-pooled control by composite NLL 0.12670 for dealer and 0.13911 for pone; both paired test intervals exclude zero. This supports the role distinction in these hold/discard tables, rather than proving every Ace asset is fully calibrated.

| Selection | Last early score | First late score |
| --- | ---: | ---: |
| Best common break | **111** | **112** |
| Dealer minimum | 109 | 110 |
| Pone minimum | 111 | 112 |

The common break improves test composite NLL by 0.004474 over no split (95% interval 0.003053–0.005762 improvement). The separately selected breaks improve it by 0.004736, but their extra gain over the common break is only 0.000262, with delta interval [−0.000724, +0.000203]. Different role cutoffs are therefore not clearly justified.

The minimum is not uniquely established: common break 111 wins 64.5% of selection-bootstrap resamples, while 110 wins 18.85%. Differences from 110 and 112 have exploratory intervals including zero. These frequencies are stability diagnostics, not probabilities that a cutoff is truly optimal.

In the fixed 100–120 test window, the common split helps dealer composite prediction (delta −0.02711 [−0.03880, −0.01552]), while pone remains inconclusive (+0.00154 [−0.00614, +0.00911]). The late-pone advantage still needs confirmation.

**Recommendation:** retain separate dealer/pone probability tables and use **one shared experimental break after 111**. The earlier pilot began late mode at 111; the selected shared break begins it at 112. This is the best tested prediction boundary in this model family and cohort, not a proven win-rate optimum. Production remains unchanged.

This differs from simply discarding late observations: the segmented candidate retains them in its late update. The preceding early-only test assessed scores 0–110; this search evaluates a complete routed model on a fixed all-score population and uses separate smoothing and selection folds. Neither test literally reconstructs the full historical production asset.

Full [assessment](model284-score-segments-assessment.json) and [durable verification](model284-score-segments-verification.json). All 29 supervised stages completed, including archive verification. No games were played.

## Complete selection curve

Each value below is composite NLL minus the matching role-separated no-split baseline on the cutoff-selection data. Lower is better. These are selection scores, not 21 separate tests on the final test set.

| Last early score | Dealer delta | Pone delta | Common delta |
| ---: | ---: | ---: | ---: |
| 100 | +0.003812 | +0.004133 | +0.003973 |
| 101 | +0.000014 | +0.003287 | +0.001650 |
| 102 | -0.001518 | +0.002795 | +0.000639 |
| 103 | -0.002625 | +0.001968 | -0.000328 |
| 104 | -0.004052 | +0.002806 | -0.000623 |
| 105 | -0.004010 | +0.000977 | -0.001517 |
| 106 | -0.004405 | -0.000270 | -0.002337 |
| 107 | -0.005291 | -0.000607 | -0.002949 |
| 108 | -0.005680 | -0.001336 | -0.003508 |
| 109 | -0.006653 | -0.001420 | -0.004036 |
| 110 | -0.006174 | -0.002668 | -0.004421 |
| 111 | -0.006448 | -0.002878 | -0.004663 |
| 112 | -0.005700 | -0.002302 | -0.004001 |
| 113 | -0.005627 | -0.001190 | -0.003408 |
| 114 | -0.005839 | -0.001341 | -0.003590 |
| 115 | -0.004936 | -0.001061 | -0.002999 |
| 116 | -0.004336 | -0.001038 | -0.002687 |
| 117 | -0.002134 | -0.001356 | -0.001745 |
| 118 | -0.000688 | -0.000589 | -0.000638 |
| 119 | +0.000146 | +0.000392 | +0.000269 |
| 120 | +0.000000 | +0.000000 | +0.000000 |
