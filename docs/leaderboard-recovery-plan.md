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
- [x] Back up and migrate production data; restart safely and verify the live
  API contains the recovered players and all completed games.
- [x] Commit, push, deploy, and record the recovery.

## Quality Ranking Amendment

- [x] Sort leaderboard rows by leaderboard points per game (the percentage
  shown in the UI), with win rate and average margin as quality tie-breakers.
- [x] Add regression coverage, deploy, and verify the live ordering.

## Loading-State Amendment

- [x] Show a throbber while the leaderboard request is pending; reserve empty
  states for completed empty responses.
- [x] Build, deploy, and verify the production client bundle.

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
- Recovery deployed on 2026-07-18 in commit `d112927` (`Restore legacy
  leaderboard history`). Production dry-run validated 47 already-present
  records and 77 additions; the applied migration produced 124 records and
  created `leaderboard-games.tsv.20260719T041032Z.pre-legacy-import` as a
  rollback copy. After the safe service restart, the public API reports all
  eight historical players, 44 biggest-win records, and four skunk leaders.
- Quality-ranking amendment deployed on 2026-07-18 in commit `077de45`
  (`Rank leaderboard by quality percentage`). Rows now sort by leaderboard
  points per game—the percentage displayed in the UI—with win rate and
  average margin as tie-breakers. Live public QA confirmed the descending
  order begins Garrett (51.1%), Kristina (50.0%), and Kurtis (46.9%).
- Loading-state amendment deployed on 2026-07-18 in commit `57c2d6c`
  (`Show leaderboard loading spinner`). TypeScript, production build, and
  package QA passed. Production serves bundle `index-C8PyQZyS.js` and its
  paired stylesheet, both containing the new loading state.
