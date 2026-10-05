# Model 20 opponent-discard asset

`rust/cribbage-shadow-engine/assets/model20-opponent-discards.bin` consolidates
Model 20's conditional opponent-discard weights and same-suit evidence. The
runtime uses it for live hidden-world distributions and discard/live/review crib
suit forecasts. Historical Ace and other model inputs remain unchanged.

## Sources and evidence

- `training/model20-opponent-discard-evidence.json.gz`: retained raw conditional
  counts by model, role, keep and discard, plus source hashes and an import ledger.
  The original 30,000 games reproduce every weight in
  `model1322-opponent-discard-histograms.json` exactly. The September refresh adds
  16,418 completed games: 10,000 from 13.23 versus 13.215 and 6,418 from Model 20
  versus Ace. There are now 747,316 usable decisions (296,864 added).
  Runtime weights normalize the historical 9.x cohort and the quality cohort
  independently, then sum them. Original 13.x and new eligible decisions share
  the quality cohort, pooled by raw count. Weights are **not observation counts**.
- `empirical-discard-keep-14.8.bin`: same-suit rates for all 91 discard rank pairs
  in both roles, and aggregate fallback rates. Its unrelated keep frequencies
  are not imported.
- The original `web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json`
  at commit `4e8611ca69e41849df37c39da9790bdb43249439`: exact total and same-suit
  observation counts behind those rates. This source contains 211,303 included
  games and 2,079,994 usable discard/keep observations.

The packer verifies the original suit JSON against every installed 14.8 binary
count/rate and preserves the published eight-decimal rates exactly. Exact counts
are retained separately for later uncertainty estimation and learning. Combining
the containers does not combine or double-count their different source cohorts.
The embedded provenance records source SHA-256s, cohorts, and the historical
count-source revision. Missing conditional rows retain their existing role
fallback; unobserved cells in populated rows are still unsmoothed. The rank
section has changed with this refresh; the suit section remains identical.

All new decisions must satisfy [ADR-0002](adr/0002-exclude-defunct-models-from-learning-data.md).
The builder admits identified 13.x, 14.x and 20.x actors and rejects all 15.x,
16.x, Myrmidon and unidentified actors. Original 9.x evidence is retained only
through the verified historical baseline. Neither section of this asset contains
15.x or 16.x decisions. Archived datasets before the original corpus's latest
completion (2026-08-29T17:35:41Z) were not added by this refresh.

The unchanged equal-cohort blend does **not** give newer observations extra weight
or decay old evidence: historical 9.x retains half the mixture wherever both
cohorts have a keep row. Recency weighting is a separate policy decision, not an
effect obtained merely by adding more games.

## Coverage after the September refresh

| Measure | Before | After |
| --- | ---: | ---: |
| Games | 30,000 | 46,418 |
| Usable decisions | 450,452 | 747,316 |
| Observed legal keep/discard cells | 60,316 / 330,590 (18.24%) | 77,421 / 330,590 (23.42%) |
| Dealer keeps observed | 1,735 / 1,820 | 1,793 / 1,820 |
| Pone keeps observed | 1,796 / 1,820 | 1,814 / 1,820 |
| Role/keep rows with fewer than 30 observations, including missing | 1,401 | 814 |
| Cells with exactly one observation | 13,840 | 17,500 |

The higher singleton count reflects newly reached cells, not stronger estimates
for those cells. Only 22,498 legal cells have at least ten observations. Coverage
is improved but remains sparse; these are raw decision counts, not independent
sample counts. See the committed
[refresh audit](../training/model20-discard-import-20260925.json).

## Benchmark pairing and future imports

The frozen Model 20 snapshots contain exactly 3,209 completed games per
orientation. Both span indices 0 through 3,256 **with gaps**: using a single
high-water index would lose games. The evidence file retains every included
index under `sources[].includedGames`, together with run ID, matchup, engine
identities and database SHA-256. The audit lists equivalent inclusive index
ranges. Runs are `model20-13.23-left` and `model20-20.0-left`, matchup
`20.0-vs-13.23`, base seed `0x28960455`. Source commit:
`1925d15bb13a1c4ac8d39a7d87a6d89b7fc7aeed`.

The builder also retains hashes of game identities and game content. Reimporting
a later complete snapshot skips old games, adds completed gaps and later indices,
and rejects conflicting content under an existing game identity. A replay with
a different ID but identical seeds/models/deals/decisions is skipped as well.
There are 3,582 games left to import if this benchmark completes all 10,000;
this is relative to the frozen import, not a live progress report.

Paired orientations intentionally replay the same shuffled deals with policies
swapping seats. The five contributing benchmark groups have disjoint recorded
seed ranges, but an actual-deal audit found five consecutive hands shared by
one old 9-versus-13 game and one 13.23-versus-13.215 game. The runner uses a
32-bit LCG; distinct initial seeds do not guarantee disjoint later random states.
The audit records this overlap. Distinct policies' choices remain observations,
but confidence estimates should cluster on shared deals/seed streams, not treat
every choice as independent. The older 13.23 runner also explicitly reused the
13.215-versus-13.0 seed range; that other benchmark is not among this corpus's
five groups. New runs require fresh recorded seeds under the repository guidance.

Half-life decay addresses changing policy populations; duplicate imports should
instead be removed directly. Enlarging a corpus does not create independence
between replayed deals.

## Building broader coverage

Use an Ace discard-only generator to spend computation on the decision being
learned. A pilot should measure decisions per second and cell discovery before
choosing a long-run budget. Generate fresh suited six-card deals for both roles,
and sample board scores from the intended play population because Ace's choice
depends on board position. Preserve the generator version, seed, score context
and sampling probability. For a very large run, use independently derived random
streams with a larger state rather than extending the existing 32-bit stream.

Uniform random deals provide a clean distribution estimate. Target rare contexts
only with recorded sampling probabilities and appropriate weighting; naïvely
oversampling them changes the conditional frequencies. Enumerating all 20,358,520
suited six-card deals is finite, but does not enumerate every board context.

Even an unlimited deterministic Ace run will not choose every legal keep/discard
combination. Full probability support therefore needs a separate smoothed
estimate, backing sparse rows toward a physically legal role-level prior. Treat
that as prior uncertainty, never fabricated Ace observations. More samples and
smoothing solve different problems. Fresh held-out seeds are needed to evaluate
the changed asset; the current benchmark's frozen source remains unchanged and
its imported games now belong to training evidence.

## Regeneration

```sh
python3 scripts/pack_model20_opponent_discards.py
python3 scripts/pack_model20_opponent_discards.py --check
```

The historical suit-count source is read from Git history. For shallow archives, supply
that original JSON through `--suit-source PATH`. No Git history or legacy discard
files are required to load the compiled asset in Model 20.

To append evidence, first create consistent SQLite backups of live databases,
then run:

```sh
python3 scripts/build_model20_discard_evidence.py \
  --database /path/to/complete-13.23-left-snapshot.db \
  --database /path/to/complete-20.0-left-snapshot.db \
  --report /path/to/new-import-report.json
python3 scripts/pack_model20_opponent_discards.py
```

The compressed evidence is a build input and audit ledger, not an additional
runtime asset. Baseline recovery accepts only the six original database hashes
and verifies that their recovered counts reproduce the original rank weights.

## Binary format, version 1

All numbers use little-endian encoding. The 64-byte header contains:

1. Eight-byte magic `M20D0001`.
2. Six `u32` fields: version (1), provenance JSON length, role count (2), keep
   count (1,820), discard-pair count (91), payload byte length.
3. SHA-256 of the complete payload (32 bytes).

The payload starts with compact UTF-8 provenance JSON. It then contains one
section for dealer followed by pone. Each role section contains:

1. Two `f64` fallback rates: all discards, then distinct-rank discards.
2. 91 suit records: `u64` observation count, `u64` same-suit count, `f64` rate.
3. One fallback discard-weight row, followed by 1,820 conditional keep rows.

Keep and discard IDs follow lexicographically sorted thirteen-digit rank-count
keys, with ranks A through K. A weight row is a `u16` entry count followed by
`(u8 discard ID, u64 weight)` entries in increasing ID order. Zero entries in a
conditional row mean use the role fallback. Suit records appear once per rank
pair/role, independent of keep and cut.

The reader checks format dimensions, lengths, checksum, probabilities, count
consistency, sorted unique IDs, positive weights, and physical keep/discard
compatibility. It builds the same runtime discard vectors as the original
JSON loader. Suit lookup uses the rank-pair index instead of scanning 91 rows.

## Validation and size

The enriched binary is 716,328 bytes. The legacy JSON and 14.8 binary total
2,318,813 bytes: the Model 20 discard input is approximately 69% smaller despite
holding more conditional cells. This improves
startup parsing and transient allocation; these assets are cached, so it does
not imply a comparable improvement in per-move search time.

A local release-mode run on 2026-09-25, before enrichment, measured median load times of 13.130 ms
for the legacy pair and 2.023 ms for the packed asset (6.49 times faster). This
is a 20-repetition, alternating-order measurement with warm filesystem caches,
not a whole-game benchmark or a measurement of the enriched file.

Tests compare every packed rank weight against the retained count evidence,
and all 182 suit rates/counts and aggregate rates against the historical inputs.
They also load Model 20 with both legacy discard files absent, check that live
Model 20 does not initialize the 14.8 table, and reject damaged binary files.
The packer's `--check` verifies byte-for-byte reproducibility.

Enrichment exposed a hand-cache dependency on the discard asset: conditioned
discard variants contain weights, not just card support. The cache now includes
the asset fingerprint in its identity. The integration test switches from Ace
to Model 20 and back, requiring exact agreement with uncached evaluations and
selected-move review.

For a local paired release-mode loading measurement, run:

```sh
scripts/run-quiet.sh --show-warnings "Model 20 asset loading" \
  cargo test --manifest-path rust/Cargo.toml -p cribbage-shadow-engine --lib \
  --release model20_discard_asset_load_timing -- --ignored --nocapture
```

The test alternates loading order, discards two warm-up rounds, and records 20
measurements per representation in the system temporary directory as
`model20-discard-asset-load-timing.json`. It measures loading with filesystem
caches warmed, including validation and runtime structures, excluding drops.
