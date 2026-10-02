# Model 20.7: short legal-rank check and conditional crib forecast

Model 20.7 (`schell_table-peg_table-20.7`) inherits final 20.6 policy, assets,
root ordering, exact bounds, forced-continuation loops and integer suit-class
show forecasting. Its additional speed optimization is accepted trial
`01-rank-predicate`: when a batched WP query asks whether a rank choice exists,
stop at the second legal rank instead of allocating and filling a temporary
vector just to count it.

The predicate counts distinct ranks, not physical cards. Multiple copies of a
single legal rank still constitute a forced rank choice. The same legality
predicate and ascending rank order feed both the short check and the historical
vector-producing helper. No posterior, floating-point operation, candidate
valuation, tie rule, or information boundary changes.

The subsequent pegging-time crib update changes valuations as described in
[the conditional-crib assessment](model207-conditional-crib.md). The exact-value
parity results below describe the initial short-rank-check integration at
`bb879b1`, before that valuation change.

## Version boundary

The opt-in defaults off in each new `Model91Policy`. Only 20.7 choice and review
preparation enables it on that decision's private policy. Historical 20.6 and
older requests retain the allocation/count branch. Shared immutable assets and
the existing hand cache do not carry this flag between models. The production
Ace alias remains 13.23. The API and client preserve the explicit 20.7 identity.
New benchmark release builds train 20.7 by default; matchup builds should name
both models explicitly. API builds continue to train Ace.

## Trial decision

Six ideas were tested cumulatively; only #1 was retained, as explicitly accepted
by the user after one bounded confirmation. Pone-opening instructions decreased
0.49%. Confirmation CPU time changed from 8.690523 to 8.423255 seconds, but
different performance-core shares prevent treating the nominal 3.08% improvement
as a clean causal speed estimate. Actual whole-hand pegging improved 0.50% as
pone and slowed 0.27% as dealer in the separate hand sample. All tested physical
choices and EV/WP bits matched. The acceptance is a small simplification with
demonstrably less work, not a promised 3% latency improvement.

Rank-only tie scoring, duplicate-legality removal, deferred cache-hit validation,
direct cut-bucket indexing, and one likelihood lock per batch were set aside.
They are not incorporated into 20.7. The complete evidence and rejected patches
are archived under `benchmarks/model20/evaluation-20261001/model207-observation-trials/`.

## Integration verification

The integration checks exhaust every rank-presence mask and count 0–31, including
multiple physical copies of a rank. Batched policy checks compare the new route
with the unchanged scalar reference across private-card variants, roles, scores,
cache hits, duplicate queries and unsupported likelihoods. Live/cache/review
tests alternate 20.7 with historical model requests.

Full-suite, fresh-PGO and saved-result parity receipts are recorded under
`benchmarks/model20/evaluation-20261002/model207-incorporation/`. The release
comparison uses 128 saved positions for 20.7, 32 historical 20.6 positions, and
eight discard/review/whole-hand workload cases per model. All passed on
2026-10-02, with identical physical choices and EV/WP bits. The full Rust
suite, TypeScript typecheck, release-build script tests, and paired reporter
tests passed. Fresh PGO training and validation retained exact values for
both models. The retained engine and asset files match the tested snapshot;
only the fixture adapters differ. Standards and specification reviews found
no issues in the integration. These are correctness checks, not new timing
measurements.

No new strength benchmark or production deployment is part of this change.
