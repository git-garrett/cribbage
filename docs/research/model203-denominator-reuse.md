# Model 20.3 cached posterior denominators

Candidate based on `10f4cfb`, compared against benchmark binary revision `7414667926de984eefb90fda79e2f3238e7b915a`. The running 20.3-versus-20.2 benchmark was left unchanged.

## Change and exactness

Store each evidence hand's physical-depletion denominator when constructing the cached evidence entry. That denominator depends on the hand and public opponent-played ranks, all fixed by the evidence key. Both EV and WP evidence builders supply the correct weighting mode. Preserve ascending rank multiplication, the expression `base_weight * (after / before)`, all later likelihood multiply/divide operations, the original hand/summation order, and zero-denominator behavior. No probability support, policy, cache keys, capacities, or pruning rules change.

The straightforward representation adds one `f64` per evidence hand. It trades a small memory increase for less repeated arithmetic; it does not store a reciprocal or fold the denominator into the base weight.

## Results

Eighteen fixed regression positions, six discovery plus twelve held-out validation, were replayed twice in reversed worker order using identical frozen assets and the current optimized baseline. All 36 action/card/EV/WP results matched exactly.

| Comparison | CPU reduction |
| --- | ---: |
| Overall | 2.65% |
| Discovery | 2.74% |
| Held-out validation | 2.53% |
| Dealer positions | 3.82% |
| Pone positions | 2.45% |
| Baseline-first repetition | 2.44% |
| Candidate-first repetition | 2.87% |

Aggregate CPU: 93.456991 baseline seconds versus 90.979023 candidate seconds. These are fixture totals, not whole-hand timing estimates or measured full-game throughput.

Three cheap/middle decisions received 20 alternating-order repetitions each, with all 60 outputs matching exactly. Excluding their first repetitions: a 22.23 ms baseline decision became 22.39 ms (+0.16 ms), a 196.57 ms decision became 195.73 ms (-0.84 ms), and a 16.28 ms decision became 16.44 ms (+0.16 ms). Thus not every position became faster; the small tail overhead is substantially smaller than the opening savings.

One expensive opening-pone position was also measured with macOS `time -l`. Peak RSS was 70,287,360 versus 74,366,976 bytes: +4,079,616 bytes (3.89 MiB, 5.8%). Outputs matched here too. This single-process measurement is not a new multiworker memory-capacity calibration.

## Validation

`cargo test --offline --locked --release --manifest-path rust/Cargo.toml -p cribbage-shadow-engine --lib model91::` passed under the compact-output wrapper. This includes the existing posterior-weight bit-parity tests and compact continuation/scoring/winner oracle tests, plus:

- Every zero-to-four-card rank hand against every physical depletion baseline on its occupied ranks, compared bit-for-bit with the general combination-product routine.
- Cached versus uncached WP choices across both roles, owned discards, cuts, neutral and tiny positive likelihoods, and scores near 121.

Builds emitted only the existing unused `WeightedEntry` fields warning. Diagnostic worker instrumentation was removed from the source patch.

Raw scripts/results are under `/private/tmp/cribbage-203-denominators`: `replay.py`, `replay-results.json`, `tails.py`, `tails-results.json`, `memory.py`, `memory-results.json`, and `summary.json`. The summary records source and binary hashes. Frozen fixtures/assets remain under `/private/tmp/cribbage-model203-vs-model202-10k-20260927-v1`.

## Assessment

A modest, repeatable CPU improvement with exact tested outputs and a clear invariance argument. The tradeoffs are approximately 4 MiB of additional peak RSS in the memory case and roughly 0.16 ms slower cheap decisions in the repeated checks. Retain as an isolated candidate; do not claim universal speedup or a measured benchmark ETA improvement. No running benchmark restart was performed for this experiment.
