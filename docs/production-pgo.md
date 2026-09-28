# Production PGO build

The requested outcome is to select the best supported compiler configuration on
the production AMD server, integrate it into deployment, validate it without
changing play, and commit, push, and deploy through the production workflow.

## Selected configuration

Use PGO alone with the existing release profile: optimization level 3, one
codegen unit, thin LTO, and the default CPU target. Do not add `target-cpu=native`.
The AMD EPYC 7713 experiment on Rust 1.92.0 / LLVM 21.1.8 preserved exact decisions
and EV/WP values in 238 comparisons. On held-out cases:

| Work | PGO CPU reduction | PGO plus native CPU reduction |
| --- | ---: | ---: |
| Ordinary decisions, including discards | 4.91% | 6.02% |
| Selected-action valuation | 15.79% | 7.10% |
| Combined review | 6.88% | 0.26% |

Mean first-decision CPU time changed from 16.260 to 15.572 seconds as pone and
1.266 to 1.329 seconds as dealer with PGO. Native tuning added to PGO saved about
80 ms on the pone lead and 60 ms on the dealer's first decision, but lost much of
the review benefit. PGO alone is the better supported general default, not a
proven optimum for every workload. The experiment used partial-hand fixtures and
does not establish whole-hand pegging totals or end-to-end API latency.

The retained experiment is `/opt/cribbage/compiler-assessment-20260928-v1` on the
production host. This deployment keeps the current Ace model and assets.

## Build contract

The operator still runs `scripts/deploy-nanode.sh deploy` from clean, synchronized
`master`, after the reviewed PR and required Quality check. The archive includes
the build scripts and deterministic training corpus. Native server builds now:

1. Build a reference API and workload executable, then evaluate training and
   held-out cases.
2. Build an instrumented variant, train on current Ace plays, discards, and
   reviews, and verify its training results against the reference.
3. Merge the fresh profile and build the optimized API and workload executable.
4. Run the optimized API test suite, including the installed-asset integration
   tests, and compare all training and held-out outputs with the reference.
   Held-out cases include two complete hands; decisions and EV/WP bits must match.
5. Publish only verified binaries and retain `pgo-build.json` in the release.
   Check its commit, compiler flags, parity results, API test result, and binary
   hash again before cutover, including when resuming an already-built release.

Each build generates a new profile; changing its path forces Cargo to rebuild
against that profile. Source and asset hashes must stay unchanged during the
build. Missing or incompatible profile tooling, a failed test, a changed input,
or a parity mismatch aborts the candidate before the live service is changed.
`llvm-profdata` must be installed and compatible with the active Rust LLVM
version; the deployment never silently falls back to an unprofiled binary.

## Resource and service behavior

The build runs as a one-shot systemd service with one Cargo job, lower CPU/I/O
priority, a 512 MiB memory high watermark, a 640 MiB memory limit, a 256 MiB swap
limit, a three-hour deadline, and no automatic retry. It preserves the current
API service while building. Each temporary Cargo tree is removed after its
binaries are preserved, avoiding three simultaneous compiler caches. At least
700 MiB free is required after unpacking the candidate.

The PGO working area is `/opt/cribbage/build/pgo-target`; receipts and profiles
are kept below `pgo/api/`. A failed or resource-limited candidate leaves the
current release serving. The normal atomic cutover, public exact-commit health
check, browser cache-contract check, and rollback mechanism remain in use.
Builds take longer, but require no extra operator steps or long maintenance pause.

For source-level validation, run `npm run test:release-build`, `npm test`, and
the existing complete `npm run qa:predeploy` gate. Linux PGO is explicitly enabled
by the production wrapper; ordinary direct Cargo builds retain their defaults.
