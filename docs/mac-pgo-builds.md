# Mac release builds with PGO

Native Mac release builds through the following entry points automatically build
a baseline, generate a fresh profile, rebuild with profile-guided optimization
(PGO), and verify exact decisions and EV/WP values before publishing binaries:

```sh
npm run build:deploy
npm run build:benchmark
rust/cribbage-shadow-engine/build.sh
```

`scripts/local-runtime.sh` also uses this API build path. These commands add no
CPU-specific tuning. Linux builds, including the native production deployment,
keep the ordinary release build. Direct `cargo build` bypasses this automation.

## Training models

API and shadow builds train the current `ACE_MODEL`; API builds also exercise
selected-action valuations and combined reviews. Benchmark builds default to
Model 20.3. For another model, or a binary serving both sides of a matchup, name
each engine explicitly:

```sh
npm run build:benchmark -- \
  --model schell_table-peg_table-20.3 \
  --model schell_table-peg_table-20.2
```

Separate frozen source trees should each build their own profile. Run long builds
as ordered stages of the one-shot benchmark supervisor before freezing/copying
the resulting binaries. This build command does not restart running benchmarks.
The selected models' assets must be present; `--model-root PATH` on the Python
builder can point to another frozen tree containing those assets.

The maintained corpus is `scripts/pgo-fixtures.json`. Training includes pone and
dealer pegging positions and discards; held-out validation includes additional
positions, discards, and two complete hands with later plays and count resets.
The instrumented training outputs and all optimized validation outputs must
match the baseline, including floating-point bits. This is sampled parity
validation, not a proof for every possible position.

## Tooling and artifacts

The builder uses the active Rust toolchain. Install its profile merger with:

```sh
rustup component add llvm-tools-preview
```

It prefers that toolchain's `llvm-profdata`, then tries Xcode's existing tool.
`LLVM_PROFDATA=/absolute/path/to/llvm-profdata` overrides discovery. Missing or
incompatible tooling fails the build; it never silently publishes a non-PGO
replacement. `--no-pgo` is an explicit diagnostic option on the Python builder
and the benchmark/shadow entry points.

Verified binaries are published under `rust/target/release` by default. Set
`CARGO_TARGET_DIR` or pass `--target-dir` to the Python builder to relocate them.
The shadow entry point also updates its historical executable location. Cross
compilation keeps Cargo's ordinary target-specific output layout and skips PGO.

Every invocation trains a new profile for its current source, assets, compiler,
target, flags, and corpus. The optimized build uses a unique profile path so
Cargo cannot reuse an executable built against an earlier profile. Intermediate
compilation caches live under `target/pgo/<kind>/`; successful provenance and
timing are recorded in `target/pgo/<kind>/latest.json` and each run's `build.json`.
Receipts include input/profile/binary hashes and exact-parity case counts.
Source or asset changes during the build abort publication. Compilation or parity
failures leave the previous published binaries and successful receipt in place.

PGO takes longer to build because it compiles and runs multiple variants.
Workload wall times in receipts are useful diagnostics, but controlled repeated
comparisons are needed to distinguish speed changes from machine load.
