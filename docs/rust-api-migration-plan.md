# Rust API and Model-Cull Migration Plan

## Goal

Retire all pre-13.0 model code and non-Rust backend decision engines. The
repository will contain a Rust API server, a browser web client, and the
Capacitor wrappers needed for future iOS and Android releases.

## Scope Rules

- Keep only models supported by the Rust engine: 13.0, 14.3, 14.8, 14.8.1,
  15.0, 15.1, and 15.2. Public/default play is 15.2. Supporting lookup
  data is Rust-owned and is not a separately selectable model.
- Preserve the browser UI and Capacitor project. Node remains only a frontend
  build/test toolchain; it must not host gameplay or AI API routes.
- Replace the Node HTTP/worker/sidecar decision path with a native Rust HTTP
  API before retiring it.
- Remove model assets and documentation for versions older than 13.0 only
  after source references have been eliminated and the Rust server is tested.
- Existing user changes are retained unless they are explicitly superseded by
  the migrated implementation.

## Work Log

- [x] Inventory the current model registry, Node backend, Rust engine, client
  API calls, packaging, and uncommitted work.
- [x] Specify the reduced model surface and Rust API contract.
- [x] Add a Rust HTTP API server using the native Rust decision engine.
- [x] Change the browser client to use the Rust API contract exclusively.
- [x] Remove Node gameplay backend source, worker code, and server packaging.
- [x] Remove pre-13.0 model registrations, browser assets, and Node model
  build/benchmark scripts.
- [x] Update deployment/package documentation for a Rust API plus static web
  client deployment.
- [x] Restore the omitted `node_modules/` toolchain and run the frontend
  checks.
- [x] Deploy the Rust API to production and verify the public browser/API
  surface.
- [x] Archive the remaining unused browser-model tree to Elements, verify its
  checksum and manifest, then remove the local tree. Explicit user approval
  was received on 2026-07-16.
- [x] Transfer the verified pre-13 benchmark archive to Elements and remove
  its local source directory.

## Post-migration model validation

- [ ] Complete the 10,000-game native Rust matchup: 13.0 (left) versus 15.2
  (right). The runner alternates first deal and uses deterministic sequential
  seeds so the result is reproducible.
- [x] Start the matchup as a one-shot background launchd job with persistent
  status and SQLite records.
- [ ] Analyze final wins, score margin, discard/pegging timings, and confidence
  before assigning a strength ranking.

### Live run details

- Launchd label: `cribbage-runner-13v152-10k` (one-shot; it exits at completion).
- Status/ETA: `.background/rust-13.0-vs-15.2-10k-20260716/status.json`.
  Read `gamesPerSecond` and `estimatedRemainingSeconds`; the runner rewrites
  this file after every persisted game.
- Results database:
  `benchmarks/ai-db/rust-13.0-vs-15.2-10k-20260716.sqlite`.
- Initial checkpoint (2026-07-17T00:27:28Z): 8 / 10,000 games, 8 workers,
  0.271605 games/sec, 36,788.702 seconds remaining (about 10 h 13 m).

## Decisions and Results

| Date | Item | Result |
| --- | --- | --- |
| 2026-07-16 | Migration started | The retained Rust-native model set is 13.0, 14.3, 14.8, 14.8.1, 15.0, 15.1, and 15.2. |
| 2026-07-16 | Rust HTTP server | Added `rust/cribbage-api`, a native HTTP service with `/health`, `/api/model`, server-authoritative `/api/game/action`, session recovery, completed-game upload, persisted leaderboard points, and CORS for Capacitor/browser clients. |
| 2026-07-16 | Browser contract | Replaced the browser's `engine.ts` type dependency with `web/src/api-types.ts`; the browser no longer embeds game rules or an AI model. |
| 2026-07-16 | Backend retirement | Removed the Node HTTP server, worker, sidecar bridge, protected-asset bridge, SSR build config, and Node model-generation/benchmark commands. Node remains only for Vite/Capacitor client tooling and the retained AI-run analysis script. |
| 2026-07-16 | Lookup relocation | Moved `web/src/models/schell_table-peg_table-12.0/pegging-outcome-pairwise.bin` to `rust/cribbage-shadow-engine/assets/model13-pairwise.bin`; moved the 13.0 hold table, 14.0 pairwise/crib tables, and the retained discard tables to the same Rust-owned asset directory. |
| 2026-07-16 | Pre-13 cleanup | Deleted the pre-13.0 browser model directories and their registrations. The former 12.0 lookup table is retained only under the Rust asset name above, because Rust's 13.0 evaluator requires it. |
| 2026-07-16 | Deployment | Reworked the Nanode package and systemd/Caddy configuration: Caddy serves `dist/`, proxies API routes to `rust/target/release/cribbage-api`, and the Rust service owns model and leaderboard-data paths. |
| 2026-07-16 | Linux release correction | The initial production archive contained a macOS arm64 binary, which the x86_64 Linux host correctly rejected. The package now ships the locked Rust workspace source and runtime assets; the Nanode builds the native binary with `cargo build --locked --release` before service startup. The package includes every Cargo workspace member required for the build. |
| 2026-07-16 | Production deployment and QA | Deployed to `https://cribbage.strongcribbage.com`. Systemd runs an x86_64 Linux Rust binary as the unprivileged `cribbage` user; `/health` and `/api/model` report Rust 15.2. Public HTTPS static serving, Capacitor CORS preflight, game creation, cut, discard recommendation, human/AI discard, and human/AI pegging all passed. The tested 15.2 recommendation and AI discard completed in 3.64 s and 2.93 s respectively. |
| 2026-07-16 | Verification | `cargo test --workspace` passed (23 library tests plus workspace targets). Local HTTP smoke tests covered health, model metadata, game creation, cut/discard recommendation, and a persisted two-point skunk leaderboard result. |
| 2026-07-16 | Frontend verification | `npm run typecheck`, `npm run build`, and the protected-client-asset check passed. The production archive was rebuilt and verified to contain the static client, native Rust binary, and Rust-owned runtime assets. |
| 2026-07-16 | Browser-model review | `web/src/models/` is 192 MB of unused browser-era lookup assets plus model documentation. It is not required by the Rust API. It does contain 13.0+ assets and a few prototype timing notes, so it remains in place pending a specific archive/delete confirmation. |
| 2026-07-16 | Browser-model archive authorized | User explicitly authorized archiving the entire unused `web/src/models/` tree to Elements. The archive will retain the 13.0+ lookup material and historical model notes rather than deleting them. |
| 2026-07-16 | Browser-model archive moved | Created and checksum-verified `/Volumes/Elements/cribbage-archive/2026-07-16/cribbage-web-models-20260716.tar.gz`: 44 entries, 80 MB compressed from 192 MB, SHA-256 `46fe10dbf84de141c1960a1ab678c836b13e40aa32a6e7ec7ed0ffd2aa7c9b9f`. The local `web/src/models/` tree and temporary archive were then removed. |
| 2026-07-16 | Pre-13 benchmark archive moved | `benchmarks/large-mixed/` (464 KB) contained only RAS/Schell versus Expert 1.1 results. It was compressed to `/Volumes/Elements/cribbage-archive/2026-07-16/cribbage-pre13-benchmarks-large-mixed-20260716.tar.gz` (28 KB, SHA-256 `3c728fee7abd96b8e80823d54fd3a836e5e39553642be4818302cd31dca8154d`), checksum-verified, then removed locally. All other `benchmarks/` material contains model 13+ or Rust 15.x data and remains local. |
| 2026-07-16 | 13.0 vs 15.2 validation started | Started one-shot launchd job `cribbage-runner-13v152-10k`: 10,000 native Rust AI-vs-AI games, 13.0 left versus 15.2 right, 8 workers, seed `0x13201520`, alternating first deal. Live status is `.background/rust-13.0-vs-15.2-10k-20260716/status.json`; per-game data is in `benchmarks/ai-db/rust-13.0-vs-15.2-10k-20260716.sqlite`. Initial ETA was about 10 h 13 m. |
