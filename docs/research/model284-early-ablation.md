# Does excluding late-game observations improve early beliefs?

There is a small average predictive gain, concentrated in dealer discards, but
the early-only version worsens pone hand predictions at scores 101–110. This
does not justify replacing the broad early-use asset across both roles.

## Matched comparison

Both arms use the same ten qualified, immutable sources from the late-belief
experiment and the same seed-grouped train/tune/test partition. Neither reads
the existing broad asset's probabilities or inherits its historical observations.

- All-score arm: 205,412 training decisions (102,706 per role).
- Early-only arm: 195,516 training decisions (98,550 dealer; 96,966 pone),
  excluding actor start-of-hand scores 111–120.
- Both tune only on the same early-game tuning observations, using the same
  strength grid, and test only on early-game observations.
- Test set: 23,829 actor-hand observations (11,994 dealer; 11,835 pone) from
  690 stored seed groups. Their 95,198 observed hold prefixes are correlated;
  intervals resample whole seed groups, including both orientations.
- Near-boundary subset: 1,687 actor-hands at scores 101–110 (795 dealer;
  892 pone).

The hold estimator starts with a physical four-card prior; later-prefix backoff
uses only that arm's fitted opening distribution. The conditional-discard prior
uses only that arm's training role marginal with the existing 1% physical floor.
Thus the early-only arm cannot regain late observations through a shared prior.
The architecture and tuning procedure are identical; each arm tunes its own
strengths against the same early target.

The test reconstructs all early test labels from frozen source databases and
requires exact equality with their retained aggregate counts. Source snapshots,
run provenance, model eligibility and seed partitions are verified. Scores refer
to the subject player's score when the hand began; the opponent may already be
within ten points. Separate reports also cover both players below 111.

## Results

These are prediction results after physically conditioning on known cards and
the cut. Delta is **early-only minus all-score** negative log likelihood;
negative means the early-only version predicts better.

| Test population | Component | Role | Delta | 95% seed-group interval |
| --- | --- | --- | ---: | --- |
| All 0–110 | Hold | Dealer | −0.00241 | [−0.00438, −0.00048] |
| All 0–110 | Hold | Pone | −0.00196 | [−0.00375, +0.00002] |
| All 0–110 | Discard given keep | Dealer | −0.00630 | [−0.00853, −0.00394] |
| All 0–110 | Discard given keep | Pone | −0.00003 | [−0.00354, +0.00384] |
| 101–110 | Hold | Dealer | −0.00591 | [−0.01802, +0.00415] |
| 101–110 | Hold | Pone | **+0.02411** | **[+0.01423, +0.03561]** |
| 101–110 | Discard given keep | Dealer | −0.00800 | [−0.01771, +0.00506] |
| 101–110 | Discard given keep | Pone | +0.01887 | [−0.00097, +0.04345] |

Dealer discard predictions improve on both log loss and Brier score. The tiny
overall dealer hold improvement is less consistent: its Brier interval includes
zero. Overall pone results do not show a clear gain. Near the boundary, pone
hold predictions worsen on both measures; the Brier delta is +0.000834 with
95% interval [+0.000472, +0.001220].

Pooling both roles, early-only improves average hold NLL by 0.00219 and discard
NLL by 0.00319. However, at 101–110 the pooled hold NLL worsens by 0.00992,
with interval [+0.00206, +0.01790]. The average improvement hides an important
boundary tradeoff. Intervals are exploratory per-comparison intervals, not a
family-wise guarantee across every reported subgroup.

## Decision and reproducibility

Keep the broad prior unchanged for now. A dealer-specific exclusion remains an
experiment worth considering, but a universal early-only replacement is not
supported by these results. No win-rate benefit is established by prediction
metrics; no gameplay, production activation, or correction rebuild occurred.

This is a matched new-corpus ablation, not a literal purge and reconstruction of
every historical production observation. Suit/decline components are outside
this test and do not supply priors to either arm.

Artifacts are retained at
`/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model284/early-ablation-20261126-v1`.
The [assessment](model284-early-ablation-assessment.json) contains all role,
model, prefix, boundary, known-card-conditioned and unconditioned metrics;
the [manifest](model284-early-ablation-manifest.json) identifies fitted models,
the saved bootstrap seed, held-out cases and source/dependency hashes.

Run `scripts/model284_early_ablation.py --corpus <late-beliefs-20261126-v3>
--output <new-output-directory>` with the repository Python environment.
`npm run test:early-ablation` covers neutral support, within-arm backoff,
regularization, scalar/vector conditioning parity and paired seed clustering.
