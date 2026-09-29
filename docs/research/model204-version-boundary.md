# Model 20.4 version boundary

Model 20.3's current paired 10,000-game benchmark last resumed at
`2026-09-28T14:33:24.149196Z`, with source commit
`567ff4f0570faea537a2f257df2cacf4494d5b24`. The experiment is
`model203-vs-model202-10k-20260927-v4`, seed 433780286, with 5,000 games per
orientation and six workers. Its frozen executable, source, assets, existing
rows, and model labels remain unchanged. All restarts belong to that experiment;
post-restart research results are not its measured performance.

Subsequent retained work was initially developed under the 20.3 identifier.
It now belongs to the separate `schell_table-peg_table-20.4` model:

| Original commit | Change | 20.3 behavior | 20.4 behavior |
| --- | --- | --- | --- |
| `1bacdbf` | Forced-rank live choice without valuation | Original recommendation path | Skip valuation when the caller needs only the action |
| `9bb8adf` | WP action-cache admission | Cache both actors within the decision | Preserve root-actor entries; skip mostly single-use opponent entries |
| `89d4ed8` | Selected-action and shared review forecasts | Forecast every action, then filter; separate recommendation | Forecast selected action only, or share preparation for a combined review |
| `115d3b5` | Related posterior queries | Scalar scheduling | Batches of 32 for each actor's first pegging decision only |

20.4 uses the exact verified 20.3 hold, decline, discard/suit, crib, and 20.2
board assets. Their filenames, checksums, provenance, and learning-version
metadata remain unchanged. Only execution strategy differs; no training is
repeated and no playing-strength gain is claimed. Asset loading keeps separate
policy configurations, including when callers alternate models in one process.

The rejected complete-observation grouping prototype is not enabled for either
model. Its historical measurements and rejection are retained in
[the assessment](model203-observation-groups.md).

Two post-restart changes are shared infrastructure: `30ac288` cancels obsolete
API opening work, and `610e73c` automates fresh Mac PGO profiles. They do not change
model calculations and remain available to the API/build tools. Their adoption
is part of the 20.4 development period; neither affects the already-frozen
20.3 benchmark. Production Ace remains Model 13.23, with its independently
reviewed/deployed optimizations. Exact benchmark reproduction must use the
frozen revision, compiler configuration, and receipts, not a later shared build.

The research package version and default benchmark PGO training target are now
20.4. Explicit `--model` options remain required for other matchups, including a
new build intended to serve 20.3. Historical run IDs and assessment measurements
are not relabeled.

## Validation

The version boundary is checked against both retained references: new 20.3
against the running benchmark's frozen `567ff4f` executable, and new 20.4 against
the pre-split optimized `115d3b5` engine. The isolated suite covers 18 discovery
and held-out pegging positions, both roles and first/later decisions. The shared
workload also covers discards, selected-action reviews, combined reviews, and
complete hands, with EV/WP compared as integer bit patterns. Results are retained
under `/private/tmp/cribbage-model204-split`; this is a parity check, not a new
performance experiment.

Completed: all 36 isolated-decision comparisons and 68 workload-case comparisons
matched exactly, including integer EV/WP bits in the workload and both complete
held-out hands. The full Rust suite passed 434 tests across 22 targets; web tests,
TypeScript typechecking, and release-build tests passed. The frozen source used
for parity was checked against every changed Rust source file before commit.
