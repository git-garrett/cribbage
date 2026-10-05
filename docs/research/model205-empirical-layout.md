# Model 20.5: prepared empirical belief rows

**Complete; rejected and removed from the working engine.** Reference: retained 20.5 with prepared compact
continuation bases and reduced outer-rollout allocations. The previous
incremental-history prototype was removed before this experiment.

## Remaining work and prototype

Cached evidence hands already contain rank masks and precomputed denominators.
The remaining repeat work precedes that cache: an empirical row filters by total
hand size and thirteen availability comparisons, then recreates the evidence
hand's mask and denominator for each new evidence context.

The 20.5-only prototype compiles the existing validated rows once at asset load.
It shares immutable prepared rows across policies using Arc. Each 16-byte entry
stores a converted f64 weight, a 16-bit hand ID and a 16-bit depletion denominator.
A shared table of 2,380 possible zero-to-four-card rank hands holds the original
rank vector, size, rank mask and packed counts. The denominator is an exact
integer in 0..=256, so storing it as u16 and converting back to f64 preserves bits.
The division/multiplication sequence is unchanged; weights are not predivided.

Availability is packed once per query into thirteen four-bit fields. Each field
has a guard bit; subtraction and a guard-mask test check all rank limits without
cross-field borrowing. The iterator retains the original empirical row order,
including sparse/mixed-size fixture rows and duplicate entries. It never sorts
hands by ID. Nonstandard availability falls back to the old rank checks.

Evidence construction reuses prepared masks and denominators. Existing cached
scalar/batched weight kernels are unchanged. Root posterior enumeration also
uses the prepared compatibility iterator. Learning assets, weights, likelihoods,
world selection, information boundaries, query scheduling, utility and tie-breaking
are unchanged. Historical models do not opt into prepared rows. Copy-on-write row
edits invalidate preparation only for the edited clone.

The 43,862 empirical entries occupy 701,792 bytes of prepared records; shared hand
metadata and row vectors bring estimated retained preparation storage to 785,792
bytes (about 0.75 MiB), excluding allocator overhead. The raw immutable rows remain
available for reference/fallback behavior. This is additional RAM, not a claim of
lower total memory or a new disk asset.

Compact IDs and packed compatibility were selected instead of a separate bitset
index for every empirical context: filtering directly in source row order is
simpler and preserves floating-point accumulation and memo-access order. Existing
rank masks already limit cached arithmetic to occupied ranks, so no second sparse
rank/count representation is added to the hot cached evidence structure.

## Validation and measurement

New tests cover every possible hand against individual rank limits and randomized
combined availability; every one of the 1,120 asset contexts with five availability
patterns; exact filtered row order, weight bits, masks, denominator bits and
weighted-evidence bits; missing/empty rows, mixed hand sizes, duplicate entries,
large integer weights, nonstandard availability and clone insertion/repreparation.

The timed experiment uses independently built PGO executables, separate warmed
workers, identical 20.5 requests and alternating/reversed order. Eighteen isolated
fixtures run twice; three complete hands run twice. Physical choices, EV/WP integer
bits and final states must match. Timings are Mac process CPU, not production-server
wall latency. The existing frozen head-to-head benchmark is not restarted.

The prototype passed **441 Rust tests across 22 targets**. The PGO build's own
20.4/20.5 training and validation cases matched exactly. The independent timed
comparison then matched all **100 paired decisions and valuations**: 36 isolated
comparisons and 64 decisions within six complete-hand comparisons. All six final
hand states matched. There was no observed playing difference.

## PGO results

Isolated first-decision averages (Mac process CPU seconds):

| Role | Prior 20.5 | Prototype | CPU change | Held-out CPU change |
| --- | ---: | ---: | ---: | ---: |
| Pone | 11.056373 | 11.116427 | +0.54% | +1.19% |
| Dealer | 1.673671 | 1.661056 | -0.75% | -0.65% |

Positive changes mean slower. Only three of eight paired pone openings improved;
all four distinct pone fixtures were slower on average. Six of eight dealer
pairs improved, and all four distinct dealer fixtures improved on average.

Separate complete-hand fixture averages (three fixtures, each repeated twice):

| Role / measure | Prior 20.5 CPU seconds | Prototype CPU seconds | CPU change |
| --- | ---: | ---: | ---: |
| Pone / first decision | 9.882586 | 9.917685 | +0.36% |
| Pone / whole-hand pegging | 10.035519 | 10.065386 | +0.30% |
| Dealer / first decision | 1.242306 | 1.229873 | -1.00% |
| Dealer / whole-hand pegging | 1.262570 | 1.249143 | -1.06% |

Dealer first/whole-hand pegging improved in all six pairs, but pone first/total
improved in only two of six. The dealer benefit is small, about 12–13 milliseconds
in these full-hand averages, while pone loses about 30–35 milliseconds.

Maximum observed post-decision RSS was 86.00 MiB for the reference and 86.25 MiB for the prototype. These are process snapshots, not peak RAM measurements or a direct measure of prepared-table storage.

## Decision and interpretation

Do not retain this general 20.5 representation change. It preserves tested play
and provides a small dealer gain, but does not earn a critical pone-opening gain.
The direction of the pone result agrees between isolated and complete-hand
workloads. No extra confirmation run was needed to justify keeping the existing
implementation; an optional confirmation script was prepared but not launched.
The figures are fixture-based measurements, not a claim of a universal slowdown.

Much of the suggested preparation was already present in cached evidence: masks
and denominators are reused after construction, and only occupied ranks are
visited by the hot weighting kernels. This prototype moves that preparation
farther upstream and speeds compatibility checks while introducing an ID lookup.
It affects evidence construction/cache misses and posterior enumeration; it does
not remove continuation search or the repeated weighting of cached evidence.
That limits the work it can save. The full-decision measurements are the reason
for rejection; no isolated timing attribution to the ID lookup is claimed.

The dealer benefit could motivate a separate role-restricted experiment if a
roughly one-percent dealer gain becomes a priority. That variant was not tested
or enabled here; it would add another execution branch without addressing the
current pone-lead priority. This assessment does not rule out every different
layout or future architecture.

The exact pre-experiment copies of model91.rs and model1323.rs were restored and
the newly created prepared-row module was removed. The earlier 20.5 improvements
remain intact. Source, tests and measured results of the rejected prototype are
preserved in the archive. No production deployment, benchmark restart, commit or
push was performed by this assessment.

## Verification and artifacts

After removal, all **438 baseline Rust tests across 22 targets pass**, and
`git diff --check` passes. Both restored engine files match their pre-experiment
hashes. The active frozen benchmark executable hash is unchanged.

Frozen reference/candidate source, exact pre-edit files, proposal diff, fixture
inputs, measurement adapters, PGO receipts, supervisor summary, parity/timing
results and source audit are archived with verified hashes at
`benchmarks/model20/evaluation-20260929/empirical-layout-assessment`.
The internal working assessment root is `/private/tmp/cribbage-205-empirical-layout`.
