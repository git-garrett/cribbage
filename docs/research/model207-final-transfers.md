# Model 20.7 final transfer trials

The user accepted preservation of the opponent-hand, pegging-endpoint and counting association on October 4, 2026. That root valuation is incorporated in the existing Model 20.7 worktree; the slower bounded variant and quotient lookup are excluded. No scored benchmark or CPU experiment was active at the initial check. Completed experiment source snapshots and binaries remain frozen.

The accepted correlation prototype won 67 of 128 pilot games against the previous 20.7, with 4 candidate-favored reciprocal pairs, 1 control-favored pair and 59 splits. That is not proof of a strength gain. The user explicitly accepts some performance cost for playing power and chose to retain this valuation change.

## Sequential plan

| Order | Idea | Trial | Guard |
| --- | --- | --- | --- |
| 1 | Exact terminal certificates | Reuse decision-local proofs that every rule-legal continuation has the same final score pair. The new root valuation no longer builds old root bounds, so test a cheap, early-aborting certificate search only at four-or-fewer-card tails before a non-forced policy call. | Exhaustive endpoint oracle plus exact physical choice and EV/WP bits. Never use equal utility alone as an endpoint certificate. |
| 2 | Batch-union support filtering | Avoid constructing an evidence row when all legally conditioned queries in a batch assign it zero weight, while preserving later cache access and refill correctness. | Preserve rank/weight accumulation order, physical fallback, and query isolation. |
| 3 | Reuse physical bounds inside inner policy decisions | Assess whether bounds produced during the root solve cover inner counterfactual states and avoid enough evaluator work to pay for their bookkeeping. | Inner actors retain their own legal beliefs and utility. No hidden-card policy leakage; exact pruning with a rounding allowance. |

Canonical job: `/private/tmp/cribbage-207-final-transfers-20261004/job-v1.json`.

Each trial is stacked onto accepted earlier winners only. Six workers run fresh PGO builds, full Rust tests, 128 current and 32 historical decision checks, review cases, and matched core/frequency timing pairs. Pone first-decision latency is primary. Actual whole-hand totals are measured independently. A plausible screen earns one bounded held-out confirmation. Tests stop on a demonstrated failure; there are no blind retries. A later audit found a concurrent four-worker 28.3-versus-20.6 scored benchmark, started at 22:34 UTC; the six trial workers bring total allocation to ten on the 12-core Mac (six P, six E). Its separately frozen engines remain untouched. These results use concurrent control/candidate pairs and hardware-match checks; they must not be described as exclusive-machine measurements. Frozen baseline model assets and source/binary hashes are retained. Final incorporation of further winners and durable archival use a foreground stage.

## Interpretation limits

Terminal certificates are judged on both isolated positions and the first actual decision in complete-hand runs. A gain confined to one separately linked harness does not establish a general gameplay-opening gain. Batch-support filtering can reduce the number of rows yet lose by fragmenting reusable evidence. Root physical geometry may miss inner counterfactual states because each actor must retain its own legally informed posterior; those states cannot simply be omitted using the other player’s hidden hand. All three tests retain these costs and record mechanism counters.

Status: complete; see measured results below.


## Completed results

The correlated root valuation remains incorporated by explicit user choice. These three trials require exact choices and valuation bits; their intended benefit is computational only. No further playing-strength approximation was introduced.

| Trial | Control | Decision | Pone opening gain |
| --- | --- | --- | ---: |
| 01-terminal-certificates | baseline | set-aside | 2.064% |
| 02-batch-support | baseline | set-aside | -133.311% |
| 03-inner-bounds | baseline | set-aside | -22.664% |

### 01-terminal-certificates

Rust tests passed: 472 tests across 23 targets.
Reported phase: held-out confirmation; 12 pone-opening fixtures, two paired repetitions each. These are Mac measurements, not production AMD timings.

| Timing | Control wall s | Candidate wall s | Gain |
| --- | ---: | ---: | ---: |
| pone-first | 10.799678 | 10.576721 | 2.064% |
| dealer-first | 1.429319 | 1.370317 | 4.128% |
| Actual whole-hand pegging, pone | 13.579472 | 13.569991 | 0.070% |
| Actual whole-hand pegging, dealer | 1.652847 | 1.620356 | 1.966% |

Opening CPU gain 2.019%; fixture-bootstrap wall-gain 95% interval [1.7669549505434423, 2.4241227846628077]; instruction gain 1.332%; matched hardware pairs 22/24. Acceptance checks: {"confirmed": true, "meaningful": true, "positiveInterval": true, "cpuSupport": true, "hardwareSupport": true, "openingCorroboration": false}.

Mechanism counters from separate untimed diagnostic calls:

- pone-first: certificates probes=1074192 eligible=195244 visited=11862 hits=194702 resolved=123621 entries=11862
- dealer-first: certificates probes=208402 eligible=62288 visited=3241 hits=62507 resolved=33692 entries=3241
- pone-later: certificates probes=0 eligible=0 visited=0 hits=0 resolved=0 entries=0
- dealer-later: certificates probes=43821 eligible=43821 visited=2925 hits=44054 resolved=8884 entries=2925

### 02-batch-support

Rust tests passed: 474 tests across 23 targets.
Reported phase: initial screen; 6 pone-opening fixtures, two paired repetitions each. These are Mac measurements, not production AMD timings.

| Timing | Control wall s | Candidate wall s | Gain |
| --- | ---: | ---: | ---: |
| pone-first | 10.197433 | 23.791772 | -133.311% |
| dealer-first | 1.656949 | 3.490844 | -110.679% |
| Actual whole-hand pegging, pone | 7.785780 | 18.320716 | -135.310% |
| Actual whole-hand pegging, dealer | 1.543079 | 2.542288 | -64.754% |

Opening CPU gain -135.563%; fixture-bootstrap wall-gain 95% interval [-142.01071834542662, -125.6026291847303]; instruction gain -138.059%; matched hardware pairs 1/12. Acceptance checks: {"confirmed": false, "meaningful": false, "positiveInterval": false, "cpuSupport": false, "hardwareSupport": false, "openingCorroboration": false}.

Mechanism counters from separate untimed diagnostic calls:

- pone-first: support requests=33541 hits=206 considered=7108200 rejected=97874
- dealer-first: support requests=5109 hits=248 considered=1799191 rejected=241336
- pone-later: support requests=0 hits=0 considered=0 rejected=0
- dealer-later: support requests=0 hits=0 considered=0 rejected=0

### 03-inner-bounds

Rust tests passed: 473 tests across 23 targets.
Reported phase: initial screen; 6 pone-opening fixtures, two paired repetitions each. These are Mac measurements, not production AMD timings.

| Timing | Control wall s | Candidate wall s | Gain |
| --- | ---: | ---: | ---: |
| pone-first | 10.383294 | 12.736558 | -22.664% |
| dealer-first | 1.788315 | 2.208428 | -23.492% |
| Actual whole-hand pegging, pone | 7.995629 | 10.175307 | -27.261% |
| Actual whole-hand pegging, dealer | 1.616081 | 2.040418 | -26.257% |

Opening CPU gain -22.700%; fixture-bootstrap wall-gain 95% interval [-24.872322799747582, -19.64758246600633]; instruction gain -31.740%; matched hardware pairs 2/12. Acceptance checks: {"confirmed": false, "meaningful": false, "positiveInterval": false, "cpuSupport": false, "hardwareSupport": false, "openingCorroboration": false}.

Mechanism counters from separate untimed diagnostic calls:

- pone-first: geometry root_queries=1791 inner_queries=4236628 inner_hits=14500 tighter=14500 nodes=112673 entries=112673; lazy evaluated=5540557 hits=10849983 skipped=4585584 pruned_lanes=603897
- dealer-first: geometry root_queries=453 inner_queries=1041274 inner_hits=2499 tighter=2499 nodes=12083 entries=12083; lazy evaluated=1081508 hits=1965015 skipped=1705125 pruned_lanes=101270
- pone-later: geometry root_queries=1 inner_queries=0 inner_hits=0 tighter=0 nodes=3 entries=3; lazy evaluated=0 hits=0 skipped=0 pruned_lanes=0
- dealer-later: geometry root_queries=182 inner_queries=13907 inner_hits=181 tighter=181 nodes=2314 entries=2314; lazy evaluated=21651 hits=1625806 skipped=258913 pruned_lanes=2812

## Terminal-certificate interpretation

The independent isolated-position confirmation reproduced a 2.064% pone-opening wall gain, 2.019% CPU gain, and 1.332% instruction reduction (22/24 hardware-matched pairs). However, first pone decisions inside six complete-hand fixtures changed by -0.113% wall and -0.078% CPU; the fixture-bootstrap wall-gain interval was [-0.335%, +0.092%]. Both harnesses execute Model 20.7 and use the accepted correlated root valuation. Complete-hand fixtures cover early, middle and endgame boards with three and four distinct ranks. The complete-hand caller goes through recommend_peg_for_side_with_caches; the isolated worker calls evaluate_decision_with_caches. Both are separately linked executables, so fixture and executable-layout differences remain possible explanations; neither is established as the cause.

The candidate preserves exact physical choices and EV/WP bits. It demonstrably skips some policy calls, but this did not produce a measurable benefit on the directly simulated gameplay opening path. Set aside under the predeclared corroboration criterion; the isolated gain is retained in the report and must not be described as a universal slowdown or as a proved gameplay speedup. No additional unbounded confirmation was launched.


## Batch-support interpretation

The screen required 2.333x as much wall time and 2.356x CPU time for isolated pone openings, with 2.381x the retired instructions. The first pone decision in complete-hand runs required 2.410x wall time. Hardware matching was poor (1/12 isolated opening pairs); nevertheless, the independently measured CPU and instruction increases establish a large regression, not an adoption-quality small signal. No confirmation was warranted.

The separate untimed opening trace recorded 33,541 scoped support requests, 206 hits (0.61%), 7,108,200 evidence rows considered and 97,874 excluded (1.38%). Dealer opening exclusion was greater (241,336 / 1,799,191 = 13.41%), but also regressed. The support-specific eager cache preserved arithmetic and choices but fragmented reuse and saved too little evaluation work. This rejects this eager support-keyed implementation, not every possible method of lazy zero-weight rejection. Trial 3 also tests lazy evidence filling as the prerequisite for useful inner-bound pruning.

All 474 Rust tests passed after fixing the synthetic narrowing-then-expansion fixture, as did 128 current and 32 historical decisions, eight review cases and the timed complete-hand traces with exact physical choices and EV/WP bits.


## Shared-inner-bound interpretation

The combined exact lazy-evidence/shared-geometry screen made isolated pone openings 22.664% slower in wall time and 22.700% slower in CPU time, with 31.740% more instructions. Pone openings in complete-hand runs were 27.256% slower. Hardware matching was poor (2/12 isolated opening pairs), but the CPU and instruction increases independently show a substantial regression; no additional confirmation was warranted.

The diagnostic opening constructed 112,673 physical geometry entries for 1,791 root queries. It received 4,236,628 inner ceiling queries and found only 14,500 hits (0.342%). Every hit tightened the ceiling, but most inner counterfactual states were absent. Lazy evidence skipped 4,585,584 outcome/lane opportunities and pruned 603,897 lanes, yet the combined work still cost more. These counters establish low effective reuse; they do not isolate the fraction caused by actor posterior breadth versus the first root action having no incumbent/geometry or earlier exact cache filling.

The accepted correlated baseline does not already produce reusable exact root geometry. This trial includes the cost of generating it and the lazy evidence mechanism required to benefit from an inner bound. It rejects this combined implementation; it is not a claim that a free bound lookup by itself is costly. All 473 Rust tests passed, along with exact physical choice and EV/WP-bit replay for 128 current positions, 32 historical positions, eight review cases and timed complete-hand traces.


## Final state

Model 20.7 contains accepted correlated counting plus: no additional trial winners. This work did not launch, restart or modify a scored-game benchmark. The separate 28.3-versus-20.6 benchmark remains frozen. Source, assets, binary hashes, raw timings, tests and controllers are archived with this report. No commit, push or deployment was performed.
