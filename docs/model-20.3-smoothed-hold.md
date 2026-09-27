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

Model 20.3 also drops the runtime dependency on
`crib-rank-score-by-discard-cut.json`. Its fallback rank means are derived from
the existing `crib-score-histogram-by-discard-cut.json` contributors, preserving
all 2,366 historical values exactly at their original five-decimal precision.
Discard recommendations, decision reviews, and live pegging use this
histogram-only loader. The crib probabilities and fallback scoring behavior are
unchanged; this removes a redundant input, not the separate conditioning
weaknesses identified in the crib forecast. Older models, including 20.2, retain
the original loader and file. Frozen benchmark copies are unaffected.

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
If all empirical discard variants for a keep disappear after conditioning,
20.3 uses legal physical discard pairs for that keep rather than deleting it.
Nonempty discard rows are otherwise unchanged.

The file uses magic `M203HB01`, followed by the 28-byte header, 22-byte context
directory records, and 21-byte remaining-hand/weight records used by the native
belief machinery. Rank counts are stored directly, so no historical dictionary
holes or shifting IDs remain. Positive probabilities are quantized at scale
10^15 with a positive floor; the maximum measured error is recorded in its JSON
provenance. Packed weights are never used as raw evidence counts. The engine
pins the asset SHA-256, validates all legal support, and includes its identity
in hand-cache invalidation.

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
20.0 run contributes 3,332 and 3,292 games respectively. The current 20.2 benchmark
was not imported or changed.

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
change does not implement their full joint outcome distribution. The existing
decline-factor calibration and nonempty conditional-discard rows are also
unchanged; their broader refreshes remain separate asset work.
