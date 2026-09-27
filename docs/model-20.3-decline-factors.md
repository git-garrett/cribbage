# Model 20.3: qualified, smoothed scoring-decline evidence

Model 20.3 loads `model203-decline-factors.json`, now restricted to verified
strategic pegging policies. The broad-cohort candidate that mixed 9.x into the
same rates has been replaced. Other 20.3 assets, the frozen 20.0–20.2 versions,
and the running 20.2-versus-20.0 benchmark are unchanged by this revision.
`model1323-corrections.bin` has not been rebuilt.

The runtime JSON is **795 bytes**, containing seven categories by three opponent
card ordinals. Gameplay uses 21 indexed `u32` values (84 bytes); no JSON is parsed
inside the decision loop. Its SHA-256 is
`e17ec347f76a7671f460fe95ef18d5e9a693a80320588866357362dbe8e5c0c0`.
The loader verifies that checksum and positive probabilities; hand-cache asset
fingerprints include the factors.

## Training selection and provenance

[ADR-0003](adr/0003-qualify-decline-data-by-pegging-policy.md) records the rule:
qualify the actual live pegging policy, rather than historical overall strength
or a model-number cutoff. The current evidence contains:

| Actor version | Held-card opportunities |
| --- | ---: |
| 13.0 | 157,754 |
| 13.1, corrected sources only | 27,930 |
| 13.215 | 23,087 |
| 13.23 | 43,342 |
| 20.0 | 62,059 |
| 20.1 | 19,722 |
| 20.2 | 21,924 |
| Total | **355,818** |

These came from **64,131 distinct completed games and 579,771 valid hands**.
There were 1,836,411 accepted/held-decline/absent-decline candidate observations;
1,254 invalid hands contributed no observations. General/safe categories overlap,
so these counts are not independent trials.

Excluded: all 9.x and 13.22 policies; 15.x/16.x as required by ADR-0002; the 13.1
actor in the first mixed-policy benchmark; both sides of the obsolete pre-cut
lead run; unknown policies; and the 267-opportunity unclassified human aggregate.
Eligible actors against excluded opponents remain usable.

`training/model203-decline-qualified-evidence.json.gz` retains raw counts by
source and actor model, source hashes, exact included game IDs/indices/seeds,
identity/content hashes for duplicate detection, and the selection policy.
Per-source counts must reproduce the aggregate. New source hashes require policy
provenance review before registration in
`training/model203-decline-source-policies.json`.

All **11,159 reserved seeds** are excluded from fitting in every source and
paired orientation: the original 1,000 calibration seeds plus the prior broad
audit's tuning and validation seeds. They are saved in
`training/model203-decline-reserved-seeds.json`.

No new snapshot of the active benchmark was taken. The previously frozen
20.0-left/20.2-left snapshots contain 3,603/3,608 completed games; qualified
training retains only games passing the new seed and actor filters, with exact
identities in its ledger. A future refresh can incorporate additional completed
games without recounting earlier ones.

The old broad archive `model203-decline-evidence.json.gz`, broad factors and
calibration report, and the [original smoothing audit](research/model203-decline-smoothing-audit.md)
remain historical records. None of the excluded observations contribute to the
qualified asset, including as a shared prior.

## Smoothing

For each category/ordinal, let `d` be held-card declines and `a` accepted scoring
opportunities. The base prior remains Beta(0.5, 0.5). The existing calibration
compares additional category-pooling strengths 0, 1, 10, 100, 1,000 and 10,000
using the original 500 tuning games. It selects strength **1**, giving:

`p = (d + 0.5 + q) / (a + d + 2)`

where `q` is the category-wide Beta-smoothed rate. Strength 0 and 1 are nearly
indistinguishable; the meaningful change is data qualification. Empty ordinal
cells use `q`; the empty first-card run/royal/four-kind cells are structurally
unreachable. Rates are rounded to ppm and bounded strictly between zero and one.
The runtime keeps soft likelihoods positive while retaining exact go exclusions.

The new four-kind evidence contains one decline in 968 second-card opportunities
and two in 223 third-card opportunities. Sparse evidence therefore remains
informative without implying impossibility.

## Prediction assessment

Lower negative log likelihood (NLL) is better. Factors are compared on identical
positions. Tuning selects the smoothing parameter; the validation splits are not
used for that selection.

| Held-out decline event population | Historical, floored | Broad 20.3 candidate | Qualified 20.3 |
| --- | ---: | ---: | ---: |
| Original 500 games, 3,722 opportunities | 0.3172954111 | 0.3261846065 | **0.3152737844** |
| Broader qualified 13.x, 30,790 opportunities | 0.2696356385 | 0.2732303891 | **0.2694499716** |
| Broader 20.x, 13,201 opportunities | 0.2977284250 | 0.3020725668 | **0.2950092903** |
| Broader combined, 43,991 opportunities | 0.2780658373 | 0.2818854683 | **0.2771199170** |

The original 2.8% regression is removed: the new original-split loss is 3.34%
better than the broad candidate and 0.64% better than the historical factors.
Seed-cluster bootstrap intervals support improvement overall; the broader 13.x
change versus historical factors is small and its interval includes zero.

A release-mode diagnostic also calls the **actual Model 20.3 posterior path** on
77,115 legal held-out observations. It changes only the decline factors; all
other assets and runtime rules, including known-card depletion, go exclusions,
soft-support flooring, and decision-local policy construction, remain identical.
Truth is the actual remaining opponent rank multiset, used only for scoring the
prediction, never as an inference input.

| Actual remaining-hand prediction | Positions | Historical factors | Broad candidate | Qualified |
| --- | ---: | ---: | ---: | ---: |
| Original validation games | 31,420 | 3.5855375043 | 3.5897290891 | **3.5843670122** |
| Additional 13.x positions | 32,155 | 3.5566862083 | 3.5609962081 | **3.5556284026** |
| Additional 20.x positions | 13,540 | 3.5868083870 | 3.5910405364 | **3.5848548414** |
| Additional combined | 45,695 | 3.5656117866 | 3.5698987184 | **3.5642885620** |

Multiclass Brier scores also improve in every listed population. No actual hand
was assigned zero probability by any factor variant under the 20.3 runtime.
For qualified minus historical posterior NLL, paired seed-bootstrap 95%
intervals are [-0.001553, -0.000813] on the original set and
[-0.001669, -0.000993] on the additional set. These are small inference gains.
The additional posterior sample selects one eighth of broad-audit validation
seeds by a fixed hash, retaining paired/matchup observations within each seed.

The full metrics, intervals, checksums and scope are retained in
`training/model203-decline-qualified-assessment.json`. The broader seeds are
excluded from decline fitting, but were not excluded from every unchanged
historical asset; this is a controlled decline-factor ablation, not an entirely
new end-to-end model test. The historical comparator also retains its original
training provenance. These results establish no observed regression in the
measured inference checks. **They do not establish a non-regression in win rate.**
No new strength benchmark was launched or existing benchmark interrupted.

## Runtime work and remaining limitations

The earlier performance changes remain: allocation-free scoring-completion
recognition, immutable-factor validation at policy construction, and a bounded,
decision-local cache of likelihood arrays keyed by public history and cut.
The previous timing experiment found a 1.55× kernel speedup but essentially no
change in full forecast time. This dataset change adds no decision-time work.

The builder/runtime safe-category mismatch, overlapping safe/general categories,
competing-score conditioning approximation, correlated decline evidence, and
pooled roles/board positions are unchanged. This isolates the authorized dataset
restriction; it does not claim those modeling limitations are resolved.

## Reproduction

Verify the installed asset against its retained counts and calibration split:

```sh
scripts/run-quiet.sh 'Qualified decline asset reproduction' \
  python3 scripts/build_model203_decline_factors.py --check \
  --calibration-database /path/to/13.23-left/games.db
```

For later ingestion, register reviewed snapshot hashes, preserve the qualified
raw archive, and build to candidate paths with `--evidence`, `--output`,
`--calibration-output`, and `--sources`. Do not feed the broad archive into the
qualified builder: schema/policy validation rejects it.

`assess_model203_decline_qualification.py` extracts held-out decline counts and
legal posterior fixtures from the archived source ledger. The ignored Rust test
`model203_decline_posterior_assessment` reads `DECLINE_ASSESSMENT_CASES`, the JSON
array `DECLINE_ASSESSMENT_FACTORS`, and `DECLINE_ASSESSMENT_OUTPUT`. It compares
historical/broad/qualified factors through the production posterior. Pass its
output back to the Python script using `--posteriors` and `--check` to assert no
aggregate decline or posterior NLL regression on either validation population.
The frozen build and diagnostic files are under
`/private/tmp/model203-decline-qualified-20260927-v1/`.
