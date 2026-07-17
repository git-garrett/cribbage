# Rust Hidden-Crib Information Fix Plan

## Goal

Ensure every native model makes discard and pegging decisions using only legal
information. During pegging, a player may know the cut card, public tables and
plays, and its own two discards, but never the opponent's two crib cards or the
complete future crib score.

## Checklist

- [x] Add per-player own-discard state to the game model and clear it on each
  new hand.
- [x] Replace the decision-input full crib with the acting player's own two
  discards in the API, decision-review, and AI-vs-AI playout paths.
- [x] Restrict known-card and future-hand inference to legal cards.
- [x] Remove exact future-crib scoring from strength-model pegging; use the
  existing legal prior until a conditional crib-distribution asset is built.
- [x] Redact AI hand and full crib data from browser snapshots.
- [x] Add regression tests for per-player discard ownership, decision-input
  privacy, legal crib continuation, and public snapshot redaction.
- [x] Run Rust workspace tests, frontend checks, release build, API-response QA,
  production deployment, and production API QA.

## Deployment Notes

- This is a behavior correction, not a 13.0/15.2 strength comparison. Existing
  13.0-versus-15.2 benchmarks used the old information boundary and must not be
  treated as legal-information strength evidence.
- The first legal-information benchmark should use fresh run and artifact
  provenance rather than resuming the completed 10k run.

## Completion Record

- 2026-07-17: Added `PlayerState.discarded_to_crib`; it is cleared for each
  hand and records only the two cards contributed by that player.
- 2026-07-17: `DecisionInput` now has `own_discards`, never a complete crib.
  Native API play, decision reviews, command parsing, and AI-vs-AI playouts
  all use that common input, so this applies to every supported Rust model.
- 2026-07-17: Future hand inference now excludes only legally known cards.
  Future crib evaluation uses the existing global crib prior rather than the
  exact four-card score, pending a legal conditional-distribution asset.
- 2026-07-17: Browser snapshots now retain the human hand only; AI hands and
  complete crib arrays are emitted as empty arrays. The server remains the
  authoritative holder of those cards.
- 2026-07-17: Verified with `cargo test --workspace` (41 tests), TypeScript
  typecheck, production client build and release API build. Deployed with
  `scripts/deploy-nanode.sh deploy`; live health reported Rust 15.2.0 with
  13.0 selected, and a live discard-to-pegging API flow kept the AI hand and
  all crib fields redacted in the browser snapshot.
