# Model 20.1 cache stacking experiments

Baseline: `a18c2a7`, the zero-count-only WP memo rule, including the previously accepted fast hash, two-card-tail bypass, and 32-byte full-key entries. These experiments leave the frozen 20.1-versus-20.0 benchmark unchanged.

## Result

Retain only the count-first admission check. It saves 2.26% CPU in discovery and 1.77% in independent validation (1.45% against the freshly rebuilt unchanged control), on top of the zero-count-only winner. This is a modest improvement with the same cache entries and arithmetic results. Keep the one-million-entry maximum and keep zero-count states with more than four cards eligible. The 3–4-card restriction and 200k cap do not add a speed benefit; the combined restriction is worse. The doubled limit is effectively flat. The 300k and 400k follow-up measured 0.03% and 0.36% CPU savings respectively; both limits are non-binding on this corpus and offer no demonstrated cache-retention improvement. If a lower maximum is needed as a separate memory budget, 400k is preferable to 300k within the same allocation tier. Neither lower ceiling is needed to avoid clears with the current one-million limit, and the sampled peak of 260,927 is not a guarantee for other decisions.

## Stacked strategies

The earlier 3–4-card restriction is intersected with the zero-count rule. The former larger-zero-count exception is already implied by the winner and therefore adds no admission change. With interior states excluded, the earlier 200,000/800,000 split pool reduces to one active 200,000-entry boundary pool. Keeping an empty interior map would not improve retention, so the experiment implements that effect with the simpler single map. The combined variant applies both restrictions. The doubled limit rechecks the earlier capacity idea against the newly sparse memo.

The additional gate-first variant checks the zero running count before calculating how many cards remain. It changes neither eligible states nor cache contents, but can skip the admission arithmetic for interior states. Each candidate is independently stacked onto the same baseline, not compared against a different earlier version.

## Timing and memory

Positive percentages mean lower cost than the zero-count winner; negative percentages mean slower. RSS is the full worker process peak in decimal MB.

| Corpus and addition | CPU saving | Elapsed saving | Peak RSS: baseline → candidate |
| --- | ---: | ---: | ---: |
| Discovery: Restrict zero-count entries to 3–4 cards | -2.22% | -1.95% | 84.6 → 76.0 MB |
| Discovery: 200,000-entry boundary pool | 0.08% | 0.19% | 84.6 → 70.3 MB |
| Discovery: 3–4 cards plus 200,000-entry pool | -2.48% | -2.11% | 84.6 → 70.1 MB |
| Discovery: Double the limit to 2,000,000 | 0.39% | 0.54% | 84.6 → 83.6 MB |
| Discovery: Check zero count before counting remaining cards | 2.26% | 2.33% | 84.6 → 82.1 MB |
| Validation: Fresh unchanged control | 0.32% | 0.36% | 90.6 → 86.4 MB |
| Validation: Restrict zero-count entries to 3–4 cards | -8.53% | -8.70% | 90.6 → 73.0 MB |
| Validation: 200,000-entry boundary pool | -1.06% | -1.15% | 90.6 → 71.0 MB |
| Validation: 3–4 cards plus 200,000-entry pool | -9.79% | -9.64% | 90.6 → 69.4 MB |
| Validation: Double the limit to 2,000,000 | 0.06% | 0.02% | 90.6 → 78.4 MB |
| Validation: Check zero count before counting remaining cards | 1.77% | 1.98% | 90.6 → 82.2 MB |
| Capacity: 300,000-entry limit | 0.03% | -0.06% | 80.0 → 80.0 MB |
| Capacity: 400,000-entry limit | 0.36% | -0.06% | 80.0 → 91.2 MB |

Whole-process RSS varies even for the unchanged control and non-binding limit changes. Those differences do not demonstrate a reduction in WP memo allocation when the same entries are stored without any clears.

## Cache behavior

Across all 24 positions, the baseline had zero full clears and at most 260,927 admitted entries in a single memo. Four short decisions bypassed the WP evaluator. The 200,000-entry limit can therefore introduce clears in two positions, while 300,000, 400,000, one million, and two million all avoid clears on this corpus. Because the map grows on demand, non-binding limits do not change the entries retained or the allocation tier reached. Both 300,000 and 400,000 fit within a HashMap tier of 458,752 usable entries; 400,000 provides more headroom within that tier. These sample maxima are not a global bound.

The five-card zero-count states received 1,247,202 lookups and 1,062,015 hits (85.15% overall; 87.70% in the largest validation opening). Restricting admission to 3–4 cards loses those useful continuations. The previously beneficial restriction on the broad cache is counterproductive after interior states are already excluded.

## Method and correctness

Discovery replays 12 actual contested decisions from game 0, hands 1 and 7, in both orientations. Validation replays 12 different decisions from game 1, hands 1 and 6. Each corpus has six dealer and six pone positions; each candidate runs three repetitions. Candidate order rotates across positions and repetitions. Asset loading is warmed, and the results sum the per-position median process CPU and elapsed time. The capacity follow-up compares 300k and 400k against the baseline on both corpora combined, with two repetitions per position. Validation also includes a freshly compiled unchanged source control. Timings are controlled decision replays under the concurrent paired benchmark load, not measurements of full-match throughput.

Every comparison checks exact serialized card, EV, and WP equality with the baseline, and selected-card equality with the original game record. All binaries use the same frozen Model 20.1 assets and legal actor observations. Profiling is excluded from the timing experiment and covers all 24 positions. The instrumented baseline binary was frozen during the previous structural-cache experiment and uses the same zero-count admission rule.

All memo keys preserve the complete pegging state, board scores, and role. Every cache remains decision-local. Admission and eviction changes can cause recomputation but cannot substitute an approximate WP. No persistent action table or cross-hand lookup is introduced.

## Verification

All 456 candidate comparisons and 36 unchanged-control comparisons preserved exact selected cards, EVs, and WPs. The retained change passed 72 paired comparisons across 24 distinct positions. All 24 profiling decisions matched the frozen expected outputs. Release WP oracle/key regression checks, Model 20 live cache/review integration checks, and `git diff --check` passed. The existing unused `WeightedEntry` fields warning is unchanged. Timing, profiling, and rejected candidate code are absent from the retained source.

## Evidence

Corpora, frozen variant sources, scripts, binary hashes, results, and supervised job specifications are archived under `benchmarks/model20/cache-stacking-20260926`. Binaries and runtime jobs remain under `/private/tmp/model201-cache-stacking-20260926`. The implementation branch is `work/model201-fast-hash`.
