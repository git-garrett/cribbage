# Model 20.3 suited-discard evidence

Model 20.3 now uses updated same-suit probabilities in the suited section of
`model203-opponent-discards.bin`. These estimate whether the opponent's two
thrown cards share a suit, conditional on their rank pair and dealer/pone role.
The crib forecast enumerates the available suit assignments and scores flushes
and nobs exactly. This update changes those probabilities; it does not replace
exact crib scoring with a fixed flush bonus.

The conditional rank-discard payload is unchanged byte for byte (SHA-256
`8d093c480061c74fc06934569ebdc9b2d9dab8de76753c9795bf5cc6f4081c39`).
The original Model 20.0–20.2 asset remains frozen. Model 20.3's new complete
binary is 2,656,126 bytes, SHA-256
`efd7a4594a8c42fc0e332726d44e8ababf541b3eb80c4cbf8140b9629389dbad`.

## Evidence and coverage

The retained historical source is `empirical-discard-keep-14.8.json` at commit
`4e8611ca69e41849df37c39da9790bdb43249439`, generated July 2, 2026 at
18:52:50.939 UTC. Its 2,079,994 observations came from a source of 211,303 games.
Its raw total/same-suit counts are preserved, rather than interpreting rounded
probabilities as observation counts. Its provenance includes models 7.0–14.6;
no 15.x/16.x decisions are in this historical source.

The historical export has no game ledger. New imports therefore conservatively
exclude games ending on or before that export timestamp, avoiding double
counting without claiming to reconstruct unknown historical game identities.

New data comprise **127,058 completed eligible games / 1,824,090 observations**:

| Partition | Added discard observations | Used in runtime counts? |
|---|---:|---|
| Training | 1,460,861 | Yes |
| Tuning | 182,190 | No |
| Test | 181,039 | No |

New actors are 9.0, 9.1, 9.11, 13.0, 13.1, 13.215, 13.23, 20.0, 20.1 and
20.2. Eligibility reuses the explicit strong-discard-model allowlist. All
15.x/16.x decisions, unknown aliases, Myrmidon decisions and unattributed human
play are excluded. An eligible actor may contribute when playing an excluded
opponent. Counts have equal observation weight; no new model weighting or
recency decay was introduced.

`training/model203-suit-evidence.json.gz` retains raw counts by model, role,
rank pair and partition, plus source hashes, game identities, content hashes,
seeds, game indices and inclusion ledgers. Matching identities with changed
contents fail; identical game contents under another ID are counted once.
The 20.2-versus-20.0 benchmark is included through all indices **0–4,999 in each
orientation**, across the progressively newer snapshots. Future imports use the
ledger, rather than assuming an earlier snapshot's count is its next index.

The split is the same fixed seed rule as the conditional-discard builder:
SHA-256 of `model203-opponent-discards-v1:` plus stored seed, first eight hex
digits modulo ten; 0 tunes, 1 tests, others train. Repeated seeds and opposite
orientations remain together. Reserved observations stay out of runtime counts.

The runtime now uses **3,540,855** observations, including the historical counts.
Every role has all 78 physically possible distinct-rank rows:

| Role | Runtime observations | Smallest distinct-rank row |
|---|---:|---:|
| Dealer | 1,770,742 | 5,661 |
| Pone | 1,770,113 | 1,370 |

The remaining 13 same-rank rows correctly have zero probability of sharing a
suit: two identical rank-and-suit cards cannot occur in one deck. No usable row
has a zero or one same-suit probability.

## Smoothing assessment

Bayesian smoothing was evaluated but is **not enabled** for this snapshot.
The candidate is a Beta posterior mean:

`p = (sameSuit + strength * rolePrior) / (observations + strength)`.

The role prior uses pooled distinct-rank observations with a broad Beta(1,3)
prior, centered on the physical one-in-four suit probability. Its means are
0.2537253801 for dealer and 0.2125809229 for pone. Equal-rank structural zeros
remain zero regardless of prior strength.

Tuning tested strengths 0, 1, 3, 10, 30, 100, 300, 1,000, 3,000, 10,000,
30,000 and 100,000 against modern 13.x/14.x/20.x decisions. Dealer favored zero.
Pone's best point estimate favored 30,000, but the seed-cluster 95% interval for
its log-loss change against raw rates was [-0.00016631, +0.00011627]. That is
not reliable evidence of benefit. The conservative selection rule requires the
whole interval to favor smoothing; both installed strengths are therefore zero.
The same builder can select a positive strength in a future refresh if justified.

Test results (lower log loss is better):

| Held-out group | Previous suit rates | Refreshed rates |
|---|---:|---:|
| All eligible actors | 0.48374132 | 0.48375302 |
| Modern 13.x/20.x | 0.48280410 | 0.48284310 |
| 20.x | 0.48363244 | 0.48359558 |

These small changes include both improvements and regressions in point
estimates. The corresponding intervals all include zero. This supports saying
accuracy is effectively unchanged at the available precision, not promising a
prediction or win-rate gain. Test data were not used to choose the strength.
The historical aggregate has no seed ledger, so overlap with older-policy
seeds cannot be audited. 20.x policies postdate the historical asset. Whole-seed
intervals account for repeated modern seeds and paired orientations, but cannot
remove this historical limitation. The machine report contains role-level
Brier scores, log losses, calibration candidates and uncertainty intervals.

## Rebuilding and validation

The suit-only builder preserves the conditional payload and metadata. To
reproduce the installed asset and report, with NumPy available:

```sh
python3 scripts/build_model203_suit_evidence.py \
  --evidence training/model203-suit-evidence.json.gz \
  --legacy rust/cribbage-shadow-engine/assets/model20-opponent-discards.bin \
  --base-asset rust/cribbage-shadow-engine/assets/model203-opponent-discards.bin \
  --output rust/cribbage-shadow-engine/assets/model203-opponent-discards.bin \
  --report training/model203-suit-assessment.json --check
```

For incremental ingestion, work on a candidate copy and add `--sources` with a
JSON array of immutable SQLite backup paths, or objects containing `path` and
`originalPath`. Retain the evidence file and seed split. A source backup should
be standalone (`PRAGMA journal_mode=DELETE` after backing up), with no live WAL.
Use the one-shot supervisor for long ingestion/builds. The ingestion job is
`/private/tmp/model203-suited-discards-20260927-v1/job.json`; final calibration,
reproduction and agreement checks are in the corresponding `v2/job.json`.
Verified outputs, builder snapshots and source manifests are archived under
`benchmarks/model203-suited-discards-20260927` in the durable workspace.

The full conditional builder now consumes `--suit-evidence` too. Both builders
produced identical bytes. Format version 2 retains the indexed binary layout,
records the suit prior and raw counts separately, and validates their agreement
when loading. The fingerprint also invalidates cached forecasts after a refresh.
There is no additional per-decision Bayesian calculation.
Validation passed all 407 Rust tests across 21 targets, eight suit/conditional
builder tests, and byte-for-byte reproduction from the installed evidence.

The modern discard path now skips `crib_flush_bonuses_by_suit`, which calculated
four unused legacy bonuses once per decision. Older paths still calculate them
when needed. This is a small removal of wasted work, not a pegging-speed claim.

## Missing own discards and proposed fallback cleanup

Normal gameplay stores the player's two discarded cards when discarding and
copies them into subsequent pegging decisions. The generic text parser,
however, accepts an omitted `ownDiscards` field as an empty list. An incomplete
manual/analysis request can therefore reach a leftover branch that constructs
a four-point crib forecast. No normal gameplay path losing these cards was
found. The usual multi-choice 20.3 world builder subsequently rejects such input
because it requires both own discards; constructing the placeholder happens
before that check. Forced-card shortcuts can return without needing a forecast.

The proposed cleanup means checking required 20.3 inputs before constructing
forecasts and returning a descriptive error if they are absent. Similarly, an
unexpectedly empty legal discard-probability calculation should report an error
instead of silently returning 50% win probability. These are malformed-input or
invariant failures, not sparse-data uncertainty; Bayesian support for unobserved
legal hands/discards would remain intact. Historical 8/7 hand and zero rank-score
fallbacks are bypassed by the modern forecasts.

**This update leaves fallback/error behavior unchanged**, pending discussion of
that separate change.
