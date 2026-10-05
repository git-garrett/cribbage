# Model 20.3: indexed and smoothed crib forecasts

`model203-crib.bin` replaces Model 20.3's runtime dependencies on
`crib-score-histogram-by-discard-cut.json` and
`crib-rank-score-by-discard-cut.json`. Discard recommendations, decision reviews
and the live pegging win evaluator use the new asset. Older versions retain
both historical inputs and their original probabilities. The active 20.2 versus
20.0 benchmark and its frozen code/assets were not modified.

The binary is 111,961 bytes, versus 12,107,900 bytes for the histogram JSON:
99.08% smaller. Its SHA-256 is
`864497acca78bd9d79a7a9784799c3aaf4777fbbd4191c1761b3ebaf39120cb7`.
The metadata and evidence checksums live in `model203-crib.provenance.json`.

## Evidence and smoothing

The builder recovers the original 717,352 raw observations exactly once from
verified historical contributor weights. Repeated copies across discard/cut
cells are not counted as additional evidence. That baseline reports 135,679
selected games from Models 7.0, 8.0, 9.0 and 10.0; its historical game count is
not an independently reconstructed count of games contributing valid discards.

The refresh adds 1,725,597 valid actor discards from 121,386 completed,
reproducible games. Counts by actor version are:

| Version | New discards |
| --- | ---: |
| 9.0 | 265,535 |
| 9.1 | 183,116 |
| 9.11 | 90,358 |
| 13.0 | 481,181 |
| 13.1 | 196,025 |
| 13.215 | 72,273 |
| 13.23 | 133,438 |
| 20.0 | 182,418 |
| 20.1 | 60,033 |
| 20.2 | 61,220 |

The explicit strong-policy allowlist is shared with the hold refresh. It
includes historical Ace/approved strong versions, rather than requiring every
source to match current Ace strength. All 15.x/16.x actors, unrecognized aliases,
Myrmidon and unidentified actors are excluded. Approved actors playing against
excluded opponents can contribute their own discards. Invalid or incomplete
six-card deals/four-card keeps do not become labels. Compact database card IDs
are rank-major (`rank = id / 4`); native runtime card IDs are suit-major.

Evidence now totals 1,221,902 dealer and 1,221,047 pone discards. All 91 rank
pairs have observations in each role. The rarest pone category, 5-5, rises from
67 to 289 observations; the least observed dealer category has 3,687.

`training/model203-crib-evidence.json.gz` retains the immutable historical
baseline, new counts by actor version, database hashes, game identities,
content fingerprints, game IDs/indices/seeds and import decisions. Both exact
identity and content fingerprints prevent duplicate imports and renamed
replays. Conflicting completed records fail the import. Games ending on or
before the original asset's cutoff are conservatively excluded from additions,
since the historical aggregate lacks individual game IDs.

The current benchmark was read using immutable SQLite backups. This refresh
includes 3,390 completed games from its 20.0-left orientation and 3,396 from
20.2-left, with the exact indices in the evidence ledger. Later snapshots can
add missing or newly completed games without counting these again. The original
20.0-versus-Ace archive contributes its recorded 3,377 games per orientation.

For each discarding actor role, the stored probabilities are

`p(pair) = (count(pair) + strength * physical_prior(pair)) / (N + strength)`.

The physical prior assigns 6/1326 to each same-rank pair and 16/1326 to each
pair of distinct ranks. This gives every physically possible category positive
support without inventing observations. Raw counts and posterior probabilities
are stored separately. More evidence reduces the relative influence of the
prior. No recency decay is applied; historical evidence remains available.

Strengths are 1,000 for dealer and 10,000 for pone. They were selected from a
positive grid using 500 reserved 13.23-versus-13.215 games, then evaluated on a
separate 500. All 1,000 seeds are excluded from new imports in both orientations
and other runs. Validation negative log likelihood (lower is better):

| Role | Raw | Smoothed |
| --- | ---: | ---: |
| Dealer | 4.318530 | 4.318534 |
| Pone | 4.207069 | 4.206837 |

Dealer validation is effectively unchanged and slightly worse; pone improves
slightly. These measure marginal discard prediction, not playing strength.
Historical aggregates have no seed ledger, and repeated deals/policies create
correlation, so raw observation counts are not independent effective samples.
The calibration report is `training/model203-crib-calibration.json`.

## Runtime and binary layout

The little-endian header has magic `M203CR01`, six u32 fields (version 1,
roles 2, pairs 91, ranks 13, metadata length, payload length), and a SHA-256
checksum of the payload. The payload contains canonical JSON metadata, 182
`(u64 raw_count, f64 probability)` records, and 107,653 score bytes. Pairs use
lexicographic 13-digit rank-count order; scores are indexed as
`(own_pair * 13 + cut_rank) * 91 + opponent_pair`. Value 255 marks the 13
impossible five-of-one-rank combinations. All 107,640 legal combinations have
exact rank scores, independent of empirical data and actor role.

The engine keeps indexed arrays in memory. It uses per-rank suit bitmasks and
a fixed 30-score accumulator to enumerate legal physical opponent pairs and
add exact flush/right-jack bonuses. It avoids string-keyed histogram lookups,
repeated rank-count expansion and candidate-card vector allocations. The
loader checks dimensions, checksum, provenance version, finite normalized
positive probabilities, raw-count totals and impossible-score support.

Model 20.3 now constructs its suited crib forecast once during pegging. The
old preliminary unsuited forecast is no longer computed and overwritten.

This change preserves the existing partial-depletion and suit-group weighting
semantics, apart from the explicitly refreshed/smoothed rank prior. The earlier
assessment's recommendation to progressively reweight rank/suit mass for known
card availability remains separate work. The crib forecast also still uses a
role-marginal discard prior; joint conditioning on the opponent keep and
hand/crib score correlation are not introduced here. The existing consolidated
asset remains the source of empirical suit rates.

An optimized foreground microbenchmark, alternating the old and indexed paths
across six samples of 80 forecasts, measured 13.084 ms for
the old evaluator and 0.159 ms for the new one per sample
(82.5× faster for this crib-forecast calculation). This is a local
component measurement with assets already loaded, not a full-game or
playing-strength benchmark. The timing test is retained as
`model203_crib_timing`; actual match throughput also depends on pegging search
and WP aggregation.

## Verification and future refreshes

The Rust checks independently score every legal rank combination and compare
160 indexed forecasts against the original evaluator with identical priors,
including both roles, known-card exclusions and empirical/uniform suit modes.
A runtime test loads 20.3 with neither crib JSON present. Importer checks cover
raw-count recovery, sparse/unseen smoothing, actor eligibility, overlap,
reserved seeds, duplicate/conflicting games, invalid cards and exact binary
reproduction. The full Rust suite passed 389 tests across 21 targets.

Reproduce the current asset:

```sh
python3 scripts/build_model203_crib.py --check
```

For a refresh, copy the evidence to a candidate path and pass `--sources` with
a JSON array of immutable database paths. Use the same
`--calibration-database` recorded in the current calibration file, plus explicit
candidate `--evidence`, `--output`, and `--calibration` paths. Imports checkpoint
after each database. Use the one-shot supervisor for a long build. Preserve
frozen benchmark inputs and validate a new candidate before deploying it.
