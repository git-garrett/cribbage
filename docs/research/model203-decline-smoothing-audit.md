# Model 20.3 decline smoothing audit

The subsequent [qualified refresh](../model-20.3-decline-factors.md) installed a
restricted-policy asset and checked the actual runtime posterior. The results
below describe the preceding broad-cohort investigation.

2026-09-27. This investigation leaves the installed runtime asset, engine, and
running benchmark unchanged. It evaluates `model203-decline-factors.json`.

**The observed regression principally comes from pooling different policies into
one population, not from Bayesian smoothing.** Weak smoothing slightly improves
prediction when the training counts are held fixed. Family-specific predictions
with a weak shared prior improve the broader held-out audit, but require a
known or estimated opponent profile. They are research candidates, not an
installed gameplay change or a demonstrated playing-strength improvement.

## Reproducing and explaining the original regression

The existing validation comprises 500 games, 3,722 held-card opportunities, from
13.23 versus 13.215. Lower mean negative log likelihood (NLL) is better.

| Estimate | Validation NLL |
| --- | ---: |
| Historical factors with positive floor | 0.3172954111 |
| Refreshed counts without smoothing, with positive floor | 0.3261889506 |
| Same refreshed counts with Beta(0.5, 0.5) smoothing | 0.3261846065 |
| Research current-20 profile, other families retained as a weak prior | 0.3148972491 |

The refresh is 2.802% worse than the historical factors on this split. Removing
smoothing makes it slightly worse again. The prior therefore does not explain
this regression. A grid of stronger symmetric Beta priors also failed to remove
the gap; increasing both parameters to 500 reduced NLL only to 0.3249933760.
That is a diagnostic, not a recommendation to add hundreds of pseudo-observations.

First-card pair declines account for **80.5% of the net increase in log loss**.
The old probability was 16.2491%, the new pooled probability 10.5467%, and the
observed validation frequency 152/745 = 20.4027%. The raw model cohorts differ
substantially:

| Actor | First-card pair decline frequency |
| --- | ---: |
| 9.0 | 183 / 22,220 = 0.824% |
| 9.1 | 133 / 16,926 = 0.786% |
| 9.11 | 77 / 7,970 = 0.966% |
| 13.0 | 5,801 / 41,619 = 13.938% |
| 13.1 | 1,558 / 15,880 = 9.811% |
| 13.215 | 962 / 5,962 = 16.136% |
| 13.23 | 2,460 / 11,055 = 22.252% |
| 20.0 | 2,811 / 15,986 = 17.584% |
| 20.1 | 799 / 5,148 = 15.521% |
| 20.2 | 859 / 5,582 = 15.389% |

All of these are eligible cohorts. Historical strength does not establish that
their decision probabilities are interchangeable. The large 9.x cohort shifts
the pooled estimate away from the policies in the original validation matchup.
These are observed cohort differences; this audit does not isolate how much of
each difference comes from policy versus the distribution of positions played.

The previous calibration only varied pooling *between card ordinals*. It did
not test cohort weighting, the weak prior's strength, or the intended opponent
population. Calling its result an ideal smoothing configuration would be wrong.

## Broader held-out audit

A deterministic SHA-256 partition of the recorded game seed reserves 10% of
seeds for tuning and another 10% for validation. Every included game with that
seed is removed from training across all sources, including paired orientations
and repeated matchups. The original 1,000 reserved seeds remain separate.

- Tuning: 5,082 seeds, 12,266 completed games.
- Validation: 5,077 seeds, 12,190 completed games, 68,660 held-card opportunities.
- Both audit splits: 220,794 valid hands; 884 invalid hands contribute no counts.
- Human historical counts remain a small retained prior; human play was not
  separately validated here. All 15.x/16.x actor decisions remain excluded.

The candidate gives families 9, 13 and 20 their own rates while retaining other
families as a weak prior. For each category/ordinal:

`p_family = (declines_family + 0.5 + k*q_other_families) / (opportunities_family + 1 + k)`.

`q_other_families` is the smoothed rate from the other eligible cohorts; the
local family's observations are not counted twice. Strengths 0, 1, 10, 100,
1,000 and 10,000 are selected on equal-family-weighted tuning NLL, with the
validation split untouched during selection. This is a simple empirical-Bayes
partial-pooling candidate, not a fit of a full hierarchical posterior.

The selected strength was **10**, although 0, 1 and 10 were nearly tied. The
useful change is allowing the families to differ, not a confidently established
optimum at exactly 10.

| Held-out actor family | One pooled table | Family-specific, shared prior | Reduction in NLL |
| --- | ---: | ---: | ---: |
| 9.x | 0.1251531221 | 0.0958546572 | 23.4% |
| 13.x | 0.2652094184 | 0.2624427294 | 1.0% |
| 20.x | 0.3023693594 | 0.2938185616 | 2.8% |
| All, weighted by opportunities | 0.2312081488 | 0.2195348406 | 5.0% |

A 2,000-resample paired bootstrap over complete seed clusters places the
family-versus-pooled NLL difference at approximately -0.0129 to -0.0105
(95% percentile interval). This retains dependencies within a game, across
paired games, and between overlapping scoring categories sharing a seed.
Model-version-specific estimates improve pooled NLL by 5.3%, only slightly more
than the simpler family grouping.

This experiment uses the known actor family as a predictor. It does not show
that the engine can infer a human's playing style, and that feature is not
currently wired into the decline-factor runtime. A single generic table aimed
at 20.x instead improves 20.x predictions but worsens 9.x predictions; it is
3.0% worse over the complete audit population. There is no evidence here that
one modern-policy table is universally preferable for every opponent.

For the original diagnostic, the current-20 profile with strength 10 gives
NLL 0.3148972491, better than both old and refreshed pooled factors. This shows
an available improvement for that target population, not a universally optimal
replacement. The frozen legacy table is only a historical comparator: its
contaminated, partly unrecoverable training aggregate is not eligible for reuse.

## Extraction and category checks

The refreshed extractor and frozen scoring-category function agreed on all
**11,119 sampled valid hands**. This check uses identical decoded histories; it
tests category semantics rather than certifying every historical raw decoder.

The builder/runtime safe-category mismatch is real. Among 4,517 sampled held
pair/royal opportunities, the builder classified 1,068 as safe, the runtime's
public-information definition classified 1,019 as safe, and **49** were safe
only under the builder's definition (1.1% of opportunities, 4.6% of builder-safe
ones). No discrepancy went in the other direction. These differences arise
because the actor can know about private copies/discards that the forecaster
cannot observe. General pair/royal rows also include safe observations even
though runtime selects the specific safe factor instead of the general one.

Aligning the builder with runtime's available information and using mutually
exclusive categories should precede further fine tuning. This audit measures
the discrepancy; it does not claim a measured gain from correcting it.

## Recommended next change

Keep positive Bayesian smoothing. Preserve all approved historical raw evidence,
but stop treating every approved policy as the same behavioral population.
Use simple partial pooling: abundant observations determine the relevant
profile, while sparse cells borrow limited evidence from other profiles.
This follows the established distinction between complete and partial pooling
in [Stan's binary-trial case study](https://mc-stan.org/learn-stan/case-studies/pool-binary-trials.html).

Before installing a replacement:

1. Align the safe/general category definitions with runtime public information.
2. Choose the prediction target explicitly: known model profile, or a validated
   mixture/default for unknown humans. Retain old Ace evidence as shared prior
   information; eligibility alone should not determine its weight.
3. Calibrate on multiple seed-blocked matchups, report each cohort separately,
   and add held-out human play when enough attributable data is available.
4. Evaluate the *remaining-hand posterior* as well as this action-frequency
   loss, then run a playing-strength comparison. The current metric only scores
   accepted versus noncompeting declined opportunities when the candidate card
   was held; it does not validate absent-card likelihoods, repeated evidence,
   double counting with the hold asset, or resulting win probability.

No runtime asset or engine changes were made for this investigation.

## Reproduction and retained artifacts

Run from the Model 20.3 worktree:

```sh
scripts/run-quiet.sh 'Decline-factor audit' \
  python3 scripts/analyze_model203_decline_factors.py \
  --cache training/model203-decline-audit-counts.json.gz \
  --output training/model203-decline-audit.json
```

The 278 KB audit-count archive retains seed-cluster counts and the training
counts after subtraction, bound to the original evidence hash. The JSON report
retains tuning alternatives, validation results, uncertainty intervals, original
regression decomposition, and research family-profile factors. Deleting the
cache and supplying a new path re-extracts counts from the immutable source
paths recorded in the main evidence archive. The original calibration database
must be available to reproduce its separate diagnostic comparison.
