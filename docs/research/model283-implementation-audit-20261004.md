# Model28.3 implementation audit and corrected optimization retests

Status: complete. All 24 unique items reviewed; corrected variants measured; verified winners installed in the retained Model28.3 research checkout. No commit/push/deployment performed. This reopens implementation quality behind every item in the completed optimization sweep. Original results remain archived; no previous decline is treated as proof that the idea cannot work.

## Final fresh-PGO confirmation and retained result

Durable evidence: [model283-implementation-audit-20261004](/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/model283-implementation-audit-20261004). The final comparison uses the prior retained PGO binary versus a freshly trained corrected binary, with the same rustc version, target and empty extra-flag list. Training/validation contains 10/16 positions, all bit-exact. Four paired full-hand runs cover three unique deals with fixture0 repeated in reversed order. Both models complete every hand legally with eight cards and identical decision/EV/WP bits.

| Role / measure | Prior PGO CPU s | Corrected PGO CPU s | Prior wall s | Corrected wall s |
|---|---:|---:|---:|---:|
| pone first decision | 39.502935 | 27.248987 | 42.977328 | 28.146654 |
| pone whole-hand pegging | 39.742840 | 27.405863 | 43.222607 | 28.311121 |
| dealer first decision | 4.024215 | 2.181232 | 4.108847 | 2.266327 |
| dealer whole-hand pegging | 4.064547 | 2.215654 | 4.152011 | 2.303716 |

Equal weight per unique fixture; repeated fixture averaged first. Pone first-decision CPU falls 31.02%. Aggregate sampled instructions fall 29.58%, cycles 35.51%. These are serial single-thread background/nice20 Mac timings; sampled performance-core share ranges 0.000000–0.000000. Sampled peak physical footprint ranges 18.47–24.55 MiB. Same E-core type does not eliminate clock/scheduling variation; instruction/cycle reductions and repeated clean-source results support the conclusion. No production-hardware speed claim or playing-strength superiority is inferred.

Validation totals: 126 exact paired subtree screens plus six explicitly approximate screens; eight full-forecast comparisons; 22 valid paired complete-hand comparisons (44 playthroughs) across the clean physical/layout/buffer/prior/PGO stages; 320 hidden-information mutations in the four native clean stages; and 26 PGO workload positions. Invalid layout-v1 results are excluded. The dedicated reference tests additionally cover physical transitions, terminal endpoint parity and over 50,000 forced-support comparisons. Tested parity is not a broad strength benchmark, and existing model strength limitations S1–S3 remain explicit.

All 24 items are closed for this audit. The no-pruning eager strategy is retained after giving N1/N2/N3 corrected direct reads, bounds-before-materialization, coarser checks, suffix gating, candidate ordering, compact intervals and alternative table layout their own tests. Positive uncertainty tolerances remain laboratory-only: they change outputs and still lose to the corrected exact baseline. The final implementation introduces no quality tolerance or hidden-information shortcut.

Three source files were installed only after frozen-source/asset/binary checks passed. Original versions, exact installed hashes, compiler/profile receipts, individual results and build-cache-error evidence are preserved. See `installation.json`, `final-source-review.json`, `pgo-evaluation/pgo-native-summary.json`, and `archive-receipt.json`.

## Scope and protocol

- Review each implementation and its measurement boundary; map repeated P1–P7 and20.x concepts to the unique items below.
- Start with known N1/N2 defects, then N3, then other plausible corrected variants. Test changes separately against the retained exact baseline, then stack and confirm any winners.
- Preserve complete legal-information groups, probabilities, accumulation/tie rules, and exact zero-tolerance outputs. Positive quality tolerances remain experimental and cannot be represented as a game-level guarantee.
- No persistent action table, exhaustive path graph, production change, other-job interruption, or new timer automation.
- Use frozen internal-disk sources and one-shot jobs. Record instructions/cycles alongside CPU/wall/core share and memory. Same core type alone does not fix clock noise.
- Full-opening/full-hand tests and clean-source confirmation are required for retention. Fresh PGO follows only if algorithm winners are retained.
- Current inventory:12logical cores,6P+6E; no CPU-heavy cribbage processes at initial check. Limit matched screens to two single-thread solves, builds to three workers; recheck before larger stages.

## Ranked audit register

| Item | Concept | Audit / planned correction | Status |
|---|---|---|---|
| N1 | Deferred inner work | Known unnecessary bounds and lost state preparation corrected in isolated source. Test cached-table bypass, coarser bound checks, and restricting deferral to eligible suffix blocks. | Complete: corrected; keep simpler eager evaluator |
| N2 | Weighted uncertainty | Known redundant/loose bounds corrected. Test cheap upper-only bounds, shared broad bounds, show-score indexing, and pre-materialization rejection; zero tolerance is the exact gate. | Complete: exact and positive-tolerance variants declined |
| N3 | Paired refinement | Audit per-hand/action-squared matrices, allocations, recomputation and sorting; test compact in-order paired intervals. | Complete: compact and restricted variants declined |
| T10 | Physical actions / forced endpoint | Retained iterator and fixed memberships audited. Rejected endpoint shortcut needlessly starts searches on forced moves; test reuse only at a real choice. | Complete: retain sparse mask, direct forced loop and selected endpoint reuse |
| T03 | Sparse traversal / early zeros | Retained sparse order audited. Replace rejected repeated 13-rank zero scan with one per-block zero mask. | Complete: retain sparse weighting; redundant zero mask declined |
| T05 | Forced-row support | Audit exact support and underflow proof. Test Boolean support using already-hoisted raw values and zero mask. | Complete: retain validated Boolean support |
| T06 | Weight buffers | Audit ownership and early exits; test returning capacity on empty support and reusing buffers by traversal depth. | Complete: retain simple block-local reusable weights |
| T07 | Batched / dense priors | Audit existing hoisting. Rejected dense indexing recomputes combinadic IDs on lookups; test cached IDs. | Complete: cached IDs tested; choose simpler typed-map alternative |
| T08 | Fast hashing | Audit dynamic hasher dispatch; test a concrete typed packed-key hasher. | Complete: retain concrete full-key prior hasher |
| T09 | Fixed / incremental history | Audit retained storage, likelihood-stack validity, both rejected variants. Test removing intermediate event mapping if a faithful direct kernel is justified. | Complete: retain fixed history; no worthwhile incremental replacement |
| T11 | Physical template / scorer memo | Template omission in N1 corrected. Audit scorer keys, diagnostics and admission; test avoiding cheap-series cache lookups. | Complete: retain known count; decline scorer memo |
| T12 | Suffix memo | Audit full-key correctness, hash cost, clear churn and cheap-tail admission. Test a direct-mapped full-equality cache and expensive-tail admission. | Complete: corrected cache/admission variants declined |
| T13 | Equivalent child / block sharing | Audit repeated key construction, cloning, constant checks, observed reuse. Test cheaper block-wide constant detection; adjust memo only if reuse supports it. | Complete: corrected keys, caps and equality variants declined |
| T17 | Inner bounds / ordering | Audit incumbent setup, floating-point margin and tie handling. Covered by optimized N1/N2 experiments where work is not already materialized. | Complete: corrected ordering/bounds do not repay their cost |
| P6 | Physical root bounds | Audit oracle-incumbent feasibility and complete root ranges; do not time expensive bounds that provably cannot prune the tested openings. | Complete: no prunable root on audited openings |
| T01 | Coefficient table | Audit against exact ratio replacement; superseded, no redundant integration. | Complete: superseded, correct |
| T02 | Exact ratio table | Audit division order, zero denominators and reachable support; preserve bit-exact weights. | Complete: retain existing exact ratios |
| T04 | Packed hand keys | Audit key uniqueness and decrement updates across repeated ranks/Go. | Complete: retain existing packed keys |
| T14 | Root preparation | Audit timing coverage and boundaries; check excluded work before relying on small measured ceiling. | Complete: no worthwhile preparation change |
| T15 | Indexed histogram | Audit kernel realism and root integration cost before relying on small measured ceiling. | Complete: retain simpler root histogram |
| T16 | PGO / ownership / layout | Audit profile provenance and coverage, clean-build comparisons and inherited owned solver. Retrain after any retained algorithm improvements. | Complete: fresh PGO verified; owned solver retained; extra orientation declined |
| S1 | Future suit / crib contexts | Audit requirement/cost argument; preserve cheap-only gate, no silent approximation. | Complete cost audit; unresolved research |
| S2 | Future own discards | Audit context counts and true private-information distinctions; known root discards already applied. Do not allocate known oversized dense tables. | Complete cost audit; unresolved research |
| S3 | Choice-conditioned future beliefs | Audit whether proposed shortcut preserves symmetric policy/belief consistency; no silent fixed-opponent substitution. | Complete consistency audit; unresolved research |

P1 maps to T01–T08; P2 to T05; P3 to T15; P4 to T09/T10; P5 to T10–T12; P6 to N1–N3/T17/P6; P7 to T13. Every source concept in the earlier20.x inventory was cross-checked or mapped below.

Evidence workspace: `/private/tmp/cribbage-model283-implementation-audit-20261004`. Retained source: `/private/tmp/cribbage-model283-score-blocks`. The isolated lab begins from the diagnosed frozen experimental source, including its three exact diagnostic repairs.

<!-- a1-coarse -->
### N1 skip warm-table bounds and direct reads — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 12.437%; cycles reduced 10.552%. These are not whole-opening timings. Evidence: `a1-coarse.comparison.json`.

<!-- a1-fine -->
### N1 selective bounds and direct output copying — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 7.114%; cycles reduced 6.260%. These are not whole-opening timings. Evidence: `a1-fine.comparison.json`.

<!-- a1-chunks -->
### N1 coarser check interval — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.966%; cycles reduced -1.050%. These are not whole-opening timings. Evidence: `a1-chunks.comparison.json`.

<!-- a1-hybrid -->
### N1 defer only last strategic blocks — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.202%; cycles reduced -1.932%. These are not whole-opening timings. Evidence: `a1-hybrid.comparison.json`.

<!-- a1-net -->
### N1 corrected selective evaluator versus eager — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -2.480%; cycles reduced 15.290%. These are not whole-opening timings. Evidence: `a1-net.comparison.json`.

<!-- a1-hybrid-net -->
### N1 restricted evaluator versus eager — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -2.557%; cycles reduced 12.871%. These are not whole-opening timings. Evidence: `a1-hybrid-net.comparison.json`.

<!-- a2-upper -->
### N2 upper-only bounds and broad-range shortcuts — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 1.315%; cycles reduced 0.869%. These are not whole-opening timings. Evidence: `a2-upper.comparison.json`.

## Initial implementation audit findings

- **N1/N2:** corrected the previously diagnosed state-template loss, useless first-candidate bounds and diagnostic scan. New tests additionally bypass warm-table bounds/dispatch, check bounds before materialization, amortize checks, and specialize upper envelopes. The ongoing wave remains isolated.
- **N3:** the earlier implementation allocated per-action/per-hand low/high/value matrices and maintained action-squared differences after each hand. The new compact variant keeps exact ascending-order candidate sums, one remaining-mass vector, four active flags and periodic interval checks. It is a different implementation of the same exact selection objective, not an approximation.
- **T01/T02/T04:** coefficient/ratio tables and packed-key arithmetic reviewed. Ratios preserve each division result and multiplication order; compatible positive-card states cannot use a zero denominator. Packed three-bit counts represent0–4 uniquely, decrement exactly on plays and remain unchanged on Go. Existing exhaustive tests will be rerun. T01 remains superseded by the more direct exact-ratio approach.
- **T03/T05:** the rejected hard-zero scan repeated thirteen rank checks per weight; test one likelihood-zero mask per public block. The Boolean forced-support variant ignored already-hoisted raw prior values; test using those values while preserving physical compatibility and exact support.
- **T06:** the reused vector was only local to each public block and lost its capacity on a zero-mass early exit. Test traversal-depth scratch reuse with correct restoration; no recursive aliasing.
- **T07/T08:** the dense prior implementation reconstructed combinadic hand IDs at every lookup, and the fast hasher used a runtime enum wrapper. Test cached hand IDs and a concrete typed hasher separately.
- **T09:** incremental summaries use a depth/path guard and preserve integer likelihood rounding and hard-zero/soft-floor distinctions. No missing invalidation found. Their cost is small after prior work. Test direct fixed-storage history interpretation to remove the intermediate event vector and the scorer's small series vector.
- **T10:** the rejected endpoint shortcut launched uncontested search even at forced moves. The existing iterator also calculates two next states just to check whether a choice exists, then evaluates them again. Test endpoint reuse only at a real choice and inspecting legal-rank bits before scoring. Test sparse physical rank traversal separately.
- **T11:** the retained prepared state is correct. The score-only cache has full-key equality, but pays packing/hash costs on cheap series. Test admission thresholds; also reuse the running count already present in physical state instead of re-summing it in every scorer call.
- **T12:** the old suffix cache used a general hash map and cleared the entire map at its cap. Historical zero-count admission had~80% hits but little net saving; all-tail admission paid heavily for cheap misses. Test a bounded direct-mapped cache with full state/show equality, single-slot replacement, and selective admission. Collision tests use capacity1.
- **T13:** historical block memo observed58 hits versus12,094 misses on fixture0, and built/hashed allocated domain keys for each lookup. Test using already-packed initial-hand nibbles in those keys. The constant-child check was repeated for each own hand; test detecting a globally constant block once.
- **Evaluation gate correction:** the previous screen required both instructions and cycles to improve by at least1%. Fewer instructions are not a prerequisite for faster execution. The new assessment uses instructions as supporting evidence, alongside repeated cycles and CPU/wall timings, core shares, clean-build confirmation and whole-hand impact. A consistent CPI improvement is not rejected solely for executing more instructions; a noisy elapsed-time win is not accepted by itself.

<!-- a2-show-index -->
### N2 cache bounds by opposing show score — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.126%; cycles reduced 0.098%. These are not whole-opening timings. Evidence: `a2-show-index.comparison.json`.

<!-- a2-net -->
### N2 optimized bounds versus optimized N1 — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.765%; cycles reduced -0.471%. These are not whole-opening timings. Evidence: `a2-net.comparison.json`.

<!-- a3-compact -->
### N3 compact in-order paired intervals — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 35.098%; cycles reduced 31.566%. These are not whole-opening timings. Evidence: `a3-compact.comparison.json`.

<!-- a3-net -->
### N3 compact paired evaluator versus eager — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -3.211%; cycles reduced 13.368%. These are not whole-opening timings. Evidence: `a3-net.comparison.json`.

<!-- a3-hybrid -->
### N3 compact paired suffix-block restriction — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 2.442%; cycles reduced 1.646%. These are not whole-opening timings. Evidence: `a3-hybrid.comparison.json`.

## Audit of scoped exclusions and inherited concepts

- **T14 root preparation:** checked the timing harness against `forecast_conditioned` and the live `model283_counting::forecast/value` call path. The~7ms ceiling covers policy preparation, public-domain preparation and the solver utility-table constructor. It does **not** cover correlated root hand/crib valuation; that was separately measured at~0.241s/~0.076s for the fixed action in the two fixtures. Therefore the small ceiling is valid only for the original preparation proposal, not all non-search work. There is no per-world external validation or root-observation reconstruction remaining to eliminate. No new entry-point abstraction is justified by this preparation-only ceiling.
- **T15 histograms:** reviewed the extracted inputs, duplicate-bin accumulation, touched-entry sort, normalization order, and reset between candidate rows. It models the remaining root aggregation; future group histograms were already removed. The recorded~0.16ms per three-candidate opening is a small kernel saving, not a claim about counting valuation. No omitted expensive histogram was found. Keep the simpler root code unless later profiling changes that ceiling.
- **T16 compiler/ownership:** current solver is already exclusively owned; assets remain shared. The previous profile was generated for28.3, with held-out verification and exact parity, not inherited from20.x. A new algorithm winner will require clean native comparison and fresh PGO; the previous profile will not be used to claim its speed. No CPU-specific/native flag is silently added.
- **P6/T17 bounds and ordering:** prior root feasibility used exact physical endpoint ranges and even an oracle incumbent; neither complete opening had a provably rejectable root action under those bounds. This is an applicability result on two openings, not proof for all boards. T17's arithmetic-only test worked on already-built child tables, so little expensive work was at stake. The corrected deferred tests now check before materialization and include ordering; strict bounds, margins and tie rules remain intact.
- **S1/S2/S3 strength additions:** these were cost/architecture assessments, not rejected performance implementations. Rechecked their information requirements. Own known root discards already constrain the root posterior; hypothetical future players must have their own private discard contexts. Different own discards can change posterior weights and choices, not just remove globally impossible worlds. Suit counts score a known hand cheaply but do not remove uncertainty over the hypothetical actor's private suit class. The164,995 rank keep/discard contexts per role and13.643GB dense-child calculation remain valid for that proposed representation. A sparse decision-certificate architecture might eventually avoid splitting many contexts, but has not been demonstrated as a cheap repair. Do not repeat a known oversized dense allocation or silently average away private knowledge. Choice-conditioned symmetric beliefs still need a consistent policy/belief solution; a fixed-opponent shortcut would change the model. These remain explicitly unresolved research under the user's cheap-only gate, not evidence that every future implementation is impossible.

The prior20.x inventory maps to the24 unique audit items above. Items already intrinsic to28.3—immutable RAM assets, packed belief rows, legal-information grouping, one requested-action forecast, owned solver, preserved model boundaries—were checked in the current call path rather than reimplemented. Historical action-cache sizing/churn, lock removal, and cancellation ideas do not correspond to an active cache/lock/background job in this serial solver. No implementation was omitted from testing merely because an older model rejected its general idea.

<!-- b10-endpoint -->
### T10 reuse endpoint only after actual choice — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 2.197%; cycles reduced 2.669%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b10-endpoint.comparison.json`.

<!-- b10-sparse -->
### T10 sparse physical legal-rank mask — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 10.287%; cycles reduced 7.312%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b10-sparse.comparison.json`.

<!-- b10-precheck -->
### T10 inspect legal mask before scoring alternatives — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 8.312%; cycles reduced 17.305%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b10-precheck.comparison.json`.

<!-- b10-combined -->
### T10 combine three physical-loop corrections — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 20.791%; cycles reduced 28.350%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b10-combined.comparison.json`.

<!-- b11-count -->
### T11 reuse the already-computed series total — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 5.115%; cycles reduced 3.163%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b11-count.comparison.json`.

<!-- b3-zero -->
### T03 precomputed hard-zero likelihood mask — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.262%; cycles reduced 0.063%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b3-zero.comparison.json`.

<!-- b5-support -->
### T05 prepared forced-row Boolean support — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.595%; cycles reduced 0.862%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b5-support.comparison.json`.

<!-- b5-mask -->
### T05 combine prepared support and zero mask — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.235%; cycles reduced 0.094%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b5-mask.comparison.json`.

<!-- b6-depth -->
### T06 repair scratch ownership and reuse by depth — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.042%; cycles reduced -0.174%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b6-depth.comparison.json`.

<!-- b6-net -->
### T06 depth scratch versus retained evaluator — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 1.157%; cycles reduced 1.084%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b6-net.comparison.json`.

<!-- b7-cached-index -->
### T07 precompute dense hand indexes — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.116%; cycles reduced 0.259%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b7-cached-index.comparison.json`.

<!-- b7-net -->
### T07 cached dense rows versus retained evaluator — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.325%; cycles reduced 0.888%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b7-net.comparison.json`.

<!-- b8-typed-hash -->
### T08 concrete packed-key fast hasher — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.554%; cycles reduced 0.864%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b8-typed-hash.comparison.json`.

<!-- b9-direct-history -->
### T09 direct fixed-storage history interpretation — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.084%; cycles reduced 0.223%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b9-direct-history.comparison.json`.

<!-- b11-series4 -->
### T11 scorer memo with minimum length4 — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.018%; cycles reduced -0.371%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b11-series4.comparison.json`.

<!-- b11-series5 -->
### T11 scorer memo with minimum length5 — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.182%; cycles reduced 0.121%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b11-series5.comparison.json`.

<!-- b12-direct -->
### T12 direct-mapped full-key suffix memo — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -1.789%; cycles reduced -6.446%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b12-direct.comparison.json`.

<!-- b12-zero -->
### T12 direct suffix memo at zero-count boundaries — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.812%; cycles reduced 0.799%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b12-zero.comparison.json`.

<!-- b12-choice -->
### T12 direct suffix memo excluding one-card tails — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.171%; cycles reduced -0.471%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b12-choice.comparison.json`.

<!-- b12-choice-zero -->
### T12 combine both cheap admission criteria — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.286%; cycles reduced 0.520%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b12-choice-zero.comparison.json`.

<!-- b13-constant -->
### T13 detect globally identical constant children once — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.051%; cycles reduced 0.024%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b13-constant.comparison.json`.

<!-- b13-key -->
### T13 reuse packed initial-hand keys in block memo — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.008%; cycles reduced 0.401%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b13-key.comparison.json`.

<!-- b13-net -->
### T13 compact-key block memo versus retained evaluator — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.184%; cycles reduced -0.310%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b13-net.comparison.json`.

<!-- b1-coarse-net -->
### N1 direct corrected coarse evaluator versus eager — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.257%; cycles reduced 0.645%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b1-coarse-net.comparison.json`.

<!-- b1-fine-net -->
### N1 per-contribution checks versus eager — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -3.303%; cycles reduced 2.222%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b1-fine-net.comparison.json`.

<!-- b1-order -->
### N1 promising immediate-score candidate first — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.405%; cycles reduced 0.481%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b1-order.comparison.json`.

<!-- b2-order -->
### N2 promising candidate ordering with optimized bounds — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.483%; cycles reduced 0.337%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `b2-order.comparison.json`.

<!-- c10-shared -->
### T10 centralize corrected physical loop — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.246%; cycles reduced -2.661%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c10-shared.comparison.json`.

<!-- c11-stack -->
### T11 stack known running total — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 6.763%; cycles reduced 2.438%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c11-stack.comparison.json`.

<!-- c10-layout -->
### T10 consumer-oriented physical suffix tables — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 4.310%; cycles reduced 5.021%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c10-layout.comparison.json`.

<!-- c10-net -->
### T10/T11 corrected shared scoring versus retained — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 27.189%; cycles reduced 28.916%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c10-net.comparison.json`.

<!-- c1-coarse -->
### N1 coarse with corrected physical engine — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.993%; cycles reduced 0.351%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c1-coarse.comparison.json`.

<!-- c1-fine -->
### N1 fine with corrected physical engine — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -8.306%; cycles reduced -4.156%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c1-fine.comparison.json`.

<!-- c1-no-pruning -->
### N1 isolate pruning from deferred layout — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 2.269%; cycles reduced 2.976%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c1-no-pruning.comparison.json`.

<!-- c1-order -->
### N1 corrected physical engine and candidate ordering — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.244%; cycles reduced 0.037%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c1-order.comparison.json`.

<!-- c2-bounds -->
### N2 optimized bounds with corrected physical engine — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.929%; cycles reduced -0.703%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c2-bounds.comparison.json`.

<!-- c3-paired -->
### N3 compact intervals with corrected physical engine — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -10.014%; cycles reduced -7.595%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c3-paired.comparison.json`.

<!-- c3-hybrid -->
### N3 suffix-gated compact intervals — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 3.868%; cycles reduced 2.923%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c3-hybrid.comparison.json`.

<!-- c13-larger -->
### T13 admit medium-sized repeated blocks — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.239%; cycles reduced -0.438%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c13-larger.comparison.json`.

<!-- c13-minimum -->
### T13 exclude tiny blocks from memo — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.102%; cycles reduced 0.117%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c13-minimum.comparison.json`.

## What the corrected implementation tests establish

- N1’s coarse evaluator is now close to eager, rather than paying the earlier double-digit penalty. Fine evaluation still adds work after both paths receive the same corrected physical scorer. Disabling bound checks within the same fine evaluator reduces instructions by2.27% and cycles by2.98%. Thus its remaining pruning does not repay its bookkeeping on these openings. Candidate ordering saves only0.24% instructions/0.04% cycles in this corrected setting.
- N2’s upper-only bounds, broad-range bypass and per-row show indexing remove most of the previous avoidable bound overhead. It still adds0.93% instructions/0.70% cycles relative to corrected N1 in the wave3 pair. Earlier diagnostics showed most ranges are the full[0,1], and child policy groups still have to be settled for other consumers. This is an applicability/reuse constraint, not a claim that a safe chance bound cannot exist. Repaired positive-tolerance variants are queued separately; they remain laboratory-only local allowances.
- N3’s compact interval representation removes the original action-by-hand and action-squared matrices. It nevertheless adds10.01% instructions/7.60% cycles versus the corrected eager scorer; restricting it to last strategic blocks recovers3.87% instructions/2.92% cycles but leaves a net regression. No positive tolerance is introduced into the retained model.
- Table layout is being tested independently: eager dealer-parent suffix tables can be built in consumer order. This avoids adding policy/pruning machinery merely to obtain a memory-layout effect. The first screen saves4.31% instructions/5.02% cycles, requiring clean-source confirmation.
- The shared physical loop, sparse rank traversal and known running count together remove27.19% instructions/28.92% cycles versus the retained eager implementation in the first wave3 screen. This is still a fixed-candidate screen. Full-opening and complete-hand results must support any final gain claim.

<!-- c3-zero-counter -->
### T03 verify whether zero rejection remains reachable — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced -0.198%; cycles reduced 0.187%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c3-zero-counter.comparison.json`.

<!-- c6-perblock -->
### T06 simple block-local weight capacity reuse — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 1.545%; cycles reduced 1.876%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c6-perblock.comparison.json`.

<!-- c5-stack -->
### T05 prepared Boolean support after physical corrections — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.762%; cycles reduced 0.848%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c5-stack.comparison.json`.

<!-- c8-stack -->
### T08 typed hasher after physical corrections — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.787%; cycles reduced 1.639%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c8-stack.comparison.json`.

<!-- c12-stack -->
### T12 bounded zero-count suffix memo after corrections — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 0.084%; cycles reduced 0.318%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c12-stack.comparison.json`.

<!-- c10-repeat -->
### T10/T11 independent repeat versus retained — historical screen result (final disposition in register)

Exact outputs matched both fixed action0 subtrees. Instructions reduced 27.278%; cycles reduced 29.572%. Whole-hand confirmation and interaction tests remain required for retention. Evidence: `c10-repeat.comparison.json`.

## Completed broad screens

All three screen waves passed frozen-input verification:58 independent treatment comparisons, each on two fixed lead-candidate subtrees (116 exact paired comparisons). Every zero-tolerance candidate matched the original conditioned outputs bit-for-bit. These are not116 full hands. Reversed confirmations, clean full forecasts and whole-hand checks follow separately.

- T03 hard-zero masks rejected zero additional hands in both cases. Public Go legality had already removed those rank holds. Added zero-mask checks cannot save their arithmetic here; retain the existing sparse compatible weighting.
- T12 direct mapping, zero-count admission, excluding one-card tails and both together were all tested. After the corrected physical loop, the best narrow admission screen saved only0.08% instructions/0.32% cycles. The new cache does not earn its lookup/storage complexity. Keep the measured physical computation without a suffix cache.
- T13 raising admission to16384cells and excluding domains below256cells did not rescue memoization. The larger-cap variant had only52/67 hits against12603/16464 misses on the two fixtures; tiny-domain exclusion had54/43 hits against9140/10800 misses. Both remained slightly worse than the retained no-memo evaluator overall. The public-position/domain key cost is real; adding a cache to this traversal is not equivalent to automatically getting downstream decision reuse.
- T07 dense IDs are correct after all card removals and Go, but most raw lookup work is already hoisted. Confirm its small remaining effect after the scoring correction before final disposition.
- T09 direct fixed-history likelihood reconstruction matched authoritative interpretation at every tested prefix and avoided allocations, but saved only0.08% instructions/0.22% cycles at the whole-subtree boundary. No invalidation or semantic bug was found in the earlier incremental version; preserve the existing simpler fixed-history implementation.
- T11 score-cache length4/5 admission thresholds did not provide a measurable net improvement. Reusing the existing running count removes actual arithmetic without a cache and is part of the clean candidate.
- T05 prepared Boolean support and T08 a concrete full-key hasher are small positive candidates, not rejected by the old instruction gate. Reversed-order confirmation is queued. T06 simple block-local scratch showed1.55% fewer instructions/1.88% fewer cycles after the physical correction; depth-owned buffers add complexity without another measured benefit.

The physical changes are limited to forced or publicly uncontested suffixes. Returning an already-selected terminal endpoint skips repeated calculation, not a strategic choice. All contested choices retain their complete legal-information groups, weights, accumulation order, counting context and tie rules. The known-count scorer and sparse rank mask have explicit transition checks, and clean policy endpoints are compared with the recording/reference path.

## Additional best-effort T05/T08 clean candidate (prepared, not yet accepted)

The zero-rejection counter suggests a cheaper exact forced-support path than either original T05 implementation. In the validated public domains, Go already excludes every remaining hold containing a hard-zero rank. Soft behavioral factors preserve positive support. Empirical raw weights originate as positiveu64 values; at most four nonzero depletion ratios, each at least1/6, and four positive likelihood factors, each at least1e-6, keep a positive result above~7.7e-28. Underflow therefore cannot turn a compatible, positive-prior hand into zero support. Finite test priors retain the exact lookup path.

A separate clean candidate uses the already-hoisted raw weight and packed physical compatibility for forced-row support, with a debug invariant and a dedicated full-weight comparison over legal public domains including Go and minimum-positive likelihoods. This deliberately remains private to the validated solver; it is not a generic Boolean replacement for arbitrary floating-point weights. It also replaces the experimental typed-hasher enum with a concrete raw-prior map type, preserving full-key equality. These candidates remain unaccepted until clean correctness/performance checks pass.

<!-- d7-stack -->
### T07 cached dense priors after physical corrections — confirmation screen

Instructions reduced 0.511%; cycles reduced 1.124%. Exact parity: True. Evidence: `d7-stack.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d8-repeat -->
### T08 reversed-order typed hash confirmation — confirmation screen

Instructions reduced 0.794%; cycles reduced 1.065%. Exact parity: True. Evidence: `d8-repeat.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d6-repeat -->
### T06 reversed-order simple scratch confirmation — confirmation screen

Instructions reduced 1.473%; cycles reduced 0.774%. Exact parity: True. Evidence: `d6-repeat.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d5-repeat -->
### T05 reversed-order Boolean support confirmation — confirmation screen

Instructions reduced 0.785%; cycles reduced 1.055%. Exact parity: True. Evidence: `d5-repeat.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d-layout-repeat -->
### T10 reversed-order oriented table confirmation — confirmation screen

Instructions reduced 4.297%; cycles reduced 5.027%. Exact parity: True. Evidence: `d-layout-repeat.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d2-e0.0001 -->
### N2 repaired local tolerance 0.0001 versus corrected eager baseline — confirmation screen

Instructions reduced -8.227%; cycles reduced -4.118%. Exact parity: False. Evidence: `d2-e0.0001.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d2-e0.001 -->
### N2 repaired local tolerance 0.001 versus corrected eager baseline — confirmation screen

Instructions reduced -8.198%; cycles reduced -4.030%. Exact parity: False. Evidence: `d2-e0.001.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

<!-- d2-e0.01 -->
### N2 repaired local tolerance 0.01 versus corrected eager baseline — confirmation screen

Instructions reduced -7.453%; cycles reduced -3.266%. Exact parity: False. Evidence: `d2-e0.01.comparison.json`. Positive tolerance, where tested, is a local experimental setting and is never retained in the playing model.

## Clean physical-loop confirmation — passed

Seven paired complete-hand comparisons cover six unique deals (one reversed-order repeat), plus full forecasts on two openings and80 hidden-information mutations across10 positions. All complete-hand decisions and EV/WP values matched bit-for-bit, all moves were legal, and all tested hands played eight cards. Retained source was checked against all74 Rust source/manifest files hashed for the frozen baseline binary: zero differences. Source/assets/binary verification passed.

| Role / measure | Before CPU s | Corrected CPU s | Before wall s | Corrected wall s |
|---|---:|---:|---:|---:|
| pone first decision | 55.010126 | 36.633176 | 56.786483 | 37.833405 |
| pone whole hand | 55.352691 | 36.805696 | 57.135464 | 38.018005 |
| dealer first decision | 4.495036 | 2.774736 | 5.056377 | 2.918359 |
| dealer whole hand | 4.540404 | 2.806664 | 5.103442 | 2.952360 |

Means weight each unique deal equally after averaging the repeated deal. Aggregate measured work fell28.737% instructions and31.804% cycles. This clean native comparison retains the previous nine optimizations on both sides and changes only the physical loop, sparse legal-rank traversal and known running count. It does not yet establish the fresh-PGO result. Evidence: `final-native-summary.json`, per-hand raw records, `baseline-source-verification.json`.

## Build-cache mistake found and corrected before retention

The first clean layout comparison reused the preceding physical-loop executable and test binary from the shared Cargo target directory. Both parent and candidate SHA256 values were identical; its test binary embedded `clean-candidate`, not `clean-layout`. The timing results from `layout-evaluation` are INVALID, preserved with an `INVALID.json` notice, and cannot support a layout conclusion. The job was stopped during its final repeat; no useful solved-hand comparison was discarded.

All three earlier screening binaries are distinct and embed their respective expected frozen roots. The clean physical test binary is also distinct, embeds `clean-candidate` and registers both newly added physical-correction tests. An independent isolated rebuild of the physical native executable is now required to match its original SHA256. The corrected layout run uses its own target directory, asserts the expected test-source root, and rejects an unchanged candidate executable. All subsequent clean variants and PGO builds must use distinct source-specific target directories. Build stages may use normal scheduling with three Cargo workers while no performance measurement runs; matched timing stages retain background/nice20 scheduling.

The isolated physical rebuild passed executable identity verification. Raw hashes differ only in48bytes:16generated Mach-O UUID bytes and32signature bytes hashing that metadata. After excluding the LC_UUID payload and the LC_CODE_SIGNATURE blob, every remaining byte—including all executable code, data, symbols and other load commands—is identical. Both raw hashes, the normalized hash and excluded ranges are preserved in `physical-artifact-identity.json`; the initial raw-hash rejection is preserved in `identity-correction-1`. Consequently the seven clean physical comparisons remain valid. The layout comparison is rerunning separately as `layout-evaluation-v2`.

## Corrected uncertainty-tolerance results

Against the corrected eager scorer, the repaired N2 variants at local tolerances0.0001,0.001 and0.01 still cost4.12%,4.03% and3.27% more cycles, respectively. Instructions increased8.23%,8.20% and7.45%. All three altered conditioned outputs/EV somewhere. These were fixed-action subtree tests, so an unchanged requested-action label is not evidence of unchanged live candidate selection. No approximate variant is accepted: the tested tradeoff gives up exactness without beating the improved exact baseline. Their outputs and local-tolerance tests are retained for research; no global playing-strength guarantee is attached to epsilon.

Corrected clean layout-plus-scratch testing (`layout-evaluation-v2`) passes exact parity, but shows only2.193% fewer instructions/1.556% fewer cycles over the clean physical loop. Its elapsed CPU differences are noisy. A separate clean buffer-only variant now removes the oriented table representation to determine whether that added complexity earns its place. The original invalid A/A run is preserved solely as a build-error record and timing-noise control, never as a layout result.

## Final native candidate selection

All clean extra-candidate comparisons passed: three complete deals plus a reversed repeat, two full forecasts, and 80 hidden-information mutations. The concrete prior map and validated Boolean support together save **2.885% instructions / 2.121% cycles** over the simpler buffer-only parent. That stack proceeds to fresh PGO confirmation.

The corrected orientation-plus-buffer implementation saves 1.556% cycles over the physical-only parent; removing orientation costs only 0.349% cycles on the separate clean comparison. Retain the simple reusable buffer and omit the approximately 60 extra lines of table-orientation machinery. The cached dense-index alternative is correct and saves 1.124% cycles in its repeated screen, but needs additional hand/index representation; choose the simpler typed map addressing the same raw-prior lookup instead of stacking both.

Final retained candidate consists of sparse physical legal-rank traversal, direct forced-step handling and selected-endpoint reuse, the known-count scorer, block-local weight-buffer reuse, a concrete full-key prior map, and Boolean support for forced rows. All other inherited exact optimizations remain. There are no retained pruning switches or positive tolerance. Only `model283.rs`, `model283_physical.rs`, and their tests differ from the retained source. Final code review found no additional defect; see `final-source-review.json`.

The same empirical weight, hand order, arithmetic/normalization order and tie rules remain at every contested policy decision. The support shortcut is private to validated legal domains and has more than 50,000 direct comparisons against full weighting, including Go and the minimum positive likelihood. This is semantic preservation evidence, not a new strength claim from a few games.
