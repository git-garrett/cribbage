# Model 20 opponent-discard asset

`rust/cribbage-shadow-engine/assets/model20-opponent-discards.bin` consolidates
Model 20's conditional opponent-discard weights and same-suit evidence. The
runtime uses it for live hidden-world distributions and discard/live/review crib
suit forecasts. Historical Ace and other model inputs remain unchanged.

## Sources and evidence

- `model1322-opponent-discard-histograms.json`: role/keep-conditioned rank-pair
  weights and role-level fallback distributions. These are normalized Model 9.x
  and Model 13.x mixture weights, **not observation counts**.
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
fallback; unobserved cells are not smoothed by this storage-only change.

## Regeneration

```sh
python3 scripts/pack_model20_opponent_discards.py
python3 scripts/pack_model20_opponent_discards.py --check
```

The default count source is read from Git history. For shallow archives, supply
that original JSON through `--suit-source PATH`. No Git history or legacy discard
files are required to load the compiled asset in Model 20.

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

The binary is 560,630 bytes. The legacy JSON and 14.8 binary total 2,318,813
bytes: the Model 20 discard input is approximately 76% smaller. This improves
startup parsing and transient allocation; these assets are cached, so it does
not imply a comparable improvement in per-move search time.

A local release-mode run on 2026-09-25 measured median load times of 13.130 ms
for the legacy pair and 2.023 ms for the packed asset (6.49 times faster). This
is a 20-repetition, alternating-order measurement with warm filesystem caches,
not a whole-game benchmark. `npm test` passed 363 tests across 19 targets.

Tests compare all 3,640 loaded role/keep distributions, every weight and ordering,
all 182 suit rates/counts, and aggregate rates against the historical inputs.
They also load Model 20 with both legacy discard files absent, check that live
Model 20 does not initialize the 14.8 table, and reject damaged binary files.
The packer's `--check` verifies byte-for-byte reproducibility.

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
