# Leaderboard Recovery Plan

## Goal

Restore the public leaderboard history that remained in production SQLite when
the Rust API began reading its separate TSV ledger. Preserve every current TSV
record, deduplicate by game ID, retain a rollback copy, and return the full
player and win history to the public API.

## Checklist

- [x] Add a repeatable, backup-first importer from legacy `game_uploads` to
  `leaderboard-games.tsv`.
- [x] Restore complete leaderboard API output from the merged ledger,
  including biggest wins and skunk highlights.
- [x] Test the importer and Rust API output; build and verify the deployment
  package.
- [ ] Back up and migrate production data; restart safely and verify the live
  API contains the recovered players and all completed games.
- [ ] Commit, push, deploy, and record the recovery.

## Recovery Evidence

- On 2026-07-18, the live Rust endpoint read 47 TSV records, all tagged
  `Garrett`.
- The preserved `/var/lib/cribbage/cribbage-server.sqlite` contains 124
  complete legacy `game_uploads` records. All have final-result, snapshot,
  and event data; their player tags are Garrett (47), Kurtis (32), Stoneman
  (13), Travis K (10), Shane (9), Popchuckles (6), Stone (5), and Kristina
  (2).
- The recovery deliberately merges rather than replaces the TSV ledger, with
  game ID as the idempotency key.
- Local QA on 2026-07-18: importer self-test, focused seven-test Rust API
  suite, complete 83-test Rust workspace suite, TypeScript check, production
  build, and package integrity check all passed.
