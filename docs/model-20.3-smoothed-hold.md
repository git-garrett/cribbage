# Model 20.3: complete, smoothed opponent-hand beliefs

Model `schell_table-peg_table-20.3` extends 20.2 with one shared opponent-hand
distribution for live pegging, continuation choices, and subsequent hand-score
forecasts. It also supplies the opening keep prior used by discard-time show
forecasts. It retains 20.2's corrected board matrix, WP continuation objective,
and original `model1323-corrections.bin`; the EV correction asset was not rebuilt.
Production Ace and Models 20.0–20.2 remain frozen.

## Asset and probability semantics

`rust/cribbage-shadow-engine/assets/model203-hold.bin` replaces this version's
runtime dependencies on `model13-hold.bin`, `model91-pegging-beliefs.bin`, and
`model132-keep-prior.json`. Historical versions retain their original files.
The new file has 1,120 role/prefix contexts, 43,862 remaining-hand records,
and 945,770 bytes. All 1,820 four-card rank patterns have positive opening
probability for each role, including the eight absent from the old dictionary.
Every conditional row includes every physically possible remaining rank hand.

Model 20.3 also replaces both historical crib JSON inputs with
`model203-crib.bin`: indexed exact rank scores, refreshed empirical discard
frequencies and calibrated smoothing. The live pegging evaluator constructs its
suited crib forecast once. See [the crib asset description](model-20.3-crib.md)
for evidence, format, validation and remaining conditioning limitations.
Older models, including 20.2, retain the original JSON loader and files.

For role/prefix context c and remaining hand h, the builder uses

`p(h|c) = (observed_count(h,c) + strength[c] * backoff(h,c)) / (N[c] + strength[c])`.

The opening backoff uses the frozen 13.2 keep-prior mixture as a distribution,
not as billions of observations. A 0.001 physical-deal mixture supplies support
for keeps absent even from that prior. Opening observations then update it.
For later prefixes, the backoff conditions this smoothed opening distribution
on the exposed rank multiset, using the probability of drawing that multiset
from each keep under uninformative play order. Empirical conditional rows add
the historical evidence about actual card selection. No simulated future moves
or guessed hidden cards are imported as observations.

The calibrated strengths for prefix lengths 0, 1, 2, 3 are respectively
100,000; 1,000,000; 100,000; and 10,000. These are interpolation parameters,
not claims of that many independent prior observations. The broad prior is
useful because the conditional rows pool different historical policies. The
0.001 physical mixture is a structural support choice, not a tuned parameter.

Runtime applies physical card depletion relative to the deck *after the
observed prefix*, then go exclusions and the existing behavioral likelihoods.
Empirical soft zeros and integer underflow are floored at one part per million
for this version only; a hard exclusion from go remains zero. The same updated
remaining-hand distribution feeds the exact suit-enumerated counting histogram.
The subsequent conditional-discard refresh supplies positive probability for
every physically possible discard pair within every keep. Conditioning therefore
retains compatible keeps without depending on observed discard support; see
[opponent discards](model-20.3-opponent-discards.md).

The file uses magic `M203HB01`, followed by the 28-byte header, 22-byte context
directory records, and 21-byte remaining-hand/weight records used by the native
belief machinery. Rank counts are stored directly, so no historical dictionary
holes or shifting IDs remain. Positive probabilities are quantized at scale
10^15 with a positive floor; the maximum measured error is recorded in its JSON
provenance. Packed weights are never used as raw evidence counts. The engine
pins the asset SHA-256, validates all legal support, and includes its identity
in hand-cache invalidation.

## Runtime cost

Loaded belief rows are shared through an immutable reference-counted allocation;
creating a decision policy no longer clones the complete table. A dense array
indexes the 1,120 role/prefix contexts, and borrowed row iterators apply
availability, depletion and behavioral weights without intermediate hand vectors.
Missing rows remain distinct from populated rows with no compatible hands, so
the historical fallback rules are preserved.

Model 20.3 computes the current opponent posterior once per live recommendation
or saved-position review and borrows it for both pegging worlds and counting
forecasts. The prepared decision is tied to that observation; future simulated
observations still calculate their own posteriors. Solve memoization remains
decision-local. No asset weights, arithmetic order or smoothing strengths change.

Differential checks compare every packed row in both belief assets, including
availability filtering, and compare world order/weights through a complete hand.
They also check exact late forecast bins, counting histograms, WP values and
selected actions against the separate-posterior path. These are behavioral
equivalence checks, not an estimate of overall gameplay speedup.

Model 20.3 also precomputes all 23,660 four-card rank-pattern/cut-rank scores
once per process (23,660 score bytes). Discard-time opponent-hand forecasts and
live pegging-time counting forecasts reuse these exact scores. Card depletion,
flushes and nobs still use the actual available cards and suits. Exhaustive
rank-score comparisons and complete histogram comparisons preserve the previous
scoring results. This cache stores scores, not policies or observations.

A local release measurement across four six-card deals and eight alternating
repetitions reduced this discard-time forecast stage from 17.2 to 10.4 ms per
decision (39%). The cache was warm. This excludes the rest of discard evaluation
and does not measure whole-game speed. Fixtures and individual measurements are
in `training/model203-hand-score-timing.json`.

## Evidence and eligibility

The historical hold JSON was recovered at `58e44d4^` and verified by SHA-256
`19beb2b634ff53c889f59bedb67bb0f349a849bdabc868d89032dd305dc0c805`.
It describes 170,905 games from Models 7.0, 8.0, 9.0, 10.0, 11.0, 11.1 and
12.0. Its valid raw counts are retained. Wrong-size remaining hands and impossible
prefix/hand combinations are excluded; exclusion totals remain in provenance.

The initial refresh adds 82,922 completed games and 1,214,718 valid actor hands:

| Model | Added actor hands |
| --- | ---: |
| 9.0 | 88,496 |
| 9.1 | 183,116 |
| 9.11 | 90,358 |
| 13.0 | 375,481 |
| 13.1 | 90,325 |
| 13.215 | 72,273 |
| 13.23 | 133,438 |
| 20.0 | 121,198 |
| 20.1 | 60,033 |

An actor hand can contribute an opening observation and up to three later
prefix observations, only when those plays actually occurred. Neither those
visits nor paired benchmark orientations are independent new games.

Per the user's broadened eligibility instruction, the importer accepts the
explicit historical strong-policy versions enumerated in `STRONG_VERSIONS`,
including former Ace cohorts and the approved 13.x/14.x/20.x families. It does
not require them to match today's Ace strength. All 15.x and 16.x versions,
Myrmidon, aliases, and unknown models are excluded. Identified human observations
are accepted separately. Eligibility is actor-specific: playing *against* a
weaker or excluded model does not discard the approved actor's observations.
New unlisted model versions require an explicit eligibility update.

`training/model203-hold-evidence.json.gz` preserves the historical aggregate,
new raw counts by model, source hashes, imported game IDs/indices/seeds, and
identity/content deduplication hashes. Game identity includes both actor versions
because some historical experiments reused run/game IDs after changing models. The retained Model 20 versus Ace inputs
include 3,377 games per orientation (the original 3,209 plus 168 later games),
with their exact indices recorded;
later snapshots can add completed gaps and later games. The stopped 20.1 versus
20.0 run contributes 3,332 and 3,292 games respectively. The initial hold refresh
did not import the 20.2 benchmark. The September 27 refresh below imports
completed games from read-only snapshots without changing that benchmark.

## Calibration and checks

One thousand seeds from the completed 13.23 versus 13.215 benchmark are reserved
from ingestion in both orientations. Left-orientation games 0–499 select a
strength from 10, 100, 1,000, 10,000, 100,000, 1,000,000 and 10,000,000;
games 500–999 validate it. Opening strength is selected first, then conditional
strengths. Each game and source fingerprint is in
`training/model203-hold-calibration.json`.

On the 500 validation games, smoothing removes all nine zero-probability later
prefix observations remaining in the enriched raw table. Average negative log
likelihood improves over strength-100 smoothing at every prefix length:

| Opponent cards played | Strength 100 | Calibrated |
| --- | ---: | ---: |
| 0 | 6.822955 | 6.821040 |
| 1 | 5.515038 | 5.348115 |
| 2 | 3.990183 | 3.888899 |
| 3 | 2.141625 | 2.105802 |

These measure held-out hand prediction, not playing strength. Shared deals and
policy correlations prevent treating all visits as independent samples. The
reserved seeds are excluded from new imports; the inherited aggregate sources
cannot be filtered by individual seed, so this is not a fully independent
end-to-end strength evaluation.

## September 27 evidence refresh and weighting assessment

The installed asset adds another **39,074 completed games** and **521,967 actor
hands**, bringing the incremental ledger to 121,996 games and the complete
opening evidence to 4,660,710 observations. The 170,905-game historical aggregate
is retained separately. These totals count observations, not independent deals.
The binary remains 945,770 bytes with all 1,820 opening keeps supported per role.
Its SHA-256 is
`192d43b7712e1f16bf0ba0991df14aaf646c2a44cd43f7e917d6ac8689cc375e`.

The 20.0-left and 20.2-left snapshots contain 4,464 and 4,474 completed games.
Indices 0–999 in both orientations are reserved; the remaining 3,464 and 3,474
games are ingested, including 62,683 Model 20.2 actor hands. The evidence ledger
records exact included game identities, indices, seeds and source fingerprints
so later imports can add the remainder without duplicating these games. All
newly ingested games have their source's reproducibility flag set.

The reserved set now contains 2,000 distinct deal seeds: 1,000 from 13.23 versus
13.215 and 1,000 from 20.2 versus 20.0. In each family, indices 0–499 in both
orientations select weighting and 500–999 test it. No reserved seed appears in
the incremental training ledger. Historical aggregates still cannot be checked
per seed. Human opening keeps are split by game into 1,215 training, 453 tuning
and 500 test observations; test observations span 55 games. For human comparisons,
both priors exclude tuning and test human games, avoiding in-sample advantages.

`scripts/assess_model203_hold_refresh.py` compares older-model evidence weights
1, 0.5, 0.25 and 0.1, and human prior weights 1, 0.5, 0.1 and 0 relative to each
model prior cohort. Raw counts are preserved. The tuning winner uses older-model
weight 0.1 and human prior weight 0, but is **not adopted**: its human test NLL
change is −0.00317 with a paired 95% interval of [−0.02677, +0.02000], and its
human Brier score is slightly worse. Model improvements alone do not satisfy
the requirement for a clear win. Existing cohort weights, smoothing strengths
and physical support remain unchanged.

The accepted data-only refresh improves held-out role/prefix prediction:

| Test population | Observations | NLL change | Paired 95% interval |
| --- | ---: | ---: | --- |
| 13.x | 71,900 | −0.00809 | [−0.00868, −0.00755] |
| 20.x | 72,069 | −0.01004 | [−0.01074, −0.00942] |
| Human opening keeps | 500 | −0.00082 | [−0.00334, +0.00153] |

Negative changes are improvements. Intervals resample paired deal seeds for
models and whole games for humans; individual prefix visits are not treated as
independent. Model Brier scores also improve. Human results remain inconclusive.
These are unconditioned role/prefix predictions, not full live posteriors or a
claim of improved win rate. The asset does not yet distinguish opponent identity
or board position.

Audit records are `training/model203-hold-refresh-assessment.json`,
`training/model203-hold-refresh-cases.json.gz`, and
`training/model203-hold-prior-cohorts.json`. The configuration records the
assessment checksum. The assessment's original/refreshed human metric rows are
in-sample; use its fair human comparisons when evaluating generalization.

## Updating the evidence

Reproduce the installed snapshot without changing it:

```sh
python3 scripts/build_model203_hold.py --check
```

To add data, use an immutable SQLite backup of completed games with actual
keeps and either legacy `peg_sequence` blobs or native `compact_peg_plays` rows.
Preserve the old evidence file and create a candidate copy, then run:

```sh
python3 scripts/build_model203_hold.py \
  --evidence /private/tmp/next-hold-evidence.json.gz \
  --database /path/to/completed-games.db \
  --output /private/tmp/next-hold.bin
```

The importer skips known games, catches replays under changed IDs, rejects
conflicting completed records, excludes the historical overlap and reserved
validation seeds, and checks source immutability. Unknown or incomplete hidden
hands do not become labels. Keep the source databases in the durable archive.

No recency decay is applied in 20.3: old and new raw observations accumulate
once. Recency weights can later be derived from retained archives without
deleting the evidence. Validate a future candidate and assign a new model
version/checksum before use; never overwrite a frozen benchmark's inputs.

The counting histogram still marginalizes counting and pegging outcomes
separately, and assumes uniform legal suits within each rank pattern. This
change does not implement their full joint outcome distribution. A subsequent
20.3 refresh completes and smooths the conditional-discard rows; see
[opponent discards](model-20.3-opponent-discards.md). Another 20.3 refresh replaces
the inherited decline factors with clean, smoothed evidence and optimizes the
runtime likelihood calculation; see [decline factors](model-20.3-decline-factors.md)
for the priors, validation results and remaining modeling limitations.
