# Deal-Cut Integrity and Layout Fix Plan

## Goal

Make the first-deal cut authoritative: the lower visible card receives the
first deal and crib.  Keep cut cards distinct, re-cut tied ranks before
showing a result, and ensure the animated deck cannot cover either result or
the crib badge on desktop.

## Checklist

- [x] Generate one shuffled cut sequence, resolve tied pairs by re-cutting,
  and derive the first dealer from the lower rank.
- [x] Add regression coverage for a user 2 versus AI 5, tied pairs, and
  generated cuts.
- [x] Keep the deal-cut deck animation inside its own grid column.
- [x] Run Rust, TypeScript, production-build, package, and API-flow QA.
- [ ] Commit, push, deploy, and verify production.

## Notes

- The previous implementation selected `game.first_deal` from seed parity and
  generated the displayed cards independently.  This made a visible low cut
  capable of losing the crib incorrectly.
- Existing untracked `pasted-text.txt` and the Model 16 pegging-policy asset
  are not part of this correction.
- Local QA on 2026-07-18: the full Rust workspace suite (83 tests), TypeScript
  check, production build, and server-package integrity check passed. A
  release-built local API game cut User 8 versus AI 7 and correctly assigned
  the first deal and crib to the AI. The generated client artifact contains
  the deal-cut-specific animation that keeps its lifted deck top centered.
