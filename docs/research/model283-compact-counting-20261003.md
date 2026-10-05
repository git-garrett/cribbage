# Model 28.3: compact counting correlation and decision-local reuse

## Request and information boundary

The user made speed a hard gate. This assessment separates four changes that
must not be conflated:

1. **Filter known dead cards.** The live root already uses its own two actual
   discards in the 20.7 posterior. Native posterior parity tests cover this
   conditioning. Filtering these cards again would double-deplete probabilities;
   using them to remove the opponent's hypothetical knowledge states would leak
   private information. No additional root depletion is needed.
2. **Give hypothetical future actors their own discards.** This requires choosing
   separately for private contexts when the same keep but different discards can
   change beliefs or counting utility. The rejected experiment enumerated every
   keep/discard pair for both actors and used their dense Cartesian result table.
   It was not merely a dead-card filter. At an opening it expanded 1,819 keeps to
   164,995 contexts per actor. In the measured three-card position, 21 × 13 keeps
   became 1,893 × 1,181 contexts: 273 cells became 2,235,633. Weight reads grew from
   462 to 4,835,100. Those are layout costs, not a proof that efficient full
   discard awareness is impossible. This expansion is not restored here.
3. **Retain root pegging/counting association.** Each positive-weight opposing
   remaining hold now retains its selected pegging endpoint until root valuation.
   Counting is integrated conditionally on that same hold. No new future policy
   contexts or choices are generated.
4. **Share work with identical inputs.** Candidate optimizations reuse immutable
   empirical rows within a decision, skip valuation of forced choices after
   checking posterior support, and separately test a bounded cache of exactly
   equal endpoint/weight distributions.

## Compact suit and joint counting calculation

The known own hand is scored exactly. Its opponent's rank keep receives the same
root probability and uniform legal physical keep-suit distribution as before.
The existing 20.7 discard prior is conditioned and normalized separately within
that keep. For each rank discard pair, only the keep's selected suits at those
one or two ranks affect which physical discard pairs remain available. Enumerate
those small suit subsets; integrate all other keep suits with integer
flush/nobs class counts. This produces a sparse joint distribution of opposing
show score and crib score, associated with that keep's pegging result.

The role-specific empirical suited-discard rate is retained and normalized over
available suited/unsuited pairs for each conditional keep-suit class. Hand and
crib cannot use the same physical card. Marginalizing the resulting joint still
recovers the original opponent-show marginal. Opponent discard-rank mass is not
reweighted by the number of physical variants.

Four suit counts plus the starter's suit suffice for a flush, but not nobs:
`Js 4h 5c 6d` and `Jh 4s 5c 6d` have the same rank and suit counts but differ by
one point with a 9s starter. A right-jack bit is also needed for a known hand.
Per-rank four-bit availability masks and integer bonus classes provide the
required information here without enumerating full suited private policy states.

This is a **live-root correction**. Future choices still use the existing
four-card-rank contexts and board-only WP. Compact arithmetic does not supply
unavailable hypothetical private knowledge or prove different suit-aware
policies equivalent. The future-private-discard and future-counting-aware policy
corrections remain outside the accepted speed gate.

## Correctness and performance gates

- Compare compact joint bins with an independent physical keep/discard enumeration
  using native hand scoring, for opening and late positions, both roles, nobs,
  flushes, same-rank discards and depleted decks.
- Verify opponent-show marginals, probability mass and sequential score-outs.
- Preserve the bounded independent backward-policy reference and strategy-fusion
  witness. Compare sharing off/on with compressed and uncompressed blocks.
- Check live, selected-action and combined-review agreement.
- Run three actual opening fixtures, with repeated forward/reverse ablations on
  the first. All variants use the same ordinary release binary; compare full
  per-hand endpoints and weight bits, not only the winning card.
- Time search and old/new root valuation separately. Record CPU, wall time,
  sampled physical footprint and performance-core share. One serial background
  worker coexists with six unrelated workers; no production-speed claim.

Job and raw evidence: `/private/tmp/cribbage-model283-compact-counting-20261003`.
Debug correctness, release comparisons and final native validation all passed; verified results follow.
No default-model change, deployment, commit or push is part of this request.

## Verified opening comparison

The 15-stage comparison completed and its durable archive was verified. Ten
measurements used the same non-PGO release test binary. All three opening
fixtures had bit-identical full hand-conditioned search results and posterior
weights with reuse disabled, simple reuse enabled, or the additional exact
histogram-value cache enabled. Joint WP values also matched between reuse modes.
The independent physical counting oracle and native review/choice tests passed.

| Opening fixture | Baseline search CPU s | Simple reuse CPU s | CPU reduction | Baseline wall s | Reuse wall s |
|---|---:|---:|---:|---:|---:|
| 1: J–K–K–K | 91.384 | 83.210 | 8.94% | 93.320 | 86.729 |
| 2: 8–6–8–A | 159.203 | 129.033 | 18.95% | 161.900 | 134.628 |
| 3: 2–3–7–Q, late board | 168.380 | 155.743 | 7.51% | 171.997 | 159.529 |

Fixture 1 averages two forward/reverse runs per configuration. The other two
have one matched pair each. Equal weighting of the three fixture means gives a
12.17% search CPU reduction. These are search timings, excluding root preparation
and valuation. Every recorded performance-core share was zero. Individual runs
varied materially even on the same core type: the first fixture's baseline CPU
was 97.210 and 85.559 seconds; reuse was 78.704 and 87.717. The paired averages,
other fixtures and reduced work support the change, not a claim that every
individual run is faster or that production hardware will gain the same amount.
On fixture 3, sampled instructions fell from 534.02 to 513.17 billion (3.91%),
while cycles fell from 157.07 to 149.50 billion. This confirms removed work in
addition to the timing evidence.

On fixture 1 the solver visits the same 840,990 blocks and 5,303,828 information
groups. It skips 2,185,852 forced-choice valuations and reuses 104,312 prior rows
from a decision-local cache containing 542 rows. Child-score peak storage is
unchanged at 6,145,044 bytes. The cache key is actor role plus opposing public
rank counts; history-dependent likelihoods are still calculated separately.
No incompatible private contexts are merged.

The extra histogram-value cache achieved only 30,231 hits. Its mean search CPU
was 86.563 seconds versus 83.210 for simple reuse, approximately 4.0% slower.
**Declined and removed from the retained source.** Its measured source and raw
results remain archived for reproducibility. No unsuccessful cache is enabled.

## Correlation cost and decision effects

The new joint-counting calculation took 0.076–0.282 CPU seconds across all ten
runs. The largest added cost versus the old marginal evaluator was well below
one second and below 0.4% of the associated opening search. This is affordable
on these fixtures without expanding the future tree. Complete native hands are
also tested to catch a disproportionate effect on later decisions.

The selected leads remained K, 8 and 2. The first two estimated lead WPs changed
from 0.6055715422 to 0.6056459376 and from 0.3408106453 to 0.3409439355. On the
third fixture the values were equal within floating-point roundoff. No stronger
play is inferred from unchanged leads or three deals.

A final numerical cleanup normalizes conditional and root weighted values by
their accumulated mass. This preserves exact zero/one probabilities and avoids
roundoff-based tie changes for certain outcomes. It does not alter the search.
A regression witness distinguishes the coherent 100% example from its incorrect
75% independent-marginal equivalent. Final native checks use this retained
source and their own frozen hash record, rather than claiming the measured
experimental binary is the final binary.

Performance evidence: `benchmarks/model28/model283-compact-counting-20261003/performance`.
Final native validation is recorded separately below.

## Final native validation

The final source passed the independent policy/scoring tests, physical joint
counting oracle, correlation witness, exact certain-probability checks, native
28.3 choice/review tests, and the shared review regression for existing models.
The native hidden-information audit covered 10 legal late positions across both
roles and seats. All 80 mutations of hidden keeps, discards, crib contents and
RNG state preserved the chosen card, EV and WP bits exactly.

All three complete native hands played all eight cards legally. The frozen
source, assets, fixtures and binaries remained unchanged. All leads and final
pegging scores matched the original 28.3 integration run. Complete rank sequences
matched for hands 1 and 3; hand 2 changed later play order while still finishing
68–73. This is a deliberate root-valuation change, not parity claimed for the
entire corrected model or evidence of improved playing strength.

Times below are **wall / CPU seconds**, for the whole hand's first decision and
total pegging time. They are sequential one-worker background measurements
alongside the six unrelated workers, using the final ordinary release binary,
not fresh PGO or isolated production-hardware measurements.

| Hand | Pone first decision | Pone whole hand | Dealer first decision | Dealer whole hand |
|---|---:|---:|---:|---:|
| 1 | 82.155 / 80.296 | 82.654 / 80.786 | 10.568 / 10.249 | 10.648 / 10.327 |
| 2 | 136.504 / 125.044 | 137.529 / 126.059 | 6.249 / 5.162 | 6.352 / 5.262 |
| 3 | 127.057 / 111.129 | 127.391 / 111.440 | 13.086 / 12.864 | 13.113 / 12.890 |
| Mean | 115.239 / 105.490 | 115.858 / 106.095 | 9.968 / 9.425 | 10.037 / 9.493 |

Every sampled performance-core share was zero. Peak physical footprints were
18.023, 17.859 and 18.203 MB. The later decisions add only 0.31–1.01 CPU seconds
per pone hand and 0.026–0.100 seconds per dealer hand. The matched search ablation
above is the speed comparison; these native absolute times must not be used to
infer an additional percentage gain from a differently linked binary or earlier
unmatched runs.

The standalone audit wrapper initially omitted Cargo's thin-LTO setting; Apple
could not read Rust's bitcode. Matching the Cargo LTO setting fixed the wrapper.
The same job resumed using its completed engine/test builds. No solver change or
hand restart was needed. The failure log and corrected-controller provenance
are preserved in `native-setup-repair-1`.

Final evidence: `benchmarks/model28/model283-compact-counting-20261003/native`.
`retained-change.patch` separates this request's changes from the existing model
integration. No production deployment, active benchmark restart, commit or push
was performed.

### Verified cause of the changed later move

Hand 2, pone at count 22 after 8–7–A–6, can play its 6 or 8. A standalone
selected-action review linked separately against the preserved old library and
the final native library reproduces the change:

| Card | Pegging EV, both versions | Old marginal WP | New joint WP |
|---|---:|---:|---:|
| 6 | 0.602579803304 | 0.289247764062 | 0.288803745633 |
| 8 | 0.094663292891 | 0.288309153752 | 0.289441464441 |

Both candidates' pegging EVs match bit for bit. Keeping the counting association
reverses the WP ranking; the 8 has a 0.000637719 higher modeled WP under the joint
valuation. This explains the changed choice, despite its lower pegging EV. It
is not a demonstrated real-world win-rate gain. The compiled comparison,
library hashes and exact values are retained in `late-review.json`.
