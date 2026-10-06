# Full FP32 Ace experiment

Requested test: current Ace against the same policy using FP32 throughout both
discard and pegging inference, measuring strength and speed while sharing CPU
capacity with the opening-asset build. This is a CPU experiment for a future GPU
port, not a GPU throughput measurement or a production policy change.

`prepare.py` creates a separate source tree with every explicitly typed FP64
policy value, accumulator, constant and conversion changed to FP32. Integer card
rules, counts and game generation stay exact. The controller retains the
original game/shuffle implementation. Existing eight-byte asset values are
read and immediately rounded to FP32; JSON metadata numbers are likewise rounded
before calculation. Reporting and JSON transport may represent results as FP64.
There is no higher-precision decision fallback. Existing FP32 assets stay FP32.

Asset validation tolerances change only in the generated tree: 128 FP32 epsilons
for short probability sums/calibration, eight for individual fitted rates, and
4096 for the many contributions to joint counting bins before normalization.
Asset hashes and original native validation are checked separately. Action
ordering and tie-breaking tolerances are unchanged. Precision-dependent
`EPSILON` expressions naturally use FP32 epsilon.

Both seats run independent persistent workers through identical legal-observation
interfaces. No opponent private cards cross that interface. Both run Ace 28.3.fast
with opening accelerators disabled: those exact-policy assets were built for
FP64 and cannot define the FP32 policy. The normal executable Ace fallback is
used in both, so timing measures uncached policy evaluation. Each worker records
its arithmetic width, process CPU time, elapsed time and decisions. Frozen-seat
experiments are excluded from the ordinary production benchmark tables.

The initial contract is 5,000 matched seeds played in both orientations (10,000
games), two workers per orientation. Report paired-seed uncertainty for FP32 win
rate, score difference and ties in pair outcomes. The same games supply the speed
comparison: decision wall time per game and per decision, split into discard,
pegging and overall. Timings include worker transport and scheduling. Differing
game paths and concurrent workload are part of this practical speed comparison.
No separate timing replay precedes the benchmark or is required by its report.
A small observed difference is not proof of strength equivalence.

The one-shot supervisor runs input verification, full-game smoke, benchmark,
integrity verification, reports and final durable sync in separate stages.
Resume enumerates missing index ranges, never starts at the row count. The build
uses six workers, benchmark four, leaving two CPUs of scheduling headroom; macOS
schedules these workers rather than hard-pinning physical cores.

The workbench uses an explicit `benchmarkRoot`, a paired `manifest.txt`, and
`seatVariants` mapping each display label to its actual policy and frozen binary.
It checks worker provenance and policy telemetry before displaying these normally
excluded experiment rows, and never changes the databases or ordinary exclusions.
Versioned configuration files expand the game target without changing the frozen
engines, seeds, assets, or completed game indices.
