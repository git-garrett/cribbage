# Model 20 baseline

`schell_table-peg_table-20.0` starts as a behavior-identical copy of production
Ace 13.23 at commit `35fe6f4`. It has its own model ID in the native engine,
benchmark runner, API, and local experimental opponent selector.

The initial version uses the same 13.23 discard, live pegging, and saved-decision
review functions, verified correction asset, board matrix, policy inputs, and
hand-cache/opening-preparation behavior. The existing assets are reused; no
training or asset rebuild is required. Install `model1323-corrections.bin` as
documented in `rust/cribbage-shadow-engine/assets/README.md` before evaluating
discards.

Production Ace remains 13.23. Model 20 is an experimental opponent, so its games
do not count as production Ace games. Future Model 20 strategy changes should
branch at its explicit dispatch paths and preserve the historical 13.23 model.
