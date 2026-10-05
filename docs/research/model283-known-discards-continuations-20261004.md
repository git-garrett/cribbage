# Model28.3: retain known own discards through continuations

Status: complete. Retained the known-own-discard continuation correction in Model28.3 after native and fresh-PGO verification.

The requested scope is **known own discards only**, with no hypothetical opponent discard pairs or six-card private-context expansion. The registered research source was updated only after verification.

## Final PGO result and decision

Retain the correction. It carries only the live actor’s supplied known discards into that actor’s future choices. No unknown opponent discard variants were generated. The existing opponent policy remains independent of the live actor’s private cards; when the opponent later becomes the live actor, its own solve receives and retains its own discards. This does not claim to model an unknown hypothetical opponent discard pair.

| Role / measure | Before CPU s | After CPU s | Before wall s | After wall s |
|---|---:|---:|---:|---:|
| pone first decision | 27.461748 | 29.759692 | 28.314974 | 30.302717 |
| pone whole-hand pegging | 27.699741 | 29.982721 | 28.555299 | 30.534734 |
| dealer first decision | 2.809881 | 2.842093 | 2.860192 | 2.887106 |
| dealer whole-hand pegging | 2.849956 | 2.873245 | 2.901539 | 2.919484 |

Four serial paired complete hands, three unique fixtures with a reversed repeat of fixture0; averages give equal weight per unique fixture. Aggregate cycles change +0.954%; instructions change +1.980%. Sampled P-core share ranges 0.000000–0.000000. Peak footprint 24.53→24.20 MiB. These are background/nice20 Mac runs; clock/scheduling variability makes elapsed-time differences much noisier than work counters. The result supports inexpensive retention, not a general speedup claim.

The final optimized candidate reproduces the new native candidate’s actions and EV/WP bits on all four hands. Both models completed all eight cards legally. This parity is **between implementations of the discard-aware candidate**, not equality with the old strategy: forecasts intentionally change. PGO independently passed 10 training and 16 held-out cases. Independent private-continuation references, unchanged public-policy checks and 80 hidden-state mutations passed before activation. No broad playing-strength advantage or game win-rate improvement is established by these few deals.

The benefit is correcting information lost between the root and its simulated future choices. The proposed second benefit—substantial compute reduction—does not arise here: the rank-compressed representation removes few additional hold types, and the opponent’s broader legal reasoning must remain available. The final variant reuses the existing weight buffer and physical endpoints, keeping the extra cost small.

Durable evidence: [model283-known-discards-20261004](/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/model283-known-discards-20261004). Source, old/new binaries, exact test inputs, full measurements, profile/build receipts, source hashes and an archive verification receipt are preserved.

### Simultaneous timing control

The sequential run showed a larger elapsed-time difference than the cycle difference. Four additional simultaneous pairs started old/new single-thread workers together under the same background policy. All results remained identical to the saved outputs of their respective binaries. This is a relative timing control, not standalone latency.

Equal-fixture mean pone opening CPU: 28.280776 → 28.645007 seconds (+1.288%). Wall: 29.910908 → 30.298680 seconds. Aggregate cycles: +1.178%. These support a small real cost rather than the approximately 8% sequential CPU difference. Retained as an information-preservation correction at roughly 1% additional cost, not as a speed optimization.

The final summary collector initially matched progress JSON as well as result JSON. Its file selection was corrected to the four explicit result names; all four completed paired calculations were preserved and the verification alone was resumed. The original report failure and unchanged result hashes are preserved in `verification-correction-1`.

## Current behavior and information boundary

The live observation already supplies the actor's keep, own two discards, public played cards and starter. The root posterior excludes/reweights opposing keeps accordingly. The previous continuation solver reconstructs future weights using four-card keeps alone, so even the live player's own future choices forget those two discards.

The root's posterior restriction does not eliminate all corresponding public score work: an opposing policy still needs to reason about hands compatible with **its** information. It cannot inherit the root player's private dead-card restriction. Thus the proposed benefit to beliefs is real, but a net compute saving does not follow automatically.

The engine supplies only the live actor's legally visible cards to Model28.3. The actual opponent's discards are absent. When that other actor becomes live, the engine supplies its own discards to its own solve. During a current forecast, unknown opponent discards remain unknown and are not enumerated or filled with actual hidden cards.

## Narrow implementation

Keep the existing shared public/own-keep policy tables unchanged. Alongside each relevant child, carry one extra result row for the live actor's actual keep and known discards. This actor's later weights subtract its keep **and** known discards, and it selects one action across its compatible opposing keeps. Opponent turns use the existing public-policy choice and carry forward the extra row's corresponding outcome. Branches incompatible with known dead cards omit only the extra row; they do not corrupt the opponent's uncertainty.

This is a discard-aware continuation against the existing opponent policy, not a claim that every hypothetical opponent now knows a discard pair that was never supplied. It adds no hypothetical hands, discard variants or persistent action table. Physical endpoints remain shared. A single private row is released with each consumed public child.

## Gates

- Independent finite-support backward reference, both roles and several boards/discard pairs.
- Exact equality of every public-policy action and public score table when private discard knowledge changes.
- Zero-discard ablation preserves original outcomes.
- Native hidden-information mutations must leave decisions/values unchanged.
- Same opening fixtures, serial single-thread background runs, CPU/wall/instruction/cycle/core-share and memory measurements. Whole-hand paths may change intentionally after a new decision; report this distinction.
- Changes in future decisions from using legally known discards are intended. No claim of stronger win rate follows from a few deals.
- No activation if the implementation produces a material speed regression or violates legal information.

Evidence workspace: `/private/tmp/cribbage-model283-discard-continuations-20261004`.

## Initial correctness result

The new bounded reference tests passed for both roles, multiple boards and differing known discard pairs. They require at least one changed future choice, verify the zero-discard ablation, and compare every public table cell and recorded opposing/public action with the unchanged baseline. More than forty separate private-context configurations are checked without enumerating unknown discards in the playing code. Existing Model28.3/reference/scoring tests and 80 native hidden-information mutations also passed. Native complete-hand timing results are recorded below.

## Native performance screen

Four paired complete-hand runs (three unique deals plus a reversed repeat) played all cards legally and chose the same observed move sequences. Their forecasts changed intentionally. For example, the first opening's estimated WP changed from 0.6054370428084257 to 0.6057608325163818; this is a changed forecast, not a measured win-rate gain.

Aggregate native instructions increased 0.685%; cycles decreased 0.427%. CPU timings varied markedly despite E-core-only execution, so these results indicate approximately neutral throughput rather than a proven speedup. Peak sampled footprint was 24.39 MiB before and 24.47 MiB after. No hypothetical discard contexts were introduced.

For the three opening fixtures, physical four-card **rank-hold** support changes from 1727 to 1725, 1815 to 1813, and 1815 to 1813 when adding the two known discards. In these examples each discarded rank is distinct from the kept cards: three copies of that rank remain available, so only the all-four-of-that-rank hold becomes impossible. Many other holds are reweighted but remain possible. This explains why pruning physical card deals need not substantially shrink an already rank-compressed solver. The live root already had these restrictions; the change retains them in the live actor's future choices.

The final version reuses the existing weight buffer for its extra row. It passed the focused tests, fresh PGO training and matched PGO full-hand comparisons. Candidate results remained bit-exact to the tested native discard-aware version; differences from the old discard-forgetting version are intentional. Final results and the simultaneous timing control are recorded above.
