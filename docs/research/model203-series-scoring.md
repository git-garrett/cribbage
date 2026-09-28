# Model 20.3 repeated series scoring

Candidate based on committed denominator optimization `49d9db3071669b8599b13284cc2b014b4853745f`. The final cache size is 1 MiB, selected after the size sweep below; the initial 64 KiB evaluation is preserved separately. The running 20.3-versus-20.2 benchmark remains on `7414667`; it was not restarted or modified for these experiments.

## Change and exactness

Add a 131,072-slot, direct-mapped memo of pure pegging scores to the WP continuation evaluator. It allocates 1 MiB lazily when a sequence of at least three cards needs scoring. Shorter sequences retain the unchanged direct scorer. The memo shares the continuation evaluator's lifetime and is cleared by its explicit clear operation; it does not grow or require persistent assets.

The 41-bit key contains all eight rank slots, the sequence length, and the running count. These are every input read by the existing scorer. Hands, player, go, last player, board scores, role, and posterior weights cannot change that immediate score. Each 64-bit entry stores the complete key and integer result. Hash collisions replace entries only after full-key comparison; they can lose reuse but cannot substitute another sequence's score. Valid stored keys have nonzero length, distinguishing them from empty slots.

No scoring rule, legal action, posterior support, probability calculation, summation order, pruning rule, tie-break, or existing cache limit changes. The EV continuation path is unchanged. This memo avoids recalculating scores for sequences recurring inside a solve; it does not depend on a future game repeating the same deal.

## Initial 64 KiB speed measurements

Release builds used the same frozen Model 20.3 assets. The baseline includes the denominator improvement and excludes the rejected weight-buffer experiments. Eighteen fixed regression positions (six discovery, twelve held-out validation) were replayed twice, reversing baseline/candidate order for the second repetition. Worker CPU time is used because the existing six-worker benchmark continued running during these measurements.

| Comparison | CPU reduction |
| --- | ---: |
| All 36 paired decisions | 9.89% |
| Discovery | 10.13% |
| Held-out validation | 9.58% |
| Dealer positions | 6.37% |
| Pone positions | 10.48% |
| Baseline-first repetition | 9.84% |
| Candidate-first repetition | 9.94% |

Aggregate CPU was 97.444959 baseline seconds versus 87.808628 candidate seconds. These are individual decision fixtures, not whole-hand pegging totals or a full-game throughput measurement. They do not establish a new 10k-game ETA.

Six cheap/middle positions received 20 additional alternating-order repetitions each. The two positions that looked slower in the held-out replay were included explicitly. Excluding the first repetition of each position:

| Fixture | Baseline mean CPU | Candidate mean CPU | Difference |
| --- | ---: | ---: | ---: |
| `20.0-left-g0-h1-s4` | 22.495 ms | 22.381 ms | -0.114 ms |
| `20.1-left-g0-h1-s3` | 38.937 ms | 38.133 ms | -0.804 ms |
| `20.1-left-g1-h1-s2` | 198.191 ms | 196.844 ms | -1.347 ms |
| `20.1-left-g1-h1-s7` | 16.573 ms | 16.413 ms | -0.160 ms |
| `20.0-left-g1-h6-s4` | 17.829 ms | 18.008 ms | +0.179 ms |
| `20.1-left-g1-h6-s3` | 56.571 ms | 56.660 ms | +0.090 ms |

The fixture IDs identify the historical source positions; both tested workers execute Model 20.3. The change is not faster on every cheap decision, but the measured small regressions are much smaller than its opening savings.

## Initial 64 KiB memory and correctness

One expensive opening-pone position was checked separately using macOS `time -l`. Peak RSS was 78,692,352 baseline bytes versus 76,955,648 candidate bytes. Treat the lower observed value as process/allocator variation, not a memory-saving claim: this initial variant added a bounded 65,536-byte table per active WP memo, plus its vector metadata. This is not a new multiworker memory-capacity calibration or an RSS measurement of the final 1 MiB variant.

All 156 timed paired comparisons matched exactly for action, card, EV, and WP, using serialized-output comparisons that retain signed zero. The separate memory comparison also matched. No playing-output regression was observed.

The release `model91::` test suite passed, including WP oracle, winner, go/reset, and posterior parity tests. Scoring validation covers:

- Every physically legal rank sequence through five cards with count at most 31, plus targeted long sequences, against the independent reference scorer on both first and repeated lookup.
- Real hash collisions between sequences with different scores, repeated replacement, and clearing/reuse.
- Length and count as separate key fields, irrelevant context changes, and allocation-free short-sequence scoring.

The build emitted only the existing unused `WeightedEntry` fields warning. The diagnostic CPU-timing adapter was removed from the source patch after testing.

## Cache-size selection

The follow-up compared nine power-of-two table sizes, from 16 KiB through 4 MiB. Each worker differed only in `SCORE_CACHE_BITS`, used identical release flags and assets, and was warmed identically. Execution order rotated between fixtures; the held-out comparisons used two repetitions with reversed order. The old six-position discovery set screened sizes, followed by the twelve held-out positions. These are repeated regression fixtures used to tune an exact optimization, not new independent playing-strength samples.

Initial discovery sweep (six decisions per size):

| Table size | CPU seconds | CPU reduction versus 64 KiB |
| --- | ---: | ---: |
| 16 KiB | 24.770237 | -1.14% |
| 32 KiB | 24.649903 | -0.65% |
| 64 KiB | 24.491870 | reference |
| 128 KiB | 24.397232 | 0.39% |
| 256 KiB | 24.299208 | 0.79% |
| 512 KiB | 24.331940 | 0.65% |

The held-out repeat favored 512 KiB more clearly:

| Table size | CPU seconds over 24 decisions | CPU reduction versus 64 KiB |
| --- | ---: | ---: |
| 64 KiB | 38.324269 | reference |
| 128 KiB | 38.250288 | 0.19% |
| 256 KiB | 38.287045 | 0.10% |
| 512 KiB | 38.008678 | 0.82% |

The 512 KiB reduction was 0.70% and 0.95% in the two execution orders, with gains in both roles. Since this was the largest initial size, a second discovery sweep tested the upper range:

| Table size | CPU seconds | CPU reduction versus 512 KiB in this sweep |
| --- | ---: | ---: |
| 512 KiB | 24.397833 | reference |
| 1 MiB | 24.312794 | 0.35% |
| 2 MiB | 24.248320 | 0.61% |
| 4 MiB | 24.341179 | 0.23% |

The final held-out repeat put 1 MiB and 2 MiB effectively level:

| Table size | CPU seconds over 24 decisions | CPU reduction versus 512 KiB |
| --- | ---: | ---: |
| 512 KiB | 38.097621 | reference |
| 1 MiB | 37.889367 | 0.55% |
| 2 MiB | 37.907169 | 0.50% |

The 1 MiB reduction was 0.72% and 0.37% across execution orders. Pone positions used 0.74% less CPU than 512 KiB; dealer positions used 0.37% more. The 0.047% aggregate difference between 1 MiB and 2 MiB is too small to establish a meaningful speed distinction. Select 1 MiB because it reaches this plateau with half the memory of 2 MiB. The sweep does not establish a universal optimum across hardware or every possible position.

All 228 measured decisions across these four sizing phases matched the saved denominator-baseline action/card/EV/WP outputs exactly. An additional 120 paired cheap/middle-position comparisons of 1 MiB against 64 KiB also matched. Their means, excluding each position's first repetition:

| Fixture | 64 KiB CPU | 1 MiB CPU | Difference |
| --- | ---: | ---: | ---: |
| `20.0-left-g0-h1-s4` | 21.636 ms | 21.825 ms | +0.189 ms |
| `20.0-left-g1-h6-s4` | 17.760 ms | 17.907 ms | +0.146 ms |
| `20.1-left-g0-h1-s3` | 37.431 ms | 37.731 ms | +0.300 ms |
| `20.1-left-g1-h1-s2` | 192.999 ms | 193.576 ms | +0.577 ms |
| `20.1-left-g1-h1-s7` | 16.184 ms | 16.216 ms | +0.032 ms |
| `20.1-left-g1-h6-s3` | 55.518 ms | 55.967 ms | +0.449 ms |

Thus the larger table buys a modest aggregate gain at a measurable cheap-decision cost of 0.03–0.58 ms in these repeated checks. Its table allocation is exactly 1,048,576 bytes per active WP memo, 960 KiB more than the initial variant. The original 9.89% reduction versus the no-score-cache denominator baseline was measured at 64 KiB; the later relative gains were measured in separate controlled comparisons and must not be presented as a directly measured combined speedup or benchmark ETA improvement.

The release `model91::` suite was rerun with the final 1 MiB constant and passed, including collision replacement and independent scoring/WP oracle checks. Only the pre-existing unused-field warning remained.

## Reproduction and assessment

Raw initial artifacts are under `/private/tmp/cribbage-203-scoring`: `replay.py`, `tails.py`, `tails-validation.py`, `memory.py`, their result JSON files, `summary.json`, `candidate.patch`, the frozen 64 KiB `candidate-worker`, and `timed-decision-worker.rs`. The summary records baseline revision and binary/source/fixture SHA-256 hashes. Frozen fixtures and shared assets remain under `/private/tmp/cribbage-model203-vs-model202-10k-20260927-v1`; the immutable denominator baseline binary is `/private/tmp/cribbage-203-buffer/reference-worker`.

Size-sweep artifacts are in its `sizes` subdirectory: `sweep.py`, `confirm.py`, `upper.py`, `upper-confirm.py`, `selected-tails.py`, their result files, `summary.json`, `builds.json`, and frozen `worker-*k` binaries. `builds.json` records every binary hash, source-template and timing-adapter hashes, table dimensions, and the selected size.

Retain this improvement with a 1 MiB table. Correctness has both a complete-key invariance argument and exact replay/oracle checks. The remaining limits are finite timing coverage on this host, small cheap-decision overhead, and no measured full-game throughput gain yet. No benchmark restart was performed.
