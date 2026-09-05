# UI Product Workstream Plan

## Goal

Deliver the requested gameplay, feedback, reliability, administration, and
leaderboard improvements as five reviewable pull requests. Keep each change
set narrow enough to test, preview, and release independently.

## Branch and release rules

- The protected default branch is `master`. Do not merge any PR in this
  workstream into `master` without a new, explicit instruction.
- Production releases use the `server` line and
  `scripts/deploy-nanode.sh deploy`.
- PR 1 is authorized for a production deployment and may be merged into
  `server` after its checks pass. It must not be merged into `master`.
- PRs 2–4 stop after a local-runtime deployment and user review. Do not merge
  or deploy them to production at that gate.
- PR 5 also stops at local review because no production deployment was
  specified.
- Work on only one PR at a time. Do not begin the next review PR until the
  current PR reaches its stated gate.
- Preserve unrelated workspace changes, including `capacitor.config.ts` and
  generated benchmark workbooks under `outputs/`.

## Shared quality gate

Every PR must:

- Add regression coverage at the closest real seam for each behavior change.
- Pass the complete Vitest suite, TypeScript checking, and production client
  build. Run relevant Rust tests for API or persistence changes.
- Be reviewed in Chromium at desktop and phone sizes, in both light and dark
  mode where applicable.
- Preserve visible keyboard focus and reduced-motion behavior.
- Record the test evidence and release state in the PR description.

## PR 1 — Gameplay and pathway polish

- **Branch:** `feat/gameplay-ui-polish`
- **Target:** `server`
- **Release gate:** Deploy to production after checks pass; never merge to
`master`.

### Scope

- [x] Restore an opaque playing-card face in X-large text mode, including dark
  mode.
- [x] Remove the duplicate played-card copy visible at the end of the desktop
  play animation.
- [x] Let the game-start opponent announcement fit long names such as
  “Dynamic” without truncation.
- [x] Keep a full pegging run on one desktop row by increasing overlap as the
  row grows instead of wrapping after five cards.
- [x] Make Strong Cribbage logos navigate to the signed-in pathway home (or
  the public home when no signed-in pathway exists).
- [x] Mark Training as “Coming soon” while leaving it enabled so players can
  inspect the training pathway.
- [x] Add a felt-surface “Skip counting” control during hand/crib counting that
  immediately completes the presentation and opens the existing summary
  modal.
- [x] Make upper-left pathway navigation return to the parent pathway that led
  to the current page instead of always going to Home.
- [x] Add/adjust focused UI regression tests for all eight behaviors.

### Acceptance checks

- X-large cards retain a paper face in both color schemes.
- A played card has exactly one visible destination copy throughout the
  desktop animation handoff.
- “Dynamic” is fully readable in the start announcement at phone and desktop
  widths.
- The maximum legal pegging run stays on one desktop row without shrinking
  cards.
- Logo and back-navigation targets are correct from Home, Play, Training, and
  Settings descendants.
- Skip counting is offered only during hand/crib counting and lands on the
  correct summary with accurate totals.

### Verification evidence

- `npx vitest run`: 44 files, 282 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, including the protected-artifact check.
- Chromium visual QA passed at 1440×1050 and 390×844 in light and dark mode,
  with no page errors. Computed layout confirmed eight pegging cards in one
  `nowrap` row, an opaque X-large card face, and an untruncated “Dynamic”
  announcement at both widths.
- Browser interaction QA confirmed Training opens its pathway and the pathway
  logo returns Home.

## PR 2 — Bug reports and feature requests

- **Branch:** `feat/feedback-requests`
- **Target:** `server`
- **Release gate:** Local runtime only; leave PR open for review.

### Scope

- [x] Add a small, fixed “Bug report” control in a viewport-safe location with
  an accessible tooltip explaining when to use it.
- [x] Add a bug-report modal with optional screenshot upload and required brief
  description.
- [x] Email bug reports through the existing server mail infrastructure to the
  configured Strong Cribbage owner address.
- [x] Add a “Feature request” control in the upper-right of the Choose Your Path
  home hero with the supplied hover explanation.
- [x] Add a concise feature-request modal and email submission flow.
- [x] Validate and size-limit screenshot uploads server-side (PNG, JPEG, or
  WebP; 5 MB maximum), rate-limit both endpoints, and never expose mail
  credentials to the browser.
- [x] Provide clear submitting, success, validation, and failure states.

### Acceptance checks

- Both controls work with mouse, touch, and keyboard without obstructing game
  controls or safe-area insets.
- The API accepts valid submissions, rejects invalid/oversized payloads, and
  sends the expected owner email without logging sensitive content.
- The local review uses a non-delivering or captured mail transport.

### Verification evidence

- `npx vitest run`: 45 files, 286 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed, including the protected-artifact check.
- `cargo test --manifest-path rust/Cargo.toml`: passed across the full Rust
  workspace, including feedback routing, upload validation, per-user rate
  limits, mail escaping, and attachment coverage.
- Chromium interaction and visual QA passed at 1440×1050 and 390×844 in light
  and dark mode with no page errors. The pass covered keyboard focus, both
  success flows, a real PNG upload, rejection above 5 MB, and verified that
  page context omits URL query parameters.
- The shared local runtime serves this branch at `http://127.0.0.1:8765/` with
  `SENDGRID_API_KEY=local-email-disabled`; direct unauthenticated API requests
  return 401.

## PR 3 — Presence responsiveness and Dynamic calibration reliability

- **Branch:** create from the accepted `server` baseline after PR 2 review
- **Target:** `server`
- **Release gate:** Local runtime only; leave PR open for review.

### Scope

- [ ] Build a deterministic timing regression for the slow Online pill before
  changing the implementation.
- [ ] Add a low-overhead 60-second presence heartbeat that refreshes login and
  inactivity state, with immediate cached rendering when the pill opens.
- [ ] Avoid polling when the document is hidden and refresh promptly when it
  becomes visible again.
- [ ] Build persistence and multi-cycle regressions for provisional Dynamic
  handicap before changing calibration code.
- [ ] Persist provisional calibration progress across leaving/resuming a game.
- [ ] Confirm every eligible unassisted completed cycle continues updating the
  provisional handicap until calibration completes.

### Acceptance checks

- Opening the Online pill renders cached state immediately without waiting on
  a request.
- Presence converges within one heartbeat with negligible idle server load.
- Dynamic calibration survives navigation and game resume and changes after
  each eligible cycle.

## PR 4 — Private engagement administration

- **Branch:** create from the accepted `server` baseline after PR 3 review
- **Target:** `server`
- **Release gate:** Local runtime only; leave PR open for review.

### Scope

- [ ] Inventory the activity events already collected and document their
  field meanings and retention limitations.
- [ ] Add server-enforced authorization for the owner and designated test user;
  do not rely on hiding a client link.
- [ ] Add an admin-only pathway/menu link and reporting page.
- [ ] Report active users, sessions, return usage, pathway progression, game
  starts/completions/abandons, opponent/model selection, device/viewport, and
  engagement funnels supported by the existing event data.
- [ ] Add date filters, clear empty states, and CSV export where the underlying
  data supports it.
- [ ] Avoid collecting new personal or sensitive fields unless separately
  approved.

### Acceptance checks

- Unauthorized users receive no admin data even when calling the API directly.
- Owner and test user see the same reproducible totals for a seeded fixture.
- Every displayed metric identifies its denominator and time window.

## PR 5 — Standalone leaderboard and ranking views

- **Branch:** create from the accepted `server` baseline after PR 4 review
- **Target:** `server`
- **Release gate:** Local runtime only unless a later instruction authorizes a
production release; leave PR open and never merge to `master`.

### Scope

- [ ] Move Leaderboard out of My Stats into its own Choose Your Path homepage
  card.
- [ ] Remove the Done button and use pathway-aware back navigation.
- [ ] Make Handicap the default board.
- [ ] Add metric tabs for:
  - Handicap
  - Points per game: `(wins + skunks) / (wins + skunks + losses + skunked)`
  - Win percentage
  - Point differential
  - Total points
  - Total wins
- [ ] Add Daily, Weekly, Monthly, and All Time subtabs for every metric.
- [ ] Extend the API aggregation only where current leaderboard records cannot
  calculate a metric/window accurately.
- [ ] Define stable ordering and tie-breakers for every board.

### Acceptance checks

- The homepage card opens Leaderboard directly and My Stats no longer owns the
  entry point.
- Handicap / All Time is selected by default.
- Metric and time-window combinations produce deterministic seeded results and
  preserve keyboard-accessible tab semantics.

## Progress log

- [x] Workstream captured in this plan.
- [x] PR 1 complete and deployed to production.
- [x] PR 2 available on the local runtime for review.
- [ ] PR 3 available on the local runtime for review.
- [ ] PR 4 available on the local runtime for review.
- [ ] PR 5 available on the local runtime for review.
