# Cribbage disk cleanup plan — 2026-07-16

This file is the durable execution ledger for the disk cleanup. Update the
checkboxes and action log after every verified phase so the work can resume
safely after a context reset.

## Safety baseline

- [x] Cleanup plan created before destructive work.
- [x] Local checkout measured at approximately 11.8 GiB.
- [x] External archive volume confirmed at `/Volumes/Elements` with about
  3.5 TiB available.
- [x] Existing modified and untracked source files recorded; cleanup must not
  overwrite or revert them.
- [x] Live process identified: PID 68331, `rust/target/release/cribbage-runner`.
- [x] Live files excluded from every cleanup/archive operation:
  - `benchmarks/ai-db/rust-15.0-vs-15.2-10k-timing-20260706.sqlite*`
  - `.background/rust-15.0-vs-15.2-10k-timing-20260706/`
  - `rust/target/release/`

External archive root:

`/Volumes/Elements/cribbage-archive/2026-07-16`

## Phase 1 — direct deletion of reproducible or redundant data

- [x] Delete every `benchmarks/**/checkpoints/` directory whose sibling
  `status.json` says `status: complete`. Baseline: 32 directories, about
  2.56 GiB. No archive destination: these are restart state for already
  completed runs whose final output is retained or separately archived.
- [x] Delete superseded deployment packages, retaining only local version
  `cribbage-server-15.2.0.tgz`. Expected recovery: about 1.10 GiB.
- [x] Delete `rust/target/debug/` only. Expected recovery: about 343 MiB.
  `rust/target/release/` remains untouched for the live process.
- [x] Delete generated/copy output: `server-dist/`, `dist/`, and
  `ios/App/App/public/`. Expected recovery: about 374 MiB.
- [x] Delete the two ignored benchmark binaries that are byte-identical to
  tracked promoted assets:
  - `benchmarks/pegging-table/frontier-pegging-14.5-full-20260628/pegging-outcome-frontier-overrides.bin`
  - `benchmarks/pegging-table/bounded-tripolicy-pegging-full-20260628/pegging-outcome-bounded-overrides.bin`
  Their retained copies are under `web/src/models/`. Expected recovery:
  about 170 MiB.

## Phase 2 — create external archive structure

- [x] Create and verify these directories:
  - `/Volumes/Elements/cribbage-archive/2026-07-16/databases`
  - `/Volumes/Elements/cribbage-archive/2026-07-16/benchmark-results`
  - `/Volumes/Elements/cribbage-archive/2026-07-16/production-pulls`
  - `/Volumes/Elements/cribbage-archive/2026-07-16/raw-archives`
  - `/Volumes/Elements/cribbage-archive/2026-07-16/background`
  - `/Volumes/Elements/cribbage-archive/2026-07-16/manifests`

## Phase 3 — move already-compressed material

- [x] Copy, checksum, and then remove locally:
  `benchmarks/pegging-table/clean-recursion-20260611-0000.tar.zst`
  → `raw-archives/clean-recursion-20260611-0000.tar.zst`.
  Expected recovery: about 705 MiB.

## Phase 4 — compress research output directly to Elements

- [x] Gzip, test, record checksums, then remove these local JSON sources:
  - `benchmarks/crib-discard/frontier-crib-14.5-full-20260628/crib-score-histogram-frontier-by-discard-cut.json`
    → `benchmark-results/crib-discard/crib-score-histogram-frontier-by-discard-cut.json.gz`
  - `benchmarks/crib-discard/tripolicy-crib-discard-20260619/crib-score-histogram-tripolicy-by-discard-cut.json`
    → `benchmark-results/crib-discard/crib-score-histogram-tripolicy-by-discard-cut.json.gz`
  - `benchmarks/crib-discard/bounded-tripolicy-crib-full-20260628/crib-score-histogram-bounded-tripolicy-by-discard-cut.json`
    → `benchmark-results/crib-discard/crib-score-histogram-bounded-tripolicy-by-discard-cut.json.gz`
  Expected local recovery: about 383 MiB; expected external size: about 31 MiB.
- [x] Archive `benchmarks/ai-inference/` directly to
  `benchmark-results/ai-inference.tar.gz`, verify it, then remove the local
  directory. Expected recovery: about 44 MiB.
- [x] Archive `benchmarks/ai-smoke/` directly to
  `benchmark-results/ai-smoke.tar.gz`, verify it, then remove the local
  directory. This preserves completed, stale, failed, and stopped run records.
  Expected recovery: about 395 MiB.

## Phase 5 — production backups

- [x] Archive `production-pulls/` directly to
  `production-pulls/production-pulls-2026-07-16.tar.gz`, test and checksum the
  archive, then remove the local directory. Expected recovery: about 395 MiB.

## Phase 6 — inactive databases

- [x] Confirm no process has the inactive databases open.
- [x] Gzip, test, checksum, and remove local `benchmarks/ai-db/cribbage-games.sqlite`
  → `databases/cribbage-games.sqlite.gz`. Restore/decompress it to its original
  path before running scripts that use the default central database.
- [x] Gzip and archive the other inactive SQLite databases in
  `benchmarks/ai-db/` to `databases/`, with their original basenames plus
  `.gz`; remove their zero-length WAL and SHM sidecars after verification.
- [x] Leave the active 15.0-vs-15.2 database and sidecars local and untouched.

## Phase 7 — reinstallable dependencies and stale launcher state

- [x] Delete `node_modules/` and `.venv/`. Restore with the project package
  manager and Python environment setup when needed. Expected recovery:
  about 131 MiB.
- [x] Archive every inactive `.background/` child to
  `background/inactive-background-runs.tar.gz`, verify it, then remove those
  inactive local children. Retain only the active 15.0-vs-15.2 run directory.

## Phase 8 — Git maintenance

- [x] After several GiB have been recovered, run Git garbage collection and
  prune truly unreachable objects. Expected minimum recovery: about 74 MiB.
  Do not modify the working tree or current user changes.

## Phase 9 — final verification

- [x] Verify all external archives with `gzip -t` or `tar -tzf` and record a
  SHA-256 manifest under `manifests/`.
- [x] Confirm PID 68331 is still healthy and its live database is present.
- [x] Confirm the Git working tree still contains the same pre-existing user
  modifications and untracked files, plus this cleanup ledger.
- [x] Record final local checkout size, available disk space, external archive
  size, and total recovered space below.

## Action log

| Time | Action | Result / verification |
|---|---|---|
| 2026-07-16 14:22 PDT | Baseline audit | Local free space about 602 MiB; live benchmark at 7,724 / 30,000 games; external volume about 3.5 TiB free. |
| 2026-07-16 14:25 PDT | Phase 1 direct deletion | Removed 32 completed checkpoint trees (2,687,080 KiB), eight superseded packages (1,183,620,196 bytes), `rust/target/debug` (350,816 KiB), generated builds/copies (382,980 KiB), and two content-verified duplicate binaries (177,790,986 bytes). Checkout decreased by 4,750,400 KiB; local free space increased to 5.2 GiB. |
| 2026-07-16 14:26 PDT | Phase 2 archive structure | Created and verified the six documented archive subdirectories under `/Volumes/Elements/cribbage-archive/2026-07-16`; external free space remained about 3.5 TiB. |
| 2026-07-16 14:29 PDT | Phase 3 raw archive transfer | Copied `clean-recursion-20260611-0000.tar.zst` to `raw-archives/`, verified identical 738,668,240-byte size and SHA-256 `77a407834855e40217e320698b8c4f0130df9476443ce0622517ac1a7c62914a`, then removed the local source. |
| 2026-07-16 14:32 PDT | Phase 4 final crib JSON | Compressed three final JSON datasets to `benchmark-results/crib-discard/`; verified all gzip streams against source SHA-256 hashes, reducing 401,446,329 raw bytes to 32,540,198 archived bytes before local removal. |
| 2026-07-16 14:33 PDT | Phase 4 ai-inference | Archived 8 files to `benchmark-results/ai-inference.tar.gz` (3,569,000 bytes, SHA-256 `bfbfdc80256ce961f8327ca45bf70953e22053c1a03fa6ffb783acb133044eea`), matched file count, then removed the local directory. |
| 2026-07-16 14:34 PDT | Phase 4 ai-smoke | Archived all 6,524 files to `benchmark-results/ai-smoke.tar.gz` (23,479,223 bytes, SHA-256 `d7a5d52aee5f69d9be29f8cfa1618d1ea73d9102f52d15c0052fa0639f26fe34`), matched file count, then removed the local directory. |
| 2026-07-16 14:35 PDT | Phase 5 production backups | Archived all 78 files to `production-pulls/production-pulls-2026-07-16.tar.gz` (38,329,918 bytes, SHA-256 `cd9a1f15596dc575dac6f9a007963d7222ffadfbce261ccc8e14f201c3e86372`), matched file count, then removed the local directory. |
| 2026-07-16 14:39 PDT | Phase 6 central database | `cribbage-games.sqlite` passed SQLite quick-check, was compressed from 3,331,215,360 to 803,835,192 bytes at `databases/cribbage-games.sqlite.gz`, verified by decompressed SHA-256 `1afc56c671295c41651420295ce6a3cd75d01256c786f90a3c3c51d629cbafea`, then removed locally with zero-length sidecars. |
| 2026-07-16 14:40 PDT | Phase 6 other inactive databases | Three databases passed SQLite quick-check and were compressed under `databases/`: 15.0-vs-15.1 timing (5,343,754 bytes; SHA-256 `db1e52733b82e31cdac72533ebf7e209864472ed00a6425f3190f0623273c94e`), 15.0-vs-15.1 run (494,543 bytes; SHA-256 `4905b669efb2562af5861333af910378d9720852c451b094b2e7fe4c20b14e03`), and worker probes (917,508 bytes; SHA-256 `c0d41b258f8a6e713298cde3e29a99632c16547b60f2624bc9ca079a50de94bb`). Decompressed hashes matched before local removal. Only the live 15.0-vs-15.2 SQLite set remains locally. |
| 2026-07-16 14:42 PDT | Phase 7 inactive launcher history | Archived 190 inactive `.background` files to `background/inactive-background-runs.tar.gz` (2,844,836 bytes, SHA-256 `1eb6e2d4d1add7be3d6538e2cb6e8cadaae1545bd9e239ffab9d1f22081f8756`), verified the active run was excluded, matched file count, then removed inactive children locally. |
| 2026-07-16 14:43 PDT | Phase 7 dependencies and caches | Removed root and web `node_modules`, `.venv`, `.pytest_cache`, Python egg-info, and project `.DS_Store` files. Checkout decreased by 134,160 KiB. |
| 2026-07-16 14:45 PDT | Phase 8 Git maintenance | Ran `git gc --prune=now`. Loose objects decreased from 2,643 / 313.09 MiB to zero; one 180.19 MiB pack remains. `.git` decreased from 506,012 to 369,756 KiB without altering working files. |
| 2026-07-16 14:46 PDT | Phase 9 archive verification | All tar/gzip archives passed integrity and listing tests; the raw `.tar.zst` passed `zstd -t`. Generated and successfully rechecked `manifests/SHA256SUMS` for all 12 payload files. |
| 2026-07-16 14:47 PDT | Final safety verification | PID 68331 remained running at 7,938 / 30,000 games with its 808,050,688-byte database present. Original eight modified and two untracked user files remained unchanged; only this cleanup ledger was added. One zero-size checkpoint directory belonging to a run whose status is not complete was intentionally retained. |

## Final measurements

- Baseline checkout: 12,357,424 KiB (approximately 11.8 GiB).
- Final checkout: 2,042,512 KiB (approximately 1.95 GiB).
- Checkout storage recovered: 10,314,912 KiB (approximately 9.84 GiB).
- Local volume free space at final check: about 5.9 GiB. This value can vary
  independently because other processes and APFS reclamation use the volume.
- External archive size: 1,631,780 KiB (approximately 1.56 GiB).
- External volume free space at final check: about 3.5 TiB.
- Archive payload manifest:
  `/Volumes/Elements/cribbage-archive/2026-07-16/manifests/SHA256SUMS`.
- The current deployment package `cribbage-server-15.2.0.tgz` remains local.
