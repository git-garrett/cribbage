# Model 20.3 conditional opponent discards

The 20.3 runtime now loads `model203-opponent-discards.bin`. It replaces the
conditional section of `model20-opponent-discards.bin` for this version only.
The original binary and all 20.0–20.2 loaders remain frozen. The historical
`model1322-opponent-discard-histograms.json` is still needed for older models.

This distribution answers: given the opponent's four kept ranks and dealer/pone
role, which two ranks did they discard? Live pegging uses those private discards
when forecasting the opponent's future choices. It conditions the distribution
on our six known cards and the cut, then normalizes **within each opponent keep**.
It must not change that keep's posterior probability merely because one keep
has more discard variants than another.

## Data and reproducibility

The refresh reads 33 distinct immutable database snapshots containing 124,729
completed, reproducible, deduplicated games and 1,782,004 eligible discards.
This is 78,311 more games and 1,034,688 more observations than the preceding
46,418-game, 747,316-observation corpus. All preceding game contents were found
in the refreshed corpus. The 20.2-versus-20.0 snapshot contains 3,832 and 3,839
completed games by orientation; exact indices, including gaps, are recorded.

Actors contributing training data are 9.0, 9.1, 9.11, 13.0, 13.1, 13.215,
13.23, 20.0, 20.1 and 20.2. The shared explicit strong-model allowlist permits
other established strong versions when their attributable games become
available. Unknown aliases, humans, Myrmidon's decisions and all 15.x/16.x
actors are excluded. Approved actors playing excluded opponents can contribute.
Eligibility here concerns discard choices; the stricter pegging-policy filter
for decline behavior is a different asset-specific policy.

`training/model203-opponent-discard-evidence.json.gz` retains integer counts by
model/role/keep/discard, training/tuning/test partitions, exact game identities,
content hashes, source hashes and per-source inclusion ledgers. Test observations
also retain the opposing six cards and cut for depletion-aware assessment.
Repeated imports are idempotent; changed completed identities fail, while
identical game contents exported under new IDs are counted once.

The fixed split is SHA-256 of `model203-opponent-discards-v1:` plus the stored
seed string, first eight hex digits modulo ten: 0 tunes, 1 tests, others train.
This keeps repeated seeds and both benchmark orientations together, across
every source. Training uses 99,759 games / 1,426,635 observations; tuning uses
12,597 / 178,506; testing uses 12,373 / 176,863. Held-out observations remain
archived but do not contribute runtime counts or the empirical prior.

The builder requires NumPy. Reproduce the installed snapshot:

```sh
python3 scripts/build_model203_opponent_discards.py \
  --evidence training/model203-opponent-discard-evidence.json.gz \
  --baseline-evidence training/model20-opponent-discard-evidence.json.gz \
  --legacy rust/cribbage-shadow-engine/assets/model20-opponent-discards.bin \
  --output rust/cribbage-shadow-engine/assets/model203-opponent-discards.bin \
  --report training/model203-opponent-discard-assessment.json --check
```

For a future refresh, copy the evidence to a candidate path and pass `--sources`
with a JSON array of immutable SQLite backup paths. Keep the seed split fixed.
Preserve the frozen model asset and assign a new version/hash after assessment.
Use the one-shot supervisor for long builds. The completed refresh and
reproducibility job is `/private/tmp/model203-opponent-discards-20260927-v2/job.json`.

## Bayesian smoothing

For each role and four-card keep, the categorical posterior mean is
`p(discard) = (n(discard) + 30*q(discard)) / (N + 30)`.

The prior `q` starts with 99% pooled discard habits for that role and 1% physical
two-card probabilities (6 combinations for a pair, 16 for distinct ranks).
It accounts for cards already in the hypothetical keep and renormalizes.
Impossible pairs receive zero; every physically possible pair receives positive
mass, even in a completely unobserved keep row. The strength of 30 means thirty
prior observations distributed across the row, **not thirty per discard pair**.

Tuning compared strengths 0.1, 1, 3, 10, 30, 100, 300 and 1,000 and older-model
observation weights 0, 0.1, 0.25, 0.5 and 1. Both roles selected strength 30 and
older weight 0.5 by log loss on held-out 13.x/20.x play. Each pre-13 observation
therefore contributes half the weight of a newer observation. This replaces
the historical rule giving the two normalized cohorts equal mass in a row,
regardless of their sample sizes. No recency decay is applied.

Training observes 44,753 dealer and 47,753 pone cells: 92,506 of 330,590 legal
cells (27.98%). Smoothing supplies positive runtime support for all 330,590.
This represents uncertainty; it does not claim empirical coverage is complete.

## Predictive assessment

The old installed asset trained on many older/13.x test games. Comparing it
directly with a properly held-out candidate gives the historical asset an
in-sample advantage. The assessment therefore also reconstructs its original
equal-cohort estimator using only training seeds from its exact historical
game corpus (`historicalTrainOnly`). Newer 20.1/20.2 play also permits a direct
comparison with the installed asset, since it postdates that asset.

Scores below condition on the observer's six cards and the cut. Lower Brier
score is better; it assesses the complete probability distribution.

| Held-out actor group | Historical estimator, training seeds only | Updated counts, unsmoothed | Updated and smoothed |
|---|---:|---:|---:|
| All eligible actors | 0.9403761 | 0.9348175 | 0.9344613 |
| 13.x and 20.x | 0.9438126 | 0.9357240 | 0.9349671 |
| 9.x | 0.9324445 | 0.9327252 | 0.9332938 |
| 20.1 | 0.9453381 | 0.9365804 | 0.9353787 |
| 20.2 | 0.9470556 | 0.9390019 | 0.9378885 |

Every individual 13.x/20.x version improves against the comparable historical
estimator. For that group, the paired seed-bootstrap 95% interval for the Brier
change is [-0.0094021, -0.0082423]. There is a small measured 9.x Brier regression:
+0.0008493, interval [+0.0001784, +0.0015315]. Its log loss improves. This is an
explicit tradeoff in a prior tuned toward contemporary strong play, not a claim
that every metric improves against every opponent.

Against the **installed** asset, held-out 20.2's Brier score improves from
0.9451218 to 0.9378885; paired 95% interval [-0.0088074, -0.0057346]. Actual
discards wrongly assigned zero fall from 495/7,079 to 0/7,079. Across the entire
176,863-observation test set, the new asset assigns zero to no actual discard.

Unsmoothed categorical log loss is infinite wherever an actual event has zero
probability. The machine report records this as `nll: null` and separately
labels comparisons clipped at 1e-15; those finite clipped scores are not the
true unsmoothed log loss. Candidate log loss is finite without clipping.
Uncertainty intervals resample whole seed clusters, not individual decisions.
These are prediction checks, not proof of a win-rate improvement.

## Format and runtime

`M203OD01`, little-endian: the 64-byte header contains magic, version, metadata
length, dimensions (2 × 1,820 × 91), payload length and SHA-256. The payload is
JSON provenance, two historical suited-discard sections (2,200 bytes each),
then dense f64 probabilities in role/keep/pair order. Rank keys are sorted
lexicographically. The 14.8 suited counts/rates are copied bit-for-bit from the
previous consolidated binary; this refresh changes conditional discards only.

The asset is 2,655,081 bytes. Its SHA-256 is
`56dfd79e5614656165b48847831a56394fb0f3d92475b76c9991e5e78fa222f9`.
The runtime pins that checksum, validates every row, uses a direct combinatorial
keep index and precomputes each pair's fixed physical denominator. Conditioning
uses two rank lookups instead of scanning thirteen ranks per pair and retains
floating-point weights. There is no integer-rounding path to recreate zeros.
The asset fingerprint participates in hand-cache identity.

Exhaustive support tests cover all 1,820 keeps, both roles, and every available
cut rank with known cards removed. They compare depletion weights to physical
combination counts, ensure positive legal support and forbid impossible cards.
A production-world test verifies that expanded discard support preserves every
opponent keep's posterior mass. Complete forecast timings are assessed separately
because enumerating additional legal worlds can outweigh faster row access.

The complete-forecast probe evaluated every world and every candidate action,
without sampling or early action bounds. Two repetitions reversed variant order;
the unrelated 20.2 benchmark remained running. These five fixtures are a small
latency diagnostic, not an estimate of overall benchmark throughput.

| Position | Previous conditional asset | Smoothed conditional asset | Worlds before → after |
|---|---:|---:|---:|
| Opening | 9.969 s | 15.203 s | 39,728 → 163,195 |
| First reply | 1.252 s | 2.381 s | 9,927 → 41,200 |
| Two cards each | 10.99 ms | 19.15 ms | 1,898 → 8,272 |
| One card each | 0.032 ms | 0.020 ms | 13 → 13 |
| Near game end | 4.901 s | 8.677 s | 39,728 → 163,195 |

The opening and first reply show real latency regressions of approximately
53% and 90%. Filling empirical zeros increases support roughly fourfold; faster
indexed conditioning does not offset all the added exhaustive continuation
work. All returned histograms remain normalized. Late private-discard collapse
still works exactly when the opponent has at most one remaining card. The full
machine report, including all outcome histograms, is
`training/model203-opponent-discard-forecast-assessment.json`.

The implementation passes 400 Rust tests across 21 targets, the conditional
builder/ingestion tests, and byte-for-byte asset reproduction. This supports
correctness and better contemporary discard prediction. It does **not** support
calling the change universally regression-free: the latency cost and small
older-model Brier tradeoff above are measured limitations. A paired playing
benchmark is still required to assess winning strength.

The frozen `model1323-corrections.bin` is not rebuilt by this refresh. Rank-only
discard choices still pool board positions and suits; this change does not
claim to model those dependencies or calibrate itself during live games.
