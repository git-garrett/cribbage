# Model 20.5: independent pruning-bound assessment

2026-09-30. Isolated prototype; retained Model 20.5 sources, production and the running 20.3/20.4 benchmark were not changed. Raw results, source archive, build receipts, hardware counters and hashes accompany this report.

## Methods and safe information boundaries

- **Control:** existing root pruning, assigning WP=1 to unexamined worlds.
- **Cheap range:** conservative per-player scoring envelopes from remaining ranks and the active series, then the maximum actual root WP over that score rectangle. No assumption that the empirical WP function is monotonic.
- **Exact endpoints:** enumerate all legal continuations for each hypothetical pair of hands and memoize reachable terminal score pairs at conditional states. Convert those endpoints through the current root utility.
- **Direct maximum:** traverse the same legal continuation space but memoize only its maximum root utility. A maximum of 1 permits a safe early return.

C sees both hands only inside each hypothetical world. A/B policy calculations and posterior weights remain unchanged and use only each actor’s legal observation. Both exact methods use the same ceiling and preserve canonical surviving histograms and final EV/WP summation. The original strict cutoff and floating-point allowance remain; ties complete. The implementation asserts actual visited-world utility never exceeds its ceiling.

Bounds share calculations across worlds with identical remaining ranks but different opponent discards. Those discards can affect the legal-information policy; they do not change the set of rule-legal endpoints. This prevents repeating the bound search for dozens of equivalent discard variants. All three methods use this sharing.

The first candidate needs no bound before an incumbent exists. The primary experiment computes bounds lazily for challengers and retains conditional results within that solve. A separate endpoint treatment carries already-computed geometry into subsequent decisions of the same hand, with fresh root utilities. It does not precompute an otherwise-unused first-candidate tree. No policy actions or exhaustive path graph are retained. No cheap/exact hybrid was tested.

## Timing design

One experimental executable selects methods per request. PGO was freshly trained equally on control, cheap, endpoints and direct, using four fixed training decisions. Original candidate/world ordering is preserved in the primary comparison. Each request runs in a fresh process warmed by the same fixture; variant order rotates and the second pass reverses fixture order. Eighteen original fixtures have three PGO passes. Six new actual benchmark openings, stratified by two/three/four legal ranks and early/late board positions, have two passes and an additional unchanged-control replay. These are fixture studies, not a population-weighted game-throughput estimate.

CPU seconds, wall time, instructions, cycles, P/E-core time and effective frequency counters are retained per request. Core mix and effective clocks varied substantially, especially in the first confirmation pass; CPU time alone is not core normalization. Tables below average each fixture’s median CPU time. Small differences must be read against repeated-control drift and instruction/work counts; they are not promised production gains. The six held-out cases were not PGO training inputs.

Bound time includes state preparation, unique-hand sharing, traversal/envelope construction, utility lookup and weighted suffix construction. Destruction of bound caches is included in total decision time but was not separately timed. Peak footprint is process-wide, not just the bound cache.

## Original fixtures, three passes

| Decision group | Method | CPU seconds | Change versus control | Bound ms | Fewer computed rollout worlds | Fewer instructions |
|---|---|---:|---:|---:|---:|---:|
| dealer-first | cheap | 1.6768 | -0.08% | 5.962 | 0.15% | -0.14% |
| dealer-first | direct | 1.6102 | +3.90% | 11.703 | 5.16% | +4.85% |
| dealer-first | endpoints | 1.6155 | +3.58% | 13.325 | 5.16% | +4.79% |
| dealer-first | none | 1.6755 | +0.00% | 0.001 | 0.00% | +0.00% |
| dealer-later | cheap | 0.0244 | -8.03% | 1.069 | 0.17% | -4.12% |
| dealer-later | direct | 0.0218 | +3.36% | 0.276 | 12.39% | +5.66% |
| dealer-later | endpoints | 0.0227 | -0.36% | 0.278 | 12.39% | +5.56% |
| dealer-later | none | 0.0226 | +0.00% | 0.001 | 0.00% | +0.00% |
| pone-first | cheap | 11.0892 | +0.25% | 12.590 | 0.26% | +0.21% |
| pone-first | direct | 10.6255 | +4.42% | 84.741 | 3.17% | +2.70% |
| pone-first | endpoints | 10.7393 | +3.40% | 107.426 | 3.17% | +2.59% |
| pone-first | none | 11.1169 | +0.00% | 0.001 | 0.00% | +0.00% |
| pone-later | cheap | 0.0882 | -0.21% | 1.785 | 1.88% | -0.96% |
| pone-later | direct | 0.0805 | +8.57% | 1.146 | 19.43% | +11.10% |
| pone-later | endpoints | 0.0803 | +8.82% | 1.227 | 19.43% | +11.10% |
| pone-later | none | 0.0881 | +0.00% | 0.001 | 0.00% | +0.00% |

Positive change means faster/fewer. Computed worlds include speculative work already done in 32-world batches, rather than only consumed worlds.

## New held-out pone openings, two passes

| Decision group | Method | CPU seconds | Change versus control | Bound ms | Fewer computed rollout worlds | Fewer instructions |
|---|---|---:|---:|---:|---:|---:|
| pone-first | cheap | 10.1230 | +0.79% | 12.585 | 0.53% | +0.58% |
| pone-first | direct | 9.1102 | +10.72% | 62.589 | 9.12% | +11.96% |
| pone-first | endpoints | 9.1024 | +10.80% | 84.339 | 9.12% | +11.88% |
| pone-first | none | 10.2040 | +0.00% | 0.001 | 0.00% | +0.00% |

Positive change means faster/fewer. Computed worlds include speculative work already done in 32-world batches, rather than only consumed worlds.

Repeated unchanged-control drift: -0.80% in summed fixture medians, with -0.031% instruction change. This is a noise check, not an optimization.

## Ordering interaction

The oracle experiment puts the known winner first for **every** method, including control. It excludes the cost of discovering that winner and is not a deployable ordering strategy.

| Decision | Method | CPU seconds | Change versus equally ordered control | Fewer computed worlds |
|---|---|---:|---:|---:|
| dealer-first | cheap | 1.5833 | +2.33% | 0.90% |
| dealer-first | direct | 1.3591 | +16.16% | 15.77% |
| dealer-first | endpoints | 1.3658 | +15.75% | 15.77% |
| dealer-first | none | 1.6210 | +0.00% | 0.00% |
| pone-first | cheap | 10.7972 | -0.87% | 0.49% |
| pone-first | direct | 9.6074 | +10.24% | 7.86% |
| pone-first | endpoints | 9.7114 | +9.27% | 7.86% |
| pone-first | none | 10.7036 | +0.00% | 0.00% |

On original pone fixture 5, exact bounds saved no worlds in normal order. With the winner first, they saved 13.15%; direct maximum measured 7.58 s versus 9.65 s for the equally ordered control. Thus ordering can make bound work pay where it previously did not. Reassess the preferred bound after adding a practical ordering method.

## Complete pegging hands and conditional reuse

All three replayed hands completed all eight card plays. The close-race board is reported separately. These whole-hand totals are measured, not extrapolated from partial-hand fixtures. There is one pass per hand, suitable for parity/work accounting; tiny timing differences here are not established gains.

| Hand group | Method | Role | First decision CPU s | Whole pegging hand CPU s |
|---|---|---|---:|---:|
| Two ordinary hands | none | pone | 9.5253 | 9.6693 |
| Two ordinary hands | none | dealer | 1.3157 | 1.3440 |
| Two ordinary hands | cheap | pone | 9.5443 | 9.6868 |
| Two ordinary hands | cheap | dealer | 1.3741 | 1.4030 |
| Two ordinary hands | endpoints | pone | 9.4876 | 9.5859 |
| Two ordinary hands | endpoints | dealer | 1.3097 | 1.3336 |
| Two ordinary hands | direct | pone | 9.5255 | 9.6260 |
| Two ordinary hands | direct | dealer | 1.2946 | 1.3179 |
| Two ordinary hands | endpoints-retained | pone | 9.3384 | 9.4409 |
| Two ordinary hands | endpoints-retained | dealer | 1.2887 | 1.3174 |
| Close-race board | none | pone | 11.0693 | 11.2528 |
| Close-race board | none | dealer | 1.1509 | 1.1780 |
| Close-race board | cheap | pone | 11.2073 | 11.4072 |
| Close-race board | cheap | dealer | 1.2580 | 1.2931 |
| Close-race board | endpoints | pone | 11.7391 | 11.9430 |
| Close-race board | endpoints | dealer | 1.0399 | 1.0616 |
| Close-race board | direct | pone | 11.2352 | 11.4126 |
| Close-race board | direct | dealer | 1.0306 | 1.0506 |
| Close-race board | endpoints-retained | pone | 11.2837 | 11.4707 |
| Close-race board | endpoints-retained | dealer | 1.0831 | 1.1039 |

Conditional reuse succeeded but had little downstream bound work to remove:

| Hand | Later endpoint visits without reuse | With reuse | Later bound ms, no reuse | With reuse |
|---|---:|---:|---:|---:|
| 20.3-left-10-h2-s4 | 11,692 | 646 | 2.763 | 1.677 |
| 20.3-left-1016-h4-s2 | 720 | 48 | 0.247 | 0.186 |
| close-race | 10,421 | 917 | 3.218 | 1.582 |

In the first hand, all 646 retained-state accesses were hits, versus 11,692 visits without retention. This saved about 1.1 ms. The retained table carried over 524,146 entries. In the close-race hand, direct maximum stopped at utility 1 where possible: 73,140 visits and 19 ms of bound calculation, versus 611,722 visits and 137 ms for endpoints, while achieving the same pruning.

## Where bounds fail to pay

- Skip a separate bound for the first candidate, and bypass rank-forced decisions as already done.
- Do not disable all later decisions: exact bounds saved 44.6% of rollout worlds in one 3-vs-3 state and 42.4% in one 2-vs-2 state. Other states at those same depths saved nothing. Remaining-card count alone does not identify a good cutoff.
- When the candidate leaves at most one card per player, every ensuing choice is forced. The separate bound duplicates an already-cheap rollout. One 2-vs-1 root saved 41.7% of worlds but did not reduce total instructions. Skip a separate prepass there, or consider reusing its unique terminal outcome in a future experiment.
- The cheap range was genuinely cheaper at openings, so it survives the user’s initial cost criterion. It was often more expensive than exact search late: original later-dealer bounds averaged about 1.13 ms for range versus 0.29 ms for direct. Its broad impossible-score rectangle is the cause. Do not assume “cheap” at every depth.
- Some candidate orders never produce a losing challenger until the final action; bounds then add overhead without pruning. Better ordering is the relevant next experiment.
- No opening challenger was eliminated before any rollout by either range or exact bounds in these tests, including oracle ordering. The savings came from earlier stopping within a challenger’s world list. A simple cheap-then-exact prepass therefore would not have skipped any exact construction in this corpus, even though range construction is cheaper.
- Retaining endpoints between live decisions improves cache hits but saved only fractions of a millisecond to about 1.6 ms in these hands. That does not justify choosing the larger endpoint representation solely for this reuse.

## Safety, interpretation and retained state

The compact transition implementation was compared exhaustively below 2,048 deterministic random/targeted roots: 440,242 reference-state visits, including go, 31, resets, duplicates, runs and game-ending scores. Endpoint sets matched the reference traversal; direct maxima matched endpoint maxima bit-for-bit; every cheap rectangle contained the reachable endpoints. A separate numerical check covered 1,204,160 weighted prefixes, up to 200,000 worlds, including ties and one-ULP near ties. All 439 Rust tests passed.

All 347 exact replay comparisons match retained 20.5 physical plays and EV/WP bits, including 15 complete-hand trace comparisons. Across 83 paired runs, direct and endpoints had identical weighted ceilings, prune flags and consumed/computed world counts. This is an exact computational optimization: it changes no beliefs or policy and discards a candidate only when its conservative maximum cannot beat an evaluated incumbent. A finite corpus is not a full-game strength study, and no new 10k strength benchmark was started.

The exact methods are credible performance candidates. Direct maximum is the preferred starting point because it obtains the same pruning with lower bound-construction work and less memory, and can stop once WP=1. Endpoint retention did not repay its extra storage in the tested hands. Cheap range remains a low-cost opening candidate, but its standalone savings were small. This comparison does not establish a universal optimum; practical ordering and any proposed gating still need their own exact-parity and timing comparison. No hybrid was implemented.

No engine change was promoted to retained 20.5. The final integrity receipt verifies retained source hashes and the active benchmark binary hash. No production deployment, benchmark restart, commit or push occurred in this assessment.
