# Model 28.3: strategy cost gates and measured optimization sweep

Status: complete. Every item assessed; all native/PGO verification and the durable evidence copy passed. Started 2026-10-04 UTC. Working tree: `/private/tmp/cribbage-model283-score-blocks`; baseline includes future rank-hand counting and correlated live-root counting. No production/default/model20.x changes are authorized here.

## Protocol and recovery

- Evidence directory: `/private/tmp/cribbage-model283-optimization-sweep-20261004`. Baseline source and binaries are frozen there; `baseline-hashes.json` records source hashes.
- Judge strategy additions against the user's **cheap only** gate. Do not silently substitute an approximation for full private-information support.
- Performance-only changes must preserve legal information, candidate order/ties, all conditioned endpoints and weight/value bits. Use bounded independent reference tests, hidden-information mutation tests, and complete-hand legality checks. A finite corpus cannot prove playing strength.
- Test one candidate against the last accepted implementation. Preserve rejected variants and results, remove them from the retained source. Record each decision here immediately.
- Use fresh recorded random seed for new held-out fixtures; explicitly label the three historical replay fixtures. No sampling or search cutoff is allowed in the model.
- Hardware: 12 logical cores (6 performance, 6 efficiency), about 18 GiB RAM. Six unrelated workers plus indexing currently consume approximately 8–9 core equivalents. Up to three build/correctness workers initially; serial matched performance trials. Preserve all unrelated workloads. Record CPU, wall, instructions, cycles, memory and core share; same core type does not fix frequency.
- Use one-shot supervisor for durable builds/tests, no new timer notifications. Keep source/assets/fixtures fixed during each job.
- The full 20.x inventory and individual experiments below are complete. Final native and PGO verification and the hash-verified archive transfer passed. Historical screen entries retain their original provisional conclusions; the decision register immediately below is authoritative.

## Decision register

The nine retained changes are exact arithmetic ratios, sparse ascending rank traversal, cached packed hands, forced-row support checks, hoisted raw-prior lookups, physical action iteration, fixed branch memberships, shared physical-state preparation, and fixed public-history buffers. Their clean native implementation passed all seven complete-hand pairs across six deals, with exact decision/EV/WP parity; fresh PGO also passed all checks. No approximate pruning is enabled.

| Item | Final individual-trial decision |
|---|---|
| T01 coefficient table | Superseded by T02; do not count twice |
| T02 exact ratios | Retain |
| T03 sparse ranks / early rejection | Retain sparse traversal; decline additional zero-likelihood scan |
| T04 packed hand key | Retain |
| T05 forced-row support | Retain positive-support shortcut; decline extra Boolean-only variant |
| T06 reused weight buffer | Decline: negligible after stronger changes |
| T07 raw-prior batching / dense indexing | Retain hoisted lookup; decline dense-index variant |
| T08 faster hash | Decline: negligible after lookup hoisting |
| T09 fixed public storage / incremental evidence | Retain fixed storage; decline both incremental-evidence variants |
| T10 allocation-free actions / branch membership | Retain both; decline further suffix-result shortcut under the stated gate |
| T11 physical preparation / scorer cache | Retain prepared physical template; decline all three scorer-cache sizes |
| T12 suffix memo / admission | Decline 4k, 16k and zero-count-only variants |
| T13 earlier equivalent blocks | Decline constant-child and complete-block memo variants |
| T14 root preparation | Decline added architecture: measured residual ceiling about7ms |
| T15 indexed root histogram | Decline: about0.16ms saving per three-candidate opening |
| T16 fresh PGO / layout | Complete: retain model-specific PGO; exact outputs,7.24% fewer instructions and13.94% fewer cycles on three matched hands. Solver already owned; no locking migration needed. |
| T17 inner bounds / ordering | Decline both; skipped valuation does not repay overhead |
| P6 physical root bounds | Decline integration: zero candidates prunable on either full opening, even with an oracle incumbent |
| N1 demand-driven inner work | Decline measured variants. Follow-up isolated avoidable overhead; repaired fine variant still adds2.17% cycles/7.29% instructions. See diagnostic follow-up below. |
| N2 weighted uncertainty | Decline measured variants. Repaired exact bounds still add1.94% cycles/3.90% instructions to repaired N1; prior local-tolerance tests are not a global quality dial. See diagnostic follow-up below. |
| N3 paired refinement | Decline paired and priority variants: about31% and17% more cycles than their respective parents |

N1, N2 and N3 were ranked in that order ahead of generic cache/valuation work, with N2 depending on N1's deferred outcomes and N3 on N2's interval accounting. Each was measured separately. Positive-tolerance experiments remain archived and explicitly bounded only at each local decision; they are not a production speed/strength control.

## Strategy cost gates

| ID | Request | Status | Evidence / decision |
|---|---|---|---|
| S1 | Future suit/crib valuation | Complete: not cheap; declined | Full private suit/crib contexts did not meet the cheap-only gate; existing rank-hand and exact live-root counting remain intact. |
| S2 | Future own-discard awareness | Complete: not cheap; declined | 1,819 holds expand to164,995 contexts per role; one child table requires13.643GB. Decline under the speed/memory gate. |
| S3 | Condition future probabilities on predicted choices | Complete: not cheap; declined | Requires belief/policy consistency work; the old fixed-opponent shortcut changes the model. Decline as a cheap patch. |

## Requested performance items

| ID | Request | Status | Evidence / decision |
|---|---|---|---|
| P1 | Reuse posterior arithmetic | Complete: exact ratio/sparse-rank/packed-key/batched lookup changes retained | Retain exact ratios, sparse traversal, packed keys and hoisted lookups; reject the measured extra scan/hash/dense-row variants. |
| P2 | Skip forced-row valuation | Complete: support shortcut retained | Retain stopping at the first positive-support hand for a forced row. Further Boolean-only specialization did not repay its cost. |
| P3 | Indexed reusable score histograms | Complete: decline, measured saving negligible | Future inner histograms were already gone. Remaining root kernel saves only about0.16ms per three-candidate opening. |
| P4 | Fixed buffers / incremental history | Complete: fixed storage retained; incremental variants declined | Retain fixed public history; both full and gated incremental-likelihood variants failed the performance gate. |
| P5 | Share physical scoring and forced suffixes | Complete: physical template/iterator retained; memo variants declined | Retain prepared physical templates and action iteration; all scorer/suffix memo sizes and admission variants were declined. |
| P6 | Exact pruning | Complete: inner variants and root-bound feasibility declined | Exact inner variants added work; root endpoint bounds could prune no action on either complete opening. |
| P7 | Merge equivalent subproblems earlier | Complete: equality shortcut and block memo variants declined | Constant-child and complete-block equality variants did not pay for their checks and keys; none retained. |

## Full 20.x concept inventory

| Source | Incremental concepts reviewed | Applicability / trial |
|---|---|---|
| [model201-fast-hash](model201-fast-hash.md) | Fast full-key hashing | Trial T08: raw-prior maps currently use the generic hasher; compare a cheap full-key hasher, retaining equality. |
| [model201-cache-assessment](model201-cache-assessment.md) | Bypass cheap tails; 4x capacity; series-prefix normalization | T12: selective suffix memo admission. Capacity alone is not a gain; histories cannot be normalized across differing evidence. |
| [model201-cache-churn](model201-cache-churn.md) | Key padding; 1.5x/2x capacity; generations; replacement buckets; repeated-use admission; 3-card tail bypass | T12: use compact physical key and measure hit usefulness/cap variants. No action cache exists to resize; do not add LRU without evidence. |
| [model201-structural-cache](model201-structural-cache.md) | Zero-count boundary admission; separated pools | T12: compare all eligible suffixes versus zero-count admission; key includes counting context where decisions remain. |
| [model201-cache-stacking](model201-cache-stacking.md) | Gate ordering; tail restrictions; 200k/300k/400k limits | T03/T05: cheap rejection before arithmetic; T12 caps only after observing reuse. Nonbinding limits offer no speedup. |
| [model201-cache-throughput](model201-cache-throughput.md) | Fused hash; miss helper; alternate map; reuse miss hash | T08/T12. No dependency change unless a demonstrated repeated-hash bottleneck survives simpler prepacking. |
| [model201-engine-throughput](model201-engine-throughput.md) | Present-rank traversal; packed series scoring; impossible-run bypass; sparse depletion | T03 sparse ascending ranks, T10 allocation-free physical actions, T11 scoring reuse. |
| [model201-streamlining](model201-streamlining.md) | Checked internal entry; shared immutable assets; lazy crib context; rollout template | Already owned solver/shared assets/boundary prepare. T14 inspect root preparation cost and unnecessary old-policy setup; T11 physical base packing. |
| [model202-board-replay](model202-board-replay.md) | Rebuilt board utility | Strength/calibration input, already inherited. Not an exact speed optimization; no asset retraining in this task. |
| [model203-decline-smoothing-audit](model203-decline-smoothing-audit.md) | Smoothed full-support priors and decline evidence | Already inherited; preserve exact support and integer likelihoods in T03/T09. |
| [model203-exact-throughput](model203-exact-throughput.md) | Small-deck binomial specialization; rejected normalize-once | T01 exact coefficient table; T02 exact depletion-ratio table. Do not replace division with reciprocal/reassociate products. |
| [model203-denominator-reuse](model203-denominator-reuse.md) | Fixed evidence denominators; rejected scratch variants | T02 table of exact small ratios; T06 reusable per-row weights. |
| [model203-series-scoring](model203-series-scoring.md) | Full-key direct-mapped series scorer; 64KiB through 1MiB sizing | T11 score-only memo with size variants if baseline physical scoring remains material. |
| [model203-observation-overhead](model203-observation-overhead.md) | Packed key hashing; reusable observation storage | T04 cached hand pack, T08 fast hashing, T09 fixed public history, T10 fixed action storage. |
| [model203-forced-choice](model203-forced-choice.md) | Separate action-only forced rank from full valuation | Live action-only path inherited. P2/T05 extends inner forced-row shortcut to posterior support without full weighting. |
| [model203-downstream-reuse](model203-downstream-reuse.md) | Live-vs-inner distinction; cross-turn retention; convergence memo | Do not substitute inner action for root valuation. T12 decision-local physical sharing; cross-live persistent actions excluded by ADR. |
| [model203-action-cache-churn](model203-action-cache-churn.md) | Role-only admission; partitions; generations; LRU | Architecture already chooses once per own-hold group and has no hot action-cache churn. T12 caches arithmetic only; avoid adding absent cache machinery. |
| [model203-obsolete-opening-work](model203-obsolete-opening-work.md) | Cancel forfeit/obsolete background work | Existing API lifecycle inherited; no obsolete jobs created by this serial solver. No new performance trial warranted. |
| [model203-selected-action-review](model203-selected-action-review.md) | Forecast only requested rank; share review preparation | forecast_conditioned already accepts requested actions. T14 check duplicate setup; no second all-action scan to remove. |
| [model203-compiler-tuning](model203-compiler-tuning.md) | Fresh PGO; Mac native CPU tuning; separate server tuning | T16 fresh 28.3-specific PGO after algorithm winners. Existing 20.x profile does not prove new-engine performance; no server deployment. |
| [model203-posterior-batching](model203-posterior-batching.md) | Shared arithmetic in batches8/32/128; duplicates grouped before policy | T07 reuse per-other raw lookup/likelihood work across own rows; preserve rank/world accumulation order. Grouping already intrinsic. |
| [model203-observation-groups](model203-observation-groups.md) | Complete legal-observation grouping before reconstruction | Already intrinsic public block + own hand. T13 early structural equivalence; never collapse distinct own private contexts just because scores match. |
| [model203-throughput-review](model203-throughput-review.md) | Denominators; scratch; scorer; keys; broader joint-world work | Covered by T01–T12; no duplicate standalone trial. |
| [model204-version-boundary](model204-version-boundary.md) | Freeze historical models | Keep every change in28.3; existing20.x code paths untouched. |
| [model205-root-preparation](model205-root-preparation.md) | Validate root/world once; prepared representation | Public prepare already once. T14 quantify residual root preparation; no per-world observations exist here. |
| [model205-invariant-evidence](model205-invariant-evidence.md) | Retain cut/ownD constraints in evidence | Cut already global and compat checked first. S2 separate futureD expansion; never apply actual rootD to opponent hypothetical groups. |
| [model205-early-weight-rejection](model205-early-weight-rejection.md) | Reject incompatible counts and hard-zero likelihoods early; active lanes | T03/T05 exact support check; compare dense13 and sparse rank variants. Physical compatibility already first. |
| [model205-continuation-bases](model205-continuation-bases.md) | Pack physical state once per evidence hand | T04 reuse hand packing, T11 prepare common physical Position portion once per block. |
| [model205-outer-rollout](model205-outer-rollout.md) | Reusable vectors; rank masks; direct rank scoring | T06 weight buffer, T09 public storage, T10 branches/actions; direct rank scorer already used. |
| [model205-incremental-history](model205-incremental-history.md) | Incremental views and resumable likelihoods | T09. Public tree permits direct parent-to-child summaries but exact soft-decline/Go/reset semantics must be retained; benchmark simpler fixed event buffers first. |
| [model205-empirical-layout](model205-empirical-layout.md) | Compact hand IDs; rank masks; denominators; packed availability | T04 packed hands, T07 indexed/prepared prior rows. Compatibility already packed nibble comparison. |
| [model205-bounded-maps](model205-bounded-maps.md) | Indexed score histograms and utility memo | P3/T15 root histogram replay. Future inner histogram already eliminated; after-hands utility already direct128x128. |
| [model205-owned-solver](model205-owned-solver.md) | Owned mutable solver vs Arc/Mutex adapters | Already owned &mut Solver. Immutable assets/rows shared, no per-choice policy mutex. No redundant migration trial. |
| [model205-modern-owned](model205-modern-owned.md) | Dedicated modern entry and duplicate conversion removal | Same architectural benefit already present; T14 entry preparation only. |
| [model205-layout-rounds](model205-layout-rounds.md) | Box/alignment; freshPGO vs reused-profile layout | T16 compiler/layout if credible after hot-path changes. Do not claim earlier117ms transfers. |
| [model205-timing-discrepancy](model205-timing-discrepancy.md) | Unchanged binary scheduling controls | Protocol: serial alternating pairs, hardware counters, matched core shares; CPU seconds alone are not fixed-core normalization. |
| [model205-owned-generalization](model205-owned-generalization.md) | Broader ownership/alignment/whole-hand checks | Protocol: complete-hand checks and held-out cases; no automatic adoption from one opening. |
| [model205-pruning-bounds](model205-pruning-bounds.md) | Cheap ranges; direct clairvoyant maxima; endpoint sets; conditional retention; ordering | T17 exact group utility bound/ordering. Architectural postorder child costs may leave little pruneable work; test valuation savings separately from tree pruning. |
| [model206-version-boundary](model206-version-boundary.md) | Direct bounds/order, forced-loop and suit-count class improvements | T10/T11/T17. Do not invoke a different continuation policy to gain pruning. |
| [model207-conditional-crib](model207-conditional-crib.md) | Joint conditional discard ranks/suited rates for root crib | Already inherited and improved with joint hold/peg association at live root. S1 considers future valuations, with full private-information cost distinction. |
| [model207-observation-simplification-assessment](model207-observation-simplification-assessment.md) | Remove duplicate adapters/validation; approximate-versus-exact observations | New internal solver already avoids those adapters; keep external validation. T14 only where actual redundant work remains. |
| [model207-small-observation-opportunities](model207-small-observation-opportunities.md) | Legal-rank iterator; immediate tie score; action validates itself; cache-hit validation; direct cut index; batched locks | T10 rank actions/tie score; no action-cache hit or likelihood-cache lock here. Cut fixed per Solver, already implicit. |
| [model207-observation-trials](model207-observation-trials.md) | Measured small observation variants; only rank iterator retained | T10 retest concept innewarchitecture rather than transferring former percentage. |
| [model207-version-boundary](model207-version-boundary.md) | Historical model freezing | Model28.3-only changes; no20.x model behavior/asset updates. |

## Trial queue and results

The inventory is complete at concept level. Queue: T01 binomial specialization; T02 exact ratio table; T03 sparse ranks / hard-zero rejection; T04 packed hand key; T05 forced-row support shortcut; T06 weight-buffer reuse; T07 prepared/indexed prior rows or batching; T08 fast full-key hashing; T09 fixed public history then incremental likelihoods; T10 fixed branches/actions and mask enumeration; T11 physical preparation and score memo; T12 bounded suffix memo/admission variants; T13 earlier proven equivalence; T15 remaining histograms; T17 exact group bounds/ordering; T14 residual root preparation; T16 fresh PGO/compiler/layout. Stronger apparent effects first; already intrinsic/inapplicable items require no synthetic replacement just to manufacture a trial.

### Ranked additions requested during the assessment

These extended the original assessment. Existing wave2 measurements stayed frozen; the new concepts were then implemented and compared separately, one concept at a time. The table records their priority when added and their completed decisions.

| Rank among remaining concepts | ID | Concept | Status / initial experiment |
|---|---|---|---|
| 1, after confirming the already measured posterior/forced-row gains | N1 | Calculate inner action values only as needed | Complete: both granularities declined after exact parity and speed tests. Prepare posterior weights before expensive continuations; compare coarse deferred child tables and finer deferred physical suffix cells. Preserve complete legal-information domains. Do not reintroduce recursive belief-world reconstruction or a retained path graph. |
| 2, immediately after N1 and before generic cache/valuation micro-optimizations | N2 | Total probability-weighted uncertainty budget | Complete: exact and four tolerance settings tested; decline production integration. Sum `p × (upperWP − lowerWP)` across all unresolved contributions. Exact mode must prove the winner, including floating-point/tie safeguards. Then assess explicitly opt-in positive tolerances as an experimental speed/quality control. |
| 3, after the interval machinery in N2 and before simple ordering-only variants | N3 | Jointly refine competing moves on the same hypothetical hands | Complete: paired and priority variants declined after exact parity and speed tests. Race candidate intervals and evaluate paired differences where useful. Cancellation requires a proved shared contribution; overlapping marginal intervals alone do not prove it. Compare against the same retained parent configuration. |

N1–N3 belong ahead of the old T17 valuation-only bound/ordering in conceptual priority because they may avoid *generating* outcomes, rather than merely skipping arithmetic over outcomes already built. The running smaller tests still provide needed primitives and controls, and are preserved.

**N2 safety distinction:** zero tolerance is the normal default. A positive tolerance can bound local expected-action loss under a fixed continuation policy; applying that tolerance independently at many future information groups does **not**, by itself, establish a root or whole-game strength-loss bound. Any experimental dial must state exactly which quantity it certifies and track aggregate unresolved uncertainty rather than imposing separate unaccounted per-branch thresholds. No positive tolerance will be silently enabled for28.3.

**Primary reference:** Bruce W. Ballard, [The *-minimax search procedure for trees containing chance nodes](https://doi.org/10.1016/S0004-3702(83)80015-0), Artificial Intelligence21(3),1983,327–350; [paper PDF](https://www.cs.uleth.ca/~benkoczi/3750/data/ballard83-star_alpha_beta.pdf). Its chance-node bounds motivate N2. The paper explicitly treats perfect information; applying bounds here must preserve our actor-specific legal-information grouping. Its published speedups are not estimates for this engine.

All individual items now have measured results or a concrete structural exclusion below. The clean native and fresh-PGO gates passed for the nine retained changes.

## Strategy cost assessment

- **S1 assessed, full future suit/crib contexts declined under cheap-only gate.** Root suits/crib are already exact. Future rank show is now included. Four suit counts plus starter suit and right-jack bit score a *known* keep cheaply; they do not provide the probability of each actor's privately known suit class or correlate that class with compatible opposing cards/discards. For example, a four-card flush adds4/5 and may alter a near-121 choice; averaging that bonus before maximizing is a different, less-informed policy. Full conditional crib also depends on ownD (S2). No inexpensive full repair has been established. Keep the present generic future crib expectation; no new approximation is substituted. Evidence: `model283-private-contexts-20261003.md`, `model283-compact-counting-20261003.md`, current `Hand::show`/`valuation_key`/`after_hands` versus live-root `model283_counting.rs`.
- **S2 assessed, dense future ownD expansion declined.** Known rootD already depletes the root posterior. Full future ownD needs independent decisions for `(keep,ownD)`: 1,819 keeps become164,995 contexts/role (90.706 variants/keep). One opening child requires6,821,553,280 two-byte cells=13.643GB; all children54.45GB. Earlier controlled small case increased273 cells to2,235,633, and~0.00075 CPU s to4.49–6.18s. A lazily split decision group still needs distinct weights and potentially distinct child choices, so cannot claim those variants disappear merely through dead-card filtering. Preserve archived rejected implementation; no repeat of known oversized allocation. A fundamentally sparse factored strategy representation remains research, not a cheap patch.
- **S3 assessed, symmetric choice-conditioned beliefs declined as a cheap patch.** The old fixed-opponent experiment could propagate reach weights because its opponent choices were fixed independently. Here both players' later choices depend on beliefs about earlier choices that the backward sweep has not selected yet. Retrospectively filtering earlier actions changes those later beliefs and may change the supposedly settled actions. Reusing the old trick requires either a fixed reference strategy (changes the requested model) or a policy/belief consistency iteration with convergence/cost tests. Multiplying existing soft-decline evidence by predicted-choice likelihoods also risks double-counting evidence. No such approximation is enabled.

These are completed cost/architecture assessments, **not implementations or proof that future compact solutions are impossible**. User's cheap-only condition is not met. Performance trials below preserve the current28.3 policy exactly.

### Wave1 — exact posterior/forced-row screening (complete)

Frozen job: `/private/tmp/cribbage-model283-optimization-sweep-20261004/job-wave1-v1.json`; one supervisor, KeepAlive=false. Baseline and each candidate use the same test binary and test-only switches; normal production path remains unchanged. First screen compares each candidate separately against baseline, serially; acceptance and stacking require subsequent confirmation. Source: `wave1-source/`. New fixture seed **17230515059346524839**; three historical replays plus three newly generated held-out deals. Initial screen uses historical fixture0 and new close-race fixture5 in opposite orders.

| Bit | Trial | Status |
|---|---|---|
|1|T01 exact 5x5 binomial table|Screen complete; superseded candidate, not activated|
|2|T02 precomputed exact numerator/denominator ratio table|Screen complete; cumulative confirmation pending|
|4|T03 ascending occupied ranks only (omit multiplication by1)|Screen complete; cumulative confirmation pending|
|8|T04 update packed remaining-hand key on each play|Both screens complete; cumulative candidate|
|16|T03 variant: hard-zero likelihood rejection before arithmetic|Declined: extra scan increases work|
|32|T05 forced row: stop after finding positive posterior support|Both screens complete; cumulative candidate|
|64|T06 reuse weight-vector capacity across own rows|Declined: below1% gate alone and stacked|
|128|T07 hoist other-hand raw prior lookups outside own-row loop|Both screens complete; cumulative candidate|

No variants are accepted yet. Same-binary screening controls compiler layout but includes experimental branches; retained winners require a clean normal build check. Exact reference tests cover all variants and their combination; no posterior order, support, root value or decision rule is intentionally changed.

Wave1 setup correction1: the new exhaustive weight test reached a zero-opponent-card suffix and queried an empirical row that is intentionally absent; production uses the suffix solver there. Corrected the test to skip that unavailable query, retaining actual positive-card states, Go/soft evidence and all bit comparisons. No measured runs had begun. Original build/source/log are preserved in `setup-correction-1`; same job rebuilt because test source changed.

### Additional commit-level audit

Checked the engine history as well as the research reports. Additional20.3 incremental changes are already inherited: packed/indexed belief asset rows and immutable Arc sharing (`5af5116`), skipping legacy prior loading and unused decline rows (`a7e38e0`), deriving crib means directly from histograms (`b3fa00f`), rank-only show scoring cached once per process (`6e2c46c`), and consolidating discard evidence in a packed asset (`9cd4753`). The new solver loads the shared assets once and already stores each initial hold's rank show. No equivalent disk-to-RAM migration is missing from the search. Iterator-based raw-row loading is preserved; the repeated in-solve lookup is covered by T04/T07/T08.

20.6's additional forced-loop and suit-class work is also accounted for: physical suffixes already run in a while loop; T10 removes their action-vector allocations and repeated selected-suffix traversal. Exact live-root suit classes are already used by28.3's joint counting. Prebound-role and dedicated one-/two-card evaluators were rejected historically; they remain possible variants only if the new suffix profile warrants them.

Ten combinations of the first-wave switches (including all together) passed the bounded independent backward-reference test in the first compiled binary. The new exhaustive posterior test is rebuilding after its zero-card fixture correction. No speed result is claimed from correctness timing.

### T01 binomial table — screen complete; defer adoption

Exact full-distribution/decision/value parity passed on historical opening0 and fresh held-out opening5, in opposite variant orders. No variant activated. These are single-pair screens, not a confidence interval.

| Fixture | CPU seconds baseline→candidate | Wall seconds baseline→candidate | Instruction reduction | Cycle reduction |
|---|---|---|---|---|
| 0 | 66.989419→70.391981 | 109.560116→111.404690 | 2.940% | 5.190% |
| 5 | 66.201926→71.746268 | 113.490724→114.732038 | 3.913% | 5.931% |

Both runs used efficiency cores. CPU seconds worsened despite fewer instructions/cycles; clock/scheduling differences prevent an established latency-gain claim. Do not activate independently. T02 is a stronger arithmetic alternative; eventual combination must earn a repeatable incremental gain. Evidence: `screen-1.comparison.json` and named resources/results.

### Later-wave screening protocol refinement

Wave1 retains its original full-opening comparisons. For the larger second-wave queue, first screen **one complete lead-candidate continuation tree** per fixture, selected by a fixed recorded action index, not by its timing or outcome. This still runs the complete legal-information subtree without sampling/depth limits. It shortens preliminary screening by2–4x; its times must **not** be labeled complete pone-opening latency or complete decisions. Every winning cumulative implementation still requires full-opening and full-hand confirmation against the frozen model. Test output explicitly records `partialRootActionIndex`; single-action selected values are only that candidate's forecast. Serial matched ordering, exact conditioned outcomes and weights, CPU/instructions/cycles/core records remain required.

T09's incremental likelihood prototype now uses a bounded depth-first stack of public-history summaries. It does not enlarge/clonemultiply every Position or retain a path graph. Both full updating and skipping unused terminal/physical-only suffix summaries will be compared. Independent checks compare every retained likelihood vector to the existing native full-history arithmetic.

### T02 exact ratio table — screen complete; confirmation candidate

Exact complete forecast/value/decision parity passed on both openings. Precomputing the exact division result removes arithmetic without replacing it by a reciprocal. No implementation activated yet.

| Fixture | CPU seconds baseline→candidate | Wall seconds baseline→candidate | Instruction reduction | Cycle reduction |
|---|---|---|---|---|
| 0 | 38.277091→59.719664 | 65.360433→94.571236 | 5.341% | 3.744% |
| 5 | 142.223093→132.339162 | 222.260379→205.052043 | 6.305% | 3.196% |

All samples used efficiency cores, but effective clocks varied strongly. Keep T02 for cumulative confirmation based on reduced work in both cases; do not infer a wall-latency percentage from these pairs. It supersedes T01's run-time coefficient division rather than stacking the two as independent wins. Evidence: `screen-2.comparison.json`.

### T03 occupied-rank traversal — screen complete; retain for cumulative confirmation

Exact full forecast/weight/value/decision parity passed in both complete openings. Ascending occupied ranks retain the original nontrivial multiplication order; omitted ranks multiply by exactly1. No policy change.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instruction reduction | Cycle reduction |
|---|---|---|---|---|
| 0 | 83.558888→66.290557 | 126.212294→105.181642 | 18.734% | 18.718% |
| 5 | 136.946632→115.620736 | 143.643008→157.810766 | 21.414% | 19.456% |

Clock drift still affects elapsed CPU and wall samples; the repeatable instruction/cycle reductions justify advancing this variant to full cumulative confirmation, not claiming universal latency percentages. Evidence: `screen-4.comparison.json`.

Prepared T13 stronger variant: a bounded256-entry memo can recognize a complete equivalent score block before rebuilding its children. Its key keeps ordered full domains, original show counts, both public likelihood vectors, played counts, count/current series, actor/go/last and both board scores. Cut/assets/factors are fixed by the Solver. The two likelihood summaries are sufficient for subsequent updates only with these public fields and complete domains; equal immediate scores alone never qualify. Diagnostic all-observation books bypass this cache. This is a decision-local output memo, not a retained path graph. It remains **unbuilt/untested**, as do the other wave2 prototypes.

### T04 prepacked hand keys — screen complete; small-gain confirmation candidate

Exact full forecast/value/decision parity passed.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 84.712676→82.949704 | 87.794973→96.889008 | 1.562% | 1.508% |
| 5 | 137.757770→143.037360 | 254.299157→255.408017 | 1.929% | 1.316% |

Only a small reduction in work is established. Both variants contain the extra packed Hand field in this test binary, so final normal-build confirmation must include its storage/update cost relative to the original frozen engine. T11 may also reuse it for physical preparation. Do not activate solely on this screen. Evidence: `screen-8.comparison.json`.

### Scheduling and cumulative screening gate for wave2

Wave1 remains unchanged and serial. The larger wave2 queue will use **two independent single-threaded fixture pairs concurrently**, one optimization family at a time. Each fixture performs parent/candidate sequentially; the two fixtures use opposite orders. This uses spare CPU capacity without altering the six unrelated workers. Final full-opening/full-hand confirmation remains serial. Concurrent screen timings are explicitly not predicted live UX latency.

To advance a provisional cumulative experimental baseline between queued screens, require exact semantic parity, at least1% aggregate instruction and cycle reduction, no fixture with more than2% added cycles, comparable core-type shares (difference≤2percentage points), and no unbounded/material memory growth. This is a **screening gate**, not final adoption; borderline or hardware-confounded results remain documented/inconclusive and can receive one bounded variant/confirmation where justified. Final clean-source tests and serial native performance decide retention. Record the parent mask and resulting mask for every trial so gains cannot be relabeled against a different baseline. Do not automatically activate switches in the normal engine.

First-wave results plus the candidate's structural cost determine which variants enter cumulative confirmation; redundant alternatives (T01 versus T02) are not counted twice. Prepared but untested variants remain pending.

<!-- wave1-final-16 -->
### T03 early hard-zero rejection — decline at isolated screen

Complete-opening, exact float-bit conditioned forecast/value/decision parity passed on both fixtures. No normal-source activation.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 86.581086→81.552454 | 165.575331→153.948234 | -1.179% | -3.276% |
| 5 | 133.729557→121.809818 | 253.561766→210.988058 | -1.380% | -3.205% |

Evidence: `screen-16.comparison.json`. CPU/wall drift must not override consistently increased or reduced computational work; all samples used efficiency cores.
The existing domains already reject impossible public-Go holdings, so an extra per-pair likelihood scan generally repeats that rejection. Decline this variant; its apparently lower CPU time is contradicted by higher instruction and cycle counts.

### Wave2 queued after wave1

One-shot job `job-wave2-v1.json` now waits for the complete first-wave supervisor status and all eight exact-parity receipts. It then builds the frozen source and runs correctness before any performance screens. No compilation competes with first-wave timings. The 28 comparison variants are saved in `wave2-plan.json`; each stage records its immutable parent configuration, exact floating-point comparisons and provisional decision immediately in this ledger. Two independent fixture pairs use the available background capacity. A post-result rendezvous captures final hardware counters before process exit; this wait is outside search timing and is not a solve timeout. The screen memory gate is at most32MiB additional physical footprint per fixture.

Additional T07 variant: compact combinatorial hand IDs replace remaining-hold prior hash rows with bounded direct-indexed arrays (at most1,820 doubles for four ranks,455 for three). This changes storage only; cardinality and bit-exact prior-row checks precede timing. It is tested after hoisted lookups and fast hashing, so their savings cannot be counted twice. If retained, unused map/hasher machinery will be removed from the final implementation.

<!-- wave1-final-32 -->
### T05 positive-support forced-row shortcut — advance to cumulative confirmation

Complete-opening, exact float-bit conditioned forecast/value/decision parity passed on both fixtures. No normal-source activation.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 79.310589→66.423886 | 149.253808→113.479067 | 17.600% | 18.461% |
| 5 | 147.958787→113.675975 | 319.196023→198.984891 | 21.594% | 22.211% |

Evidence: `screen-32.comparison.json`. CPU/wall drift must not override consistently increased or reduced computational work; all samples used efficiency cores.

<!-- wave1-final-64 -->
### T06 reusable weight buffer — decline at isolated screen

Complete-opening, exact float-bit conditioned forecast/value/decision parity passed on both fixtures. No normal-source activation.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 75.343163→53.206823 | 152.024332→95.021140 | 0.732% | 1.051% |
| 5 | 63.764129→64.229855 | 120.123438→117.729374 | 0.530% | 0.784% |

Evidence: `screen-64.comparison.json`. CPU/wall drift must not override consistently increased or reduced computational work; all samples used efficiency cores.

### Semantic safeguards for the larger trials

- Posterior ratios retain the exact original division results and ascending order of nontrivial multiplications. No reciprocal approximation, normalize-once reassociation or likelihood-product regrouping is introduced.
- The Boolean forced-row support test is valid because raw empirical weights are integer counts and compatible four-card depletion/likelihood factors cannot underflow: a positive product is at least `(1/256) × (1e-6)^4`. Physical incompatibility, absent/zero raw counts and hard-zero rank likelihoods are still rejected. Synthetic finite-prior tests use their original direct positivity rule.
- Physical suffix sharing is limited to states with no contested choice: one player is empty, or both have at most one card. A memo key retains both complete remaining hands, ordered current series, count, actor/Go/last, board scores and original rank shows whenever a choice remains. It never substitutes clairvoyant pairwise choices at contested nodes.
- Incremental likelihoods use the existing integer decline helpers, preserve the soft-positive floor, hard-Go zeros, observed-rank reset and opponent play ordinal. Every retained history prefix in the independent check is compared with the native full-history interpreter.
- Group bounds use total posterior mass across the whole legal information group. Pruning requires a strict disadvantage beyond a conservative floating-point allowance; tied candidates remain eligible for the existing points/rank tie rule. This can save valuation work, but cannot retrospectively remove child tables already computed by the postorder architecture.
- Complete-block memoization requires equal ordered private-hold domains and all downstream-relevant public/likelihood/counting fields. Its equivalence is specific to this existing policy; it does not assert that arbitrary different histories would be strategically equivalent for a richer policy.

These arguments accompany exact output tests; none licenses changing the model's beliefs, smoothing, counting utility or information boundary to obtain a speed result.

<!-- wave1-final-128 -->
### T07 shared raw prior lookups — advance to cumulative confirmation

Complete-opening, exact float-bit conditioned forecast/value/decision parity passed on both fixtures. No normal-source activation.

| Fixture | CPU baseline→candidate | Wall baseline→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 59.120094→67.571649 | 113.774960→132.029772 | 6.225% | 9.302% |
| 5 | 125.659018→109.018233 | 235.153120→210.377651 | 7.118% | 10.916% |

Evidence: `screen-128.comparison.json`. CPU/wall drift must not override consistently increased or reduced computational work; all samples used efficiency cores.

<!-- preparation-ceiling -->
### T14 preparation ceiling — measured

100 repetitions: policy preparation 0.0004476899999999999 CPU s, public preparation 0.0005693300000000002 CPU s, solver utility-table preparation 0.00599897 CPU s per call. Compare this ceiling with measured search before deciding whether a new entry abstraction is justified. Evidence: `preparation-cost.json`.

<!-- histogram-kernel -->
### T15 indexed root histogram kernel — measured

Exact accumulation/normalization bit parity on nine retained candidate distributions. Mean CPU per nine candidate rows: BTreeMap 0.0006114358333333333 s, reusable indexed storage 0.00012184999999999995 s. This is only remaining root aggregation; future group histograms were already eliminated. Full-search impact must be bounded before adoption. Evidence: `histogram-summary.json`.

<!-- w2-sparse -->
### T03 cumulative sparse rank traversal — provisional cumulative advancement

Parent mask0 → candidate mask4. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 43.702706→31.956731 | 45.252183→33.854723 | 17.820% | 19.169% |
| 5 | 37.038649→29.888986 | 39.183131→30.988667 | 20.979% | 22.691% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-sparse.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-ratios -->
### T02 cumulative exact ratio table — provisional cumulative advancement

Parent mask4 → candidate mask6. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 35.011504→33.476453 | 36.578716→34.813576 | 2.072% | 1.657% |
| 5 | 29.944768→29.486422 | 31.271779→30.614118 | 2.365% | 3.087% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-ratios.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-prior-batch -->
### T07 cumulative shared prior lookups — provisional cumulative advancement

Parent mask6 → candidate mask134. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 36.488546→33.137622 | 38.060485→34.093981 | 8.486% | 12.056% |
| 5 | 32.135786→27.406353 | 33.414005→28.440339 | 10.388% | 14.430% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-prior-batch.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-forced -->
### T05 cumulative forced-row support — provisional cumulative advancement

Parent mask134 → candidate mask166. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 32.078034→31.433986 | 33.190957→42.088824 | 5.232% | 3.114% |
| 5 | 27.251214→26.176172 | 35.685501→27.056268 | 7.302% | 7.713% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-forced.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-forced-support -->
### T05 exact Boolean support variant — decline or inconclusive at screen

Parent mask166 → candidate mask16777382. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 29.118483→30.123802 | 42.943507→41.006857 | 0.101% | 0.315% |
| 5 | 24.617258→24.832276 | 34.374019→36.497264 | 0.257% | 0.449% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-forced-support.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

### T14 decision: decline further entry/preparation refactoring

Measured policy preparation0.448ms, public preparation0.569ms and utility-table preparation5.999ms per call (100 repeats). Their combined ceiling is about7.0ms against openings taking tens of CPU seconds. The present architecture already owns its mutable solver and prepares public domains once. A new preparation/ownership abstraction is not justified by this measured ceiling. No production change.

### T15 decision: decline indexed root histogram integration

The exact-order kernel improved from0.611ms to0.122ms for **nine** candidate distributions, saving about0.490ms total, or roughly0.16ms for a three-candidate opening. The improvement is real at the kernel level but negligible on the critical path, and adds scratch storage/reset machinery. Keep the simpler existing root histogram. Future inner histograms were already removed before this task; there is no second large histogram cost to eliminate. No production change. Exact float-bit parity passed the retained nine-distribution corpus.

<!-- w2-pack -->
### T04 cumulative prepacked hand key — provisional cumulative advancement

Parent mask166 → candidate mask174. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 30.080847→31.418409 | 45.443636→43.433832 | 1.257% | 1.336% |
| 5 | 25.766367→24.965456 | 38.731816→37.177725 | 1.535% | 1.120% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-pack.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-weights -->
### T06 cumulative weight buffer — decline or inconclusive at screen

Parent mask174 → candidate mask238. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 29.397148→27.571536 | 41.034855→43.522766 | 0.467% | -0.103% |
| 5 | 22.092233→24.638469 | 37.268390→33.735814 | 0.850% | 2.258% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-weights.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-iterator -->
### T10 allocation-free physical actions — provisional cumulative advancement

Parent mask174 → candidate mask430. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 27.864032→18.180255 | 47.958244→28.495162 | 36.914% | 20.954% |
| 5 | 21.114053→18.738182 | 34.996922→31.786066 | 35.047% | 18.866% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-iterator.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-endpoint -->
### T10 reuse already-solved uncontested endpoint — decline or inconclusive at screen

Parent mask430 → candidate mask942. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 9.000442→18.363990 | 20.176439→28.908009 | -3.373% | 4.129% |
| 5 | 12.700496→7.511103 | 21.832289→17.218596 | -3.756% | 1.490% |

Screen gate not met: aggregate instruction gain below1%. No production activation.
Evidence: `w2-endpoint.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-template -->
### T11 physical state template — provisional cumulative advancement

Parent mask430 → candidate mask16814. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 24.754453→21.461661 | 35.619185→30.458153 | 6.609% | 9.715% |
| 5 | 21.215481→18.994721 | 31.554910→26.719714 | 7.140% | 9.485% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-template.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-branches -->
### T10 fixed four-branch row storage — provisional cumulative advancement

Parent mask16814 → candidate mask17838. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 22.751402→21.771966 | 34.300468→31.464805 | 1.609% | 0.980% |
| 5 | 19.812220→19.272452 | 29.070203→28.533563 | 1.944% | 1.282% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-branches.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-constant -->
### T13 identical complete endpoint children — decline or inconclusive at screen

Parent mask17838 → candidate mask19886. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 22.402204→22.145838 | 33.374441→30.552953 | -0.060% | -0.039% |
| 5 | 19.300335→19.016858 | 26.752854→28.866241 | 0.091% | 0.049% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-constant.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-series-16k -->
### T11 full-key score memo 128KiB — decline or inconclusive at screen

Parent mask17838 → candidate mask542126. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 16.591079→19.339087 | 27.375187→29.847327 | 2.034% | -0.220% |
| 5 | 19.564818→13.316059 | 28.948525→22.831797 | 1.928% | -1.106% |

Screen gate not met: aggregate cycle gain below1%. No production activation.
Evidence: `w2-series-16k.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-series-1k -->
### T11 smaller score memo 8KiB — decline or inconclusive at screen

Parent mask17838 → candidate mask542126. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 19.935854→20.148118 | 30.343277→31.511133 | -0.193% | 0.047% |
| 5 | 17.148112→17.019985 | 26.393879→26.371931 | -0.038% | 0.756% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-series-1k.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-series-128k -->
### T11 larger score memo 1MiB — decline or inconclusive at screen

Parent mask17838 → candidate mask542126. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 21.805855→22.354131 | 31.800476→31.048047 | 3.477% | -3.104% |
| 5 | 18.610359→19.129184 | 26.806375→28.333951 | 2.460% | -1.496% |

Screen gate not met: aggregate cycle gain below1%; fixture0 cycles regress more than2%. No production activation.
Evidence: `w2-series-128k.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-stack-events -->
### T09 stack mapped public history — decline or inconclusive at screen

Parent mask17838 → candidate mask26030. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 22.491328→21.471838 | 34.382140→30.053071 | 0.187% | 0.295% |
| 5 | 18.001681→19.243414 | 28.069459→28.660893 | 0.014% | 0.225% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-stack-events.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-fixed-history -->
### T09 fixed-capacity public history — provisional cumulative advancement

Parent mask17838 → candidate mask2114990. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 22.789700→20.139282 | 33.541960→30.168875 | 1.118% | 0.633% |
| 5 | 17.413666→19.442450 | 26.335468→27.705513 | 1.397% | 1.625% |

Advances only within the experimental cumulative baseline; clean normal-source full-opening/full-hand confirmation is still required.
Evidence: `w2-fixed-history.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-incremental -->
### T09 incremental likelihood summaries — decline or inconclusive at screen

Parent mask2114990 → candidate mask2377134. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 16.095682→20.225362 | 40.171035→30.453347 | -0.060% | 0.585% |
| 5 | 15.241460→14.427641 | 39.327644→22.871330 | 0.163% | 0.525% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-incremental.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-incremental-gated -->
### T09 skip unused suffix likelihood summaries — decline or inconclusive at screen

Parent mask2114990 → candidate mask3425710. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 21.601590→19.649182 | 33.589552→32.410671 | 0.194% | -0.255% |
| 5 | 16.168748→18.767257 | 26.374841→29.867816 | 0.325% | 0.804% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-incremental-gated.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-suffix -->
### T12 bounded physical suffix memo — decline or inconclusive at screen

Parent mask2114990 → candidate mask2147758. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 20.950824→36.963597 | 30.892915→53.751448 | -81.567% | -73.685% |
| 5 | 17.948258→30.289174 | 27.237325→44.002069 | -78.400% | -69.195% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%. No production activation.
Evidence: `w2-suffix.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-suffix-zero -->
### T12 zero-count suffix admission — decline or inconclusive at screen

Parent mask2114990 → candidate mask2213294. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 15.378935→20.028033 | 29.057645→30.588824 | -0.201% | 0.887% |
| 5 | 16.916560→11.728637 | 24.732087→24.296362 | 0.285% | -0.996% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-suffix-zero.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-suffix-16k -->
### T12 larger suffix memo — decline or inconclusive at screen

Parent mask2114990 → candidate mask2147758. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 21.925075→33.258485 | 31.905825→48.148870 | -72.671% | -66.863% |
| 5 | 17.122589→28.476075 | 25.466159→42.965480 | -62.630% | -57.901% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%. No production activation.
Evidence: `w2-suffix-16k.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-hash -->
### T08 full-key fast prior hasher — decline or inconclusive at screen

Parent mask2114990 → candidate mask2246062. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 20.754156→10.032429 | 32.096718→17.214314 | 0.598% | 0.664% |
| 5 | 11.185759→17.231048 | 18.015969→27.378327 | 0.458% | 0.952% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-hash.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-dense-priors -->
### T07 bounded direct-indexed prior rows — decline or inconclusive at screen

Parent mask2114990 → candidate mask69223854. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 9.603816→19.350723 | 17.948768→28.115261 | 0.348% | 1.837% |
| 5 | 16.618655→6.770561 | 25.293451→12.642456 | 0.835% | 0.285% |

Screen gate not met: aggregate instruction gain below1%. No production activation.
Evidence: `w2-dense-priors.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-block -->
### T13 bounded complete-block equivalence memo — decline or inconclusive at screen

Parent mask2114990 → candidate mask35669422. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 20.238344→17.696543 | 32.047794→24.713461 | -0.110% | -1.977% |
| 5 | 14.550292→17.551348 | 19.724467→29.047301 | -0.598% | -2.479% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%; fixture5 cycles regress more than2%. No production activation.
Evidence: `w2-block.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-block-summaries -->
### T13 equivalent block with incremental summaries — decline or inconclusive at screen

Parent mask2114990 → candidate mask36980142. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 18.795465→17.845316 | 27.758367→25.167342 | 0.059% | -1.401% |
| 5 | 17.656252→16.032732 | 23.976865→24.394458 | 0.054% | -1.445% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%. No production activation.
Evidence: `w2-block-summaries.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-bounds -->
### T17 group-wide proven utility bound — decline or inconclusive at screen

Parent mask2114990 → candidate mask2119086. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 17.357072→17.512362 | 25.166185→24.307505 | -2.026% | -2.616% |
| 5 | 15.361670→14.954931 | 22.273875→20.603920 | -2.086% | -1.528% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%; fixture0 cycles regress more than2%. No production activation.
Evidence: `w2-bounds.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

<!-- w2-order -->
### T17 ordering with proven bound — decline or inconclusive at screen

Parent mask2114990 → candidate mask10507694. Exact conditioned probabilities, endpoints, values and selected candidate outputs match bit-for-bit. Fixed action0 only; these are two concurrent subtree screens, **not complete opening latency**.

| Fixture | Search CPU parent→candidate | Search wall parent→candidate | Instructions reduced | Cycles reduced |
|---|---|---|---|---|
| 0 | 19.005035→11.101616 | 27.589943→15.692637 | -2.023% | -1.533% |
| 5 | 11.844003→16.096155 | 15.926707→23.807980 | -2.501% | -4.152% |

Screen gate not met: aggregate instruction gain below1%; aggregate cycle gain below1%; fixture5 cycles regress more than2%. No production activation.
Evidence: `w2-order.comparison.json`; environment/cap settings, hardware counters, memory and parent configuration are retained there.

## Wave2 completion and next validation boundary

All33 stages completed at2026-10-04T07:04:39Z, including28 cumulative comparison screens. Every exact comparison matched conditioned probabilities, endpoints, values and selected outputs bit-for-bit. Nine provisional changes remain (mask2114990): sparse occupied ranks, exact ratio table, batched raw priors, forced-row support, packed remaining hands, allocation-free physical actions, shared physical state template, fixed four-option membership, fixed public history. No new normal build has yet activated them.

The later screens use two concurrently running single-threaded fixture pairs, with opposite parent/candidate order. They are complete **single lead-candidate subtrees**, not complete opening latencies. All sampled P-core shares were0. E-core frequency and other load changed substantially; raw CPU/wall differences alone are not treated as algorithmic gains. The final native confirmation will run complete hands serially and report both roles' first-decision and whole-hand timings.

General suffix memoization was expensive even with millions of hits:4k capacity hits3.74m/6.78m, misses33.36m/26.61m on the two screens;16k increases hits but remains slower. Zero-count admission raised hit efficiency (1.07m/2.07m hits,0.265m/0.098m misses) but its saved cheap work only repaid the lookup overhead. No suffix cache is retained. Complete-block memoization and history-summary variants likewise did not pay for their keys. Prior fast hashing/dense indexing adds little after hoisting lookups; the simpler map remains preferable at this boundary.

Pruning-only arithmetic over already-built tables added overhead (~2% cycles; ordering did not rescue it). This specifically motivates the new N1 demand-driven construction test, rather than treating all pruning as equivalent. The N1–N3 one-shot job is `/private/tmp/cribbage-model283-optimization-sweep-20261004/job-pruning-v1.json`,13ordered stages; it began building only after wave2 completed. Default epsilon0. Positive variants1e-5,1e-4,1e-3,1e-2 are laboratory-only. The paired implementation maintains difference bounds incrementally and never chains independent epsilon eliminations into an unaccounted larger local tolerance.

Current capacity check: six unrelated review workers43589–43594 remain busy plus Spotlight; preserve them. The two background experiment workers stay within remaining capacity. No recurring automation or production change is introduced.

<!-- n1-coarse -->
### N1 deferred whole-child tables — decline at screen

Parent mode/epsilon[0, 0] → candidate[1, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 8.348063→11.931024 | 12.010163→19.083507 | -13.414% | -12.366% | True |
| 5 | 6.523817→7.977152 | 9.720519→11.588687 | -14.927% | -11.476% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n1-coarse.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n1-suffix -->
### N1 deferred physical suffix cells — decline at screen

Parent mode/epsilon[1, 0] → candidate[2, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 22.294012→20.086427 | 30.442429→29.104585 | -2.381% | -2.855% | True |
| 5 | 16.810214→18.684630 | 25.963827→25.687314 | -1.716% | -0.067% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n1-suffix.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n1-total -->
### N1 best-granularity candidate versus cumulative baseline — decline at screen

Parent mode/epsilon[0, 0] → candidate[2, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 16.713766→22.518623 | 23.511897→31.757069 | -16.588% | -16.268% | True |
| 5 | 16.812643→15.812775 | 23.987961→22.363202 | -16.790% | -12.022% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n1-total.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n2-exact -->
### N2 total uncertainty with rigorous score-range envelopes — decline at screen

Parent mode/epsilon[2, 0] → candidate[3, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 24.665476→22.876031 | 34.384395→31.875868 | -7.215% | -4.658% | True |
| 5 | 18.605934→21.106984 | 26.080976→29.104341 | -6.455% | -2.896% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n2-exact.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n2-1e-5 -->
### N2 explicit local tolerance 1e-5 — decline at screen

Parent mode/epsilon[3, 0] → candidate[3, 1e-05]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 20.004312→21.211853 | 28.001269→30.059361 | -0.053% | -0.030% | True |
| 5 | 16.097654→16.251927 | 24.708228→22.869185 | 1.891% | 2.159% | False |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%
Positive tolerance deliberately permits bounded local action regret; it does not bound overall root/game strength loss. Not activated in Model28.3.
Evidence: `n2-1e-5.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n2-1e-4 -->
### N2 explicit local tolerance 1e-4 — decline at screen

Parent mode/epsilon[3, 0] → candidate[3, 0.0001]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 25.105539→24.400051 | 34.472986→34.349290 | -0.033% | -0.245% | False |
| 5 | 21.146806→20.105112 | 28.990631→27.888780 | 1.753% | 1.881% | False |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%
Positive tolerance deliberately permits bounded local action regret; it does not bound overall root/game strength loss. Not activated in Model28.3.
Evidence: `n2-1e-4.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n2-1e-3 -->
### N2 explicit local tolerance 1e-3 — decline at screen

Parent mode/epsilon[3, 0] → candidate[3, 0.001]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 20.912708→24.841391 | 30.388386→33.211614 | 0.151% | 0.990% | False |
| 5 | 17.922338→17.551323 | 26.055517→24.838844 | 1.719% | 1.523% | False |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%
Positive tolerance deliberately permits bounded local action regret; it does not bound overall root/game strength loss. Not activated in Model28.3.
Evidence: `n2-1e-3.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n2-1e-2 -->
### N2 explicit local tolerance 1e-2 — screen gain, ultimately declined

Parent mode/epsilon[3, 0] → candidate[3, 0.01]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 24.877043→25.305334 | 34.588331→35.230838 | 0.916% | 1.062% | False |
| 5 | 21.488623→19.849472 | 30.548542→27.896433 | 2.586% | 2.769% | False |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. This small gain over the slower parent did not recover the deferred/bound overhead, so the variant was ultimately declined.
Positive tolerance deliberately permits bounded local action regret; it does not bound overall root/game strength loss. Not activated in Model28.3.
Evidence: `n2-1e-2.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n3-paired -->
### N3 common-hand paired candidate refinement — decline at screen

Parent mode/epsilon[3, 0] → candidate[4, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 26.173076→30.176350 | 35.049991→40.972184 | -29.875% | -27.611% | True |
| 5 | 19.993329→27.704527 | 27.978333→36.998573 | -33.491% | -34.345% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n3-paired.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

<!-- n3-priority -->
### N3 probability-times-range hand priority — decline at screen

Parent mode/epsilon[4, 0] → candidate[5, 0]. Original future posteriors and legal-information domains are preserved.

| Fixture | CPU parent→candidate | Wall parent→candidate | Instructions reduced | Cycles reduced | Exact outputs |
|---|---|---|---|---|---|
| 0 | 34.197694→39.059466 | 45.154894→51.457012 | -17.148% | -15.665% | True |
| 5 | 29.764173→35.077348 | 40.301147→46.398337 | -21.340% | -19.298% | True |

Fixed action0, two concurrent subtree screens; **not whole opening latency**. instructions improvement below1%; cycles improvement below1%; fixture0 cycles regress more than2%; fixture5 cycles regress more than2%
Zero tolerance preserves strict dominance and tie rules.
Evidence: `n3-priority.comparison.json`. Diagnostics include materialized tables, suffix cells and pruned candidates.

### P6/T17 live-root pruning: additional feasibility ceiling

The inner-table tests above do not settle whether live-root action selection could skip a complete candidate subtree. Add a separate exact physical-endpoint bound screen to final full-opening fixtures0/5. C depth-first enumerates possible scoring endpoints for each legal root hand pair, without choosing a clairvoyant policy or retaining a path graph. Root joint hand/crib valuation weights each pair's minimum/maximum WP, preserving correlation and legal priors. Compare these optimistic upper bounds against the strongest actually measured candidate. This is an **oracle-best ordering ceiling**, not an implemented/practical ordering algorithm: if no candidate can be excluded even there, integrating this bound cannot save a root subtree on that case. Measure enumeration plus valuation cost separately and verify every actual policy endpoint is included. If the ceiling shows meaningful savings, implement/measure the decision-only root path before accepting; otherwise decline the extra machinery. Review/all-action forecast contracts still require the requested values.

## N1–N3 decisions after isolated tests

All13 job stages completed at2026-10-04T07:20:09Z. Both full4-card finite-domain boards and close-game boards passed exact endpoint parity in modes1–5. Positive tolerance modes passed explicit local-regret audits against all actions under the same already-resolved continuation policy. Exhaustive small physical continuations fit the WP envelopes, including score-outs, Go/reset, empty-player suffixes and both roles. The hidden-information counterexample ran with recording disabled, so the actual deferred evaluator was exercised.

- **N1 decline.** Whole-child deferral added11.96% cycles relative to the cumulative parent. Deferred physical cells added1.58% more relative to that approach; independently measured against the cumulative parent, the combined variant added14.32% cycles. Hundreds of thousands of candidates were bounded away, but the shared child tables and selected-action outputs still demanded nearly all physical work. Only0.57m/1.12m suffix slots remained unresolved, versus36.63m/32.33m actually computed; unresolved counts also include some incompatible cells, so they are not all saved expensive computations. Exact outputs matched.
- **N2 decline as an engine change or exposed dial.** Exact probability-weighted range bounds added3.86% cycles on the deferred-cell parent. Local tolerances1e-5,1e-4,1e-3,1e-2 reduced that slower evaluator's cycles by0.96%,0.71%,1.23%,1.83% respectively. The smallest tolerance changed one tested forecast; all larger tolerances changed both. The1e-2 setting means up to **one percentage point of local expected WP regret**, not1% relative loss, and not a bound on total game strength. That buys too little speed to recover the underlying overhead. The configurable experimental implementation and data are preserved in `pruning-source/`; no tolerance/environment knob is added to normal28.3.
- **N3 decline.** Shared-hand paired refinement added30.64% cycles to exact N2. Prioritizing hands by probability×uncertainty reduced computed suffix cells further (to34.03m/30.35m), but sorting and interval bookkeeping added another17.34% cycles. Exact outputs matched in both modes. Known equal terms cancel correctly; cancellation savings did not pay for maintaining the bounds.

These decisions concern this postorder score-block architecture and corpus, not impossibility results for the ideas in20.x or another representation. No deliberate approximation is retained, and no playing-strength superiority is inferred from exactness tests.

## Clean retained implementation prepared

The normal source now contains only the nine screened candidates, with all performance switches, deferred/pruning prototypes, rejected caches and incremental-history visibility changes removed. Experiments remain reproducible in frozen evidence directories. Versus the pre-task baseline, core implementation changes are roughly157 added/29 removed lines in `model283.rs` plus a four-line packed-hand setter; the completed root-bound diagnostic is test-only. Exact dense-arithmetic and physical-iterator reference tests replace trial-switch tests in retained source.

Final verification job: `job-final-v1.json`,20 stages, one internal-disk supervisor with KeepAlive=false. It runs clean builds, relevant tests and hidden-information mutations, two complete all-action forecasts, seven native complete-hand pairs across six deals, fresh28.3-specific PGO, three matched compiler full-hand pairs, report generation and hash-verified durable sync. No competing timing/build runs. All20 stages passed. The final external-volume copy succeeded from the foreground after the recorded background-access failure.

### Final build setup corrections

The clean test binary compiled, but the ordinary native build exposed a fixed-buffer comparison trait accidentally limited to tests. Replaced the production comparison with direct slice comparison, removed an unused test helper, and fixed a subsequent local-variable rename typo. Original sources/manifests/logs are preserved in `final-build-correction-1/` and `final-build-correction-2/`. Both were build-setup failures before timed hand runs; no completed performance observations or hands were discarded. The same supervised job resumed. Existing unrelated `WeightedEntry` dead-field warnings are pre-existing and left unchanged.

### P6/T17 root-bound result — decline integration

Both complete all-action openings matched the archived baseline exactly. Physical endpoint enumeration plus correlated root valuation cost0.119374 CPU s on fixture0 (15,692 endpoint entries) and0.502300 CPU s on fixture5 (68,082 entries). **Neither case has any prunable root action even with oracle-best ordering.** Every policy-selected endpoint lay in its computed physical set; every actual candidate WP lay within its conservative bound. Enumeration is cheap enough, but these bounds do not eliminate work here. Keep the normal root path simpler; the diagnostic remains test-only for reproducibility.

The bound integrates suit/crib valuation after selecting a physical endpoint. This is valid for the present future rank-only policy, whose endpoint does not depend on hidden suit classes. A future suit-aware policy would require revisiting that bound (potentially maximizing within each private suit class), not blindly reusing it.

### First complete native pair — preliminary, broader validation running

Fixture0 preserved every action, EV and WP bit and completed all eight cards. Pone first decision82.422709→36.744075 CPU s (138.751067→66.671373 wall s), pone whole pegging82.938393→37.015024 CPU s. Dealer first9.421295→3.603716 CPU s (16.247713→5.569433 wall s), dealer whole9.530284→3.663888 CPU s. Whole-process instructions reduced65.04%, cycles55.00%; both P-core shares0. Peak physical footprint18.92→20.19MB. These are background/E-core timings under concurrent load, not production latency estimates. Remaining native pairs and freshPGO still required.

### Clean native result — complete

All seven serial pairs across six distinct deals passed exact action/EV/WP bit parity and legal completion of all eight cards. Each distinct deal receives equal weight; fixture0 was repeated in reverse order and averaged first. Mean pone first decision **102.867540→50.527834 CPU s**, **187.549807→103.827927 wall s**. Mean dealer first decision **9.160193→4.535391 CPU s**, **17.221258→9.222527 wall s**. Mean whole-hand pegging: pone103.403526→50.915370 CPU s, dealer9.228527→4.584178 CPU s. Aggregate instructions decreased65.837%, cycles55.626%. Exact full forecasts and80 hidden-state mutations also passed.

Every sampled worker used efficiency cores, with variable clocks and competing workloads. These establish a substantial reduction in work on this corpus, not fixed production latency. Detailed per-hand/role wall and CPU tables follow after the final compiler gate.

T16's transferable compiler concept is fresh workload-specific PGO. The prior20.5 box/alignment effect involved a different large solver layout and was not a general ownership gain. This solver already owns its mutable state, while large board tables/domains are separately allocated; moving its small handle structure does not reproduce that earlier layout change. No unmeasured alignment benefit is claimed, and no extra ownership wrapper is added.

Native resource check: all14 processes sampled0% performance-core share. Peak physical footprint ranged17.84–19.01MB for baseline and16.27–20.19MB for final. Cycles per sampled CPU second ranged0.96–2.25GHz baseline versus0.95–1.40GHz final, reinforcing why elapsed-time percentages alone are not a fixed-frequency comparison. The consistent cycle reduction is the stronger algorithmic evidence.

The root-bound widths explain the failed ceiling. On fixture0, actual candidate WP was59.95% versus60.54%, while the respective conservative upper bounds were66.23% and67.06%. Neither could exclude the other. On the near-finish fixture5, actual values ranged67.86–81.50%, but every physical upper bound reached100% (plus the floating-point safety allowance). These endpoint sets include favorable scoring choices that an actual opponent need not allow; using them as safe bounds is legal, but they remain too optimistic to prune these openings.

<!-- final-native-verification -->
## Final native and PGO verification

Six unique deals; fixture0 repeated in reverse order. Complete native pegging plays, serial background policy/nice20 alongside unrelated workloads. Game-ending deals may end before all eight cards are played. CPU and wall seconds are distinct; hardware/core details are retained per pair.

| Algorithm | Role | Mean first decision CPU / wall | Mean whole pegging CPU / wall |
|---|---|---|---|
| baseline | pone | 102.867540 / 187.549807 | 103.403526 / 189.026575 |
| baseline | dealer | 9.160193 / 17.221258 | 9.228527 / 17.338925 |
| final | pone | 50.527834 / 103.827927 | 50.915370 / 104.543165 |
| final | dealer | 4.535391 / 9.222527 | 4.584178 / 9.280434 |

| Pair | Algorithm | Role | First CPU / wall | Whole pegging CPU / wall |
|---|---|---|---|---|
| fixture0 | baseline | pone | 82.422709 / 138.751066709 | 82.938393 / 139.927129 |
| fixture0 | baseline | dealer | 9.421295 / 16.247713125 | 9.530284 / 16.499627 |
| fixture0 | final | pone | 36.744075 / 66.671373375 | 37.015024 / 67.127337 |
| fixture0 | final | dealer | 3.6037159999999986 / 5.569433292 | 3.663888 / 5.665684 |
| fixture1 | final | pone | 59.970766999999995 / 113.986877667 | 60.452686 / 114.912396 |
| fixture1 | final | dealer | 5.503447000000001 / 12.067397125 | 5.572202 / 12.153946 |
| fixture1 | baseline | pone | 129.562113 / 263.513806708 | 130.283478 / 264.331388 |
| fixture1 | baseline | dealer | 12.246525999999989 / 19.958602708 | 12.361149 / 20.082662 |
| fixture2 | baseline | pone | 130.605082 / 237.90078675 | 131.372319 / 241.967888 |
| fixture2 | baseline | dealer | 12.332566999999983 / 25.13681025 | 12.439638 / 25.346335 |
| fixture2 | final | pone | 55.457681 / 120.69892 | 55.803072 / 121.581041 |
| fixture2 | final | dealer | 4.925435 / 13.304732209 | 4.985663 / 13.367133 |
| fixture3 | final | pone | 60.932464 / 142.985742166 | 61.521087 / 143.890473 |
| fixture3 | final | dealer | 4.663632999999997 / 11.481900584 | 4.712709 / 11.534848 |
| fixture3 | baseline | pone | 84.608998 / 142.84200375 | 85.080647 / 144.089443 |
| fixture3 | baseline | dealer | 6.401508000000007 / 13.819445834 | 6.439226 / 13.857968 |
| fixture4 | baseline | pone | 71.882538 / 125.0770415 | 72.144317 / 125.351913 |
| fixture4 | baseline | dealer | 3.9946470000000005 / 8.057076791 | 4.023393 / 8.087168 |
| fixture4 | final | pone | 54.21084999999999 / 101.563787583 | 54.561694 / 102.378329 |
| fixture4 | final | dealer | 4.102592999999999 / 4.359255875 | 4.122229 / 4.384704 |
| fixture5 | final | pone | 39.584787 / 75.232032375 | 39.908605 / 75.586258 |
| fixture5 | final | dealer | 4.166584 / 7.445729834 | 4.198819 / 7.479755 |
| fixture5 | baseline | pone | 123.074216 / 217.824382792 | 123.729354 / 219.514979 |
| fixture5 | baseline | dealer | 10.802694000000017 / 19.061227042 | 10.854580 / 19.187200 |
| fixture0 | final | pone | 29.276839000000002 / 70.329036208 | 29.475126 / 70.693649 |
| fixture0 | final | dealer | 4.097596000000003 / 7.782858833 | 4.162999 / 7.858749 |
| fixture0 | baseline | pone | 72.52188 / 137.530578459 | 72.683688 / 137.880546 |
| fixture0 | baseline | dealer | 8.945141000000007 / 18.341055334 | 8.976072 / 18.444806 |

Exact action/EV/WP float-bit parity passed all seven native pairs and both full forecast fixtures. Hidden-information audit: 80 variants. Algorithm aggregate instruction/cycle reductions: instructions=65.837%, cycles=55.626%.

## Fresh PGO for the retained algorithm

PGO explicitly trained Model28.3 using the maintained native-Mac corpus. Baseline/instrumented/optimized outputs passed the build script's exact parity checks. No CPU-specific tuning or production deployment.

| Compiler | Role | Mean first CPU / wall | Mean whole pegging CPU / wall |
|---|---|---|---|
| pgo-baseline | pone | 48.473257 / 70.117762 | 48.716743 / 70.407329 |
| pgo-baseline | dealer | 3.694587 / 5.301122 | 3.736939 / 5.354198 |
| pgo-final | pone | 44.520177 / 67.459786 | 44.866255 / 67.902137 |
| pgo-final | dealer | 4.438625 / 5.650254 | 4.492899 / 5.718806 |

PGO aggregate instruction/cycle reductions: instructions=7.238%, cycles=13.943%.
These comparisons verify performance and unchanged behavior on the corpus, not a new playing-strength superiority claim.

## Root-bound ceiling
- Fixture0: exact physical bound preparation 0.119374 CPU seconds, 15692 endpoints, at most0 actions prunable even with oracle-best ordering.
- Fixture5: exact physical bound preparation 0.502300 CPU seconds, 68082 endpoints, at most0 actions prunable even with oracle-best ordering.
Decline root-bound integration on this evidence: even oracle-best ordering cannot skip a candidate on either opening, so preparation only adds work.

Durable evidence: `/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/model283-optimization-sweep-20261004`.

## Final decision and compiler interpretation

Retain the nine exact source changes and the tested model-specific PGO build. Decline N1, N2 and N3, along with the other rejected variants in the decision register. There are no remaining untested items in this assessment. No approximate pruning or runtime quality dial was added to normal28.3. Future full private discard/suit support and action-conditioned beliefs remain explicitly documented strategy omissions under the cheap-only gate; performance parity is relative to the pre-task28.3 model.

Fresh PGO preserved exact floating-point result bits on all26 build workload cases (10training,16validation, including two complete hands), and on three additional matched native hand pairs. It reduced instructions7.238% and cycles13.943% in aggregate. Each pair independently reduced cycles:13.16%,15.02%,12.98%. All six measured processes used efficiency cores only; peak physical footprints were18.87–19.25MB baseline and17.96–19.43MB PGO.

Observed PGO mean pone-first latency fell48.473257→44.520177 CPU s and70.117762→67.459786 wall s. Dealer-first timing rose3.694587→4.438625 CPU s and5.301122→5.650254 wall s. Do not hide that mixed latency result: clocks varied materially. On fixture3 the optimized process averaged1.005GHz versus1.458GHz for baseline, while doing15.02% fewer cycles. The supported compiler claim is reduced processor work on all three deals, with unchanged results; these loaded-machine timings do not establish a fixed latency gain for every role. No production-hardware timing or deployment is claimed.

This build used the maintained builder with `--model schell_table-peg_table-28.3`, a fresh profile and no native-CPU tuning. The profile, compiler/flags, binary hashes and source/asset hashes are preserved. No global build default or older model was changed.

The background final-copy stage encountered an external-volume permission error after all19 computational/report stages had passed. Its original status, job specification and failure log are preserved in `sync-correction-1/`. Recovery copies and verifies the same completed evidence from the foreground; no solved hand or performance comparison is rerun.

Completion: the original one-shot job now reports **20/20 complete**. The foreground recovery reran only the final copy stage. All archived files passed SHA-256 verification; see `sync.json`, `archive-manifest.json` and `job-final-status.json` in the durable evidence directory.

<!-- pruning-diagnosis-20261004 -->
## N1/N2 slowdown diagnosis follow-up

The original rejection was too broad if read as an inherent failure of either idea. The deferred prototype omitted the retained prepared-state optimization and did redundant bound setup. Isolated corrections saved10.996% cycles from fine N1, but corrected N1 still added2.167% cycles/7.291% instructions versus eager evaluation; corrected N2 added another1.944% cycles/3.897% instructions. All14 fixture-level paired comparisons remained bit-exact. These are two fixed root-action subtrees, not full openings or a playing-strength match. All timed runs recorded E-core-only execution; clock variation still confounded raw CPU/wall comparisons.

The counters explain the residual: shared continuations remained needed by other hands/forced plays, and the strategic choice-group count never fell. The original evaluator built5.989m remainder arrays,49.13% without an incumbent. N2 made134.520m range queries to avoid200,664 additional suffix calculations;96.55% of close-game queries returned the full[0,1] range, with zero extra calculations avoided in that fixture.

Keep the retained evaluator. The diagnostic corrections remain isolated; no model source changed. The earlier measurements are preserved as observations of the original prototype, not silently replaced. Full diagnosis, counters, ablations and limitations: [report.md](/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/model283-pruning-diagnosis-20261004/report.md).

## Corrected implementation follow-up (2026-10-04)

The original dispositions above are historical. A complete 24-item implementation audit corrected several avoidable costs and retested each plausible variant, including clean native and freshly trained PGO comparisons. See [the corrected audit](model283-implementation-audit-20261004.md) for final decisions and timings. Retained additions: sparse physical rank traversal, direct forced-loop/selected-endpoint reuse, known running-count scoring, simple reusable weights, concrete packed-key hashing, and exact forced-support checks. Deferred/uncertainty/paired pruning remain declined after corrected tests; no approximate tolerance is active.
