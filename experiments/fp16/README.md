# Full FP16 Ace experiment

The requested candidate uses native Rust `f16` throughout discard and pegging
inference, including probability sums, expected values and decision comparisons.
It faces the same frozen FP64 Ace as the FP32 experiment, over 5,000 paired seeds
(10,000 games). Both seats disable opening accelerators that encode FP64 choices.
The same games supply strength and wall-time measurements. This runs on CPU;
it does not measure GPU throughput or change production Ace.

`prepare.py` extends the isolated FP32 generator. Disk assets retain their original
formats and hashes; floating values round to FP16 immediately on decoding.
Existing integer code—including card rules, evidence counts and fixed-point
likelihood-factor composition—retains its original types. The frozen game
controller also remains exact. “Full FP16” means every floating-point inference
operation; integer algorithms are not rewritten as floating point.
The installed Rust 1.96.1 Apple Silicon compiler supports native half arithmetic
behind `#![feature(f16)]`; the experiment builds with `RUSTC_BOOTSTRAP=1` and a
private, pinned serde_core copy that only adds JSON transport conversions.
Native half add/multiply were confirmed in generated M3 assembly. The missing
Darwin u128-to-half compiler builtin is supplied with integer bit manipulation
and round-to-nearest, ties-to-even, tested exhaustively through the overflow edge.

FP16's maximum finite value is 65,504. A mechanical cast overflowed Ace's large
integer evidence and produced a nonfinite discard decision. The generated engine
therefore makes these explicit numerical adaptations:

- Integer ratios are represented by rounded 11-bit significands and binary
  exponents, then divided and scaled using FP16 arithmetic. Integer evidence is
  never first cast to infinity. Fixed-point likelihoods in millionths use this
  same conversion.
- Empirical keep weights use a common per-row scale with maximum 16, preserving
  their mathematical relative weights before rounding. Discard histogram moments
  and suit-evidence validation likewise convert through scaled ratios.
- Asset validation uses 16 FP16 epsilons for short sums and calibration, eight
  for individual fitted rates, and 128 for the many joint-counting contributions.
  Original asset integrity/native FP64 preflight is checked separately. NaN and
  infinity at the decision boundary fail the run; no higher-precision retry exists.
- The optional five-decimal crib-mean rounding loses its overflowing 100,000
  multiplier. Its result stays FP16, whose spacing around these EVs is coarser.

This tests the resulting scaled FP16 implementation, including underflow and
rounding effects. It is not a claim that a naive type substitution is viable, or
that FP16 alone necessarily runs faster. No clipping, minimum-probability floor,
or wider-precision accumulation is introduced.

Generate into a fresh internal-disk directory, build the decision-worker binary
with `RUSTC_BOOTSTRAP=1 cargo build --release --offline`, and freeze its sources,
lockfile, binary, assets and generator hashes. Copy `numeric_tests.rs` beside the
generated `fp16.rs` and compile it with `RUSTC_BOOTSTRAP=1 rustc --test` for the
independent conversion checks. Wider floats in that test are oracle values only.
The common `experiments/fp32/run.py` harness accepts `candidateBits: 16` and
uses the one-shot supervisor's verification, smoke, benchmark, integrity, report,
and durable-sync stages. Main games cannot begin unless complete smoke games pass.

The user stopped FP32 after 70 games (35 matched seeds). The current allocation
is four FP16 game workers and eight asset-build workers. The asset controller
automatically permits twelve workers when FP16 stops, fails or completes. These
are worker slots; macOS schedules physical cores and the existing memory guard
still applies. FP16 retains its 10,000-game ceiling, with a user-authorized early
checkpoint after a comparable 35 matched seeds. The short-run stop decision is
an engineering resource choice, not statistical proof of equal strength.
