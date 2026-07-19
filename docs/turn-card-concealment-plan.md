# Turn-Card Concealment Hotfix Plan

## Goal

Do not expose the turn/cut card to the browser, saved browser state, or game
UI until the cut ceremony is complete and the card is explicitly revealed.

Production must continue to use Model 13.0; this is an information-boundary
and UI correctness hotfix, not a model promotion.

## Checklist

- [ ] Keep the turn card server-private during both discard phases and expose
  it only through an authenticated game-state transition after pegging starts.
- [ ] Update the browser contract, optimistic discard state, saved-game
  migration, and reveal animation so the card cannot appear early or survive
  a refresh from an older snapshot.
- [ ] Add API regression coverage and pass focused Rust/API and TypeScript QA.
- [ ] Build and package the production artifact; verify the archive contains
  the updated Rust source and static client.
- [ ] Commit and push the implementation.
- [ ] Deploy to production and verify health/version, bundle replacement, and
  an API-level discard-to-reveal flow.

## Deployment Record

- In progress on 2026-07-18. Local source changes were already present in
  `rust/cribbage-api/main.rs`, `web/src/api-types.ts`, and `web/src/main.ts`
  when this checklist was created. `pasted-text.txt` and the rejected Model 16
  policy asset remain intentionally untracked and outside this hotfix.
