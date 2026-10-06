# Mixed FP16/FP32 Ace experiment

The corrected candidate uses **FP16 asset precision with FP32 inference** in
both discard and pegging. Probability products, sums, normalization, expected
values and move comparisons use FP32. Integer evidence, game rules and fixed-point
likelihood composition keep their original types. There is no FP16 accumulation.

`prepare.py` starts from the FP32 generator. Binary floating asset values and
floating calibration metadata round through native IEEE binary16 when loaded,
then expand to FP32 for all calculations. Frozen files retain their original
formats and hashes; the CPU caches hold expanded values. This measures playing
strength from asset quantization, not packed-asset memory savings or GPU speed.
Integer assets are not quantized. Current Ace's keep beliefs and decline factors
are integer assets; board probabilities, discard probabilities and crib priors
are floating assets. Binary16 underflow/rounding is part of the test, with no
probability floor or clipping. Loader checks permit 1/1024 absolute error for
asset rounding; FP32 counting and decision tolerances are unchanged.

The generator preserves normal FP32 large-count conversions and crib-mean
rounding. It removes the pure-FP16 experiment's scaled counts, relaxed FP16
calculation tolerances and private serde patch. Native half casts require
`RUSTC_BOOTSTRAP=1`; arithmetic width and asset width are separately reported by
the decision worker and checked by the harness.

The candidate faces the same frozen FP64 Ace 28.3.fast policy, with opening
accelerators disabled in both seats. A new series has independent databases and
5,000 paired seeds (10,000-game ceiling), using four game workers. Eight asset
workers run alongside it and reclaim the four slots when it ends. The existing
35-pair early checkpoint applies to the replacement series alone.

The old pure-FP16 series remains stopped and archived as a distinct experiment;
none of its observations contribute to this series. Its frozen generator and
binary remain with that series, and its implementation is in Git history.
The shared harness runs input checks, complete smoke games, benchmark, integrity,
reports and final durable sync in separate one-shot supervisor stages.
