# Turn-Card Concealment Hotfix Plan

## Goal

Do not expose the turn/cut card to the browser, saved browser state, or game
UI until the cut ceremony is complete and the card is explicitly revealed.

Production must continue to use Model 13.0; this is an information-boundary
and UI correctness hotfix, not a model promotion.

## Checklist

- [x] Keep the turn card server-private during both discard phases and expose
  it only through an authenticated game-state transition after pegging starts.
- [x] Update the browser contract, optimistic discard state, saved-game
  migration, and reveal animation so the card cannot appear early or survive
  a refresh from an older snapshot.
- [x] Add API regression coverage and pass focused Rust/API and TypeScript QA.
- [x] Build and package the production artifact; verify the archive contains
  the updated Rust source and static client.
- [x] Commit and push the implementation.
- [x] Deploy to production and verify health/version, bundle replacement, and
  an API-level discard-to-reveal flow.

## Deployment Record

- In progress on 2026-07-18. Local source changes were already present in
  `rust/cribbage-api/main.rs`, `web/src/api-types.ts`, and `web/src/main.ts`
  when this checklist was created. `pasted-text.txt` and the rejected Model 16
  policy asset remain intentionally untracked and outside this hotfix.
- Completed on 2026-07-18. Implementation commit `7f60789` adds an explicit
  `reveal-turn-card` server action, withholds `turnCard` from game state and
  browser snapshots until that action, removes the serialized RNG state, and
  resets the reveal flag on a new hand. The browser requests the reveal only
  after its cut interaction, keeps optimistic discard state private, and
  redacts legacy saved games that lack the new marker.
- QA passed: focused Rust API tests (including the new turn-card privacy
  regression), the full Rust workspace suite, TypeScript check, production
  Vite build, and server-package integrity check. A local end-to-end API game
  verified `turnCard:null` through initial, discard, AI-discard, and
  pre-reveal pegging state, then a concrete card only after explicit reveal.
- The first deployment correctly stopped before a service restart because the
  archive omitted the policy-trainer workspace member. Packaging correction
  `9823d4e` includes and verifies that source. The repaired archive deployed
  successfully; production health reports Rust API 16.0.0 with Model 13.0
  selected. Tagged production QA game `rust-19f785ac740-1` reproduced the
  complete concealed-discard-to-reveal flow, and production serves client
  bundle `assets/index-6ZQAPRtZ.js`, which contains `reveal-turn-card`.
