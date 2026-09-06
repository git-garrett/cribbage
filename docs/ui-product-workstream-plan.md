# UI Product Workstream Plan

## Goal

Deliver the requested gameplay, feedback, reliability, administration, and
leaderboard improvements as five reviewable pull requests. Keep each change
set narrow enough to test, preview, and release independently.

## Branch and release rules

- The protected default branch is `master`. Do not merge any PR in this
  workstream into `master` without a new, explicit instruction.
- Production releases use `master` and `scripts/deploy-nanode.sh deploy`.
- PRs 1–4 are complete and deployed to production.
- PR 5 is authorized for merge to `master` and production deployment after its
  checks and required review pass.
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
- **Release status:** Deployed to production in PR #6.

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
- **Release status:** Deployed to production in PR #7.

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

- **Branch:** implemented in PR #9, with follow-up presence polish in PR #12
- **Target:** `server`
- **Release status:** Deployed to production in PRs #9 and #12.

### Scope

- [x] Build a deterministic timing regression for the slow Online pill before
  changing the implementation.
- [x] Add a low-overhead 60-second presence heartbeat that refreshes login and
  inactivity state, with immediate cached rendering when the pill opens.
- [x] Avoid polling when the document is hidden and refresh promptly when it
  becomes visible again.
- [x] Build persistence and multi-cycle regressions for provisional Dynamic
  handicap before changing calibration code.
- [x] Persist provisional calibration progress across leaving/resuming a game.
- [x] Confirm every eligible unassisted completed cycle continues updating the
  provisional handicap until calibration completes.

### Acceptance checks

- Opening the Online pill renders cached state immediately without waiting on
  a request.
- Presence converges within one heartbeat with negligible idle server load.
- Dynamic calibration survives navigation and game resume and changes after
  each eligible cycle.

## PR 4 — Private engagement administration

- **Branch:** `feat/private-engagement-admin`
- **Target:** `master`
- **Release status:** Deployed to production in PR #13.

### Scope

- [x] Inventory the activity events already collected and document their
  field meanings and retention limitations.
- [x] Add server-enforced authorization for the owner and designated test user;
  do not rely on hiding a client link.
- [x] Add an admin-only pathway/menu link and reporting page.
- [x] Report active users, sessions, return usage, pathway progression, game
  starts/completions/abandons, opponent/model selection, device/viewport, and
  engagement funnels supported by the existing event data.
- [x] Add date filters, clear empty states, and CSV export where the underlying
  data supports it.
- [x] Avoid collecting new personal or sensitive fields unless separately
  approved.

### Acceptance checks

- Unauthorized users receive no admin data even when calling the API directly.
- Owner and test user see the same reproducible totals for a seeded fixture.
- Every displayed metric identifies its denominator and time window.

### Verification evidence

- `npm test --silent`: 279 Rust tests across 18 targets passed.
- `npm run test:web`, `npm run typecheck`, and `npm run build`: passed.
- The live API returns `401` for an unauthenticated engagement request.
- The committed Chromium regression covers dashboard keyboard tabs, line-chart
  rendering and legend controls, account activity, experience and state views,
  and server-side environment filters. Additional visual checks passed at
  1440×1050 and 390×844.
- The shared LAN runtime serves the current branch at
  `http://192.168.88.17:8765/?engagement=1`.

## PR 5 — Standalone leaderboard and ranking views

- **Branch:** `work/standalone-leaderboard`
- **Target:** `master`
- **Release status:** Complete and deployed to production.

### Scope

- [x] Move Leaderboard out of My Stats into its own Choose Your Path homepage
  card.
- [x] Remove the Done button and use pathway-aware back navigation.
- [x] Make current Handicap the default board.
- [x] Add metric tabs for:
  - Handicap
  - Points per game: `(wins + skunks) / (wins + skunks + losses + skunked)`
  - Win percentage
  - Point differential
  - Points scored (total cribbage points scored)
  - Total wins
- [x] Add Daily, Weekly, Monthly, and All Time subtabs for every metric other
  than Handicap, defaulting those metrics to Monthly; Handicap is a
  current-value metric with no time-window tabs.
- [x] Extend the API aggregation only where current leaderboard records cannot
  calculate a metric/window accurately.
- [x] Define stable ordering and tie-breakers for every board.

### Ranking definitions

- Daily, Weekly, and Monthly are trailing 24-hour, 7-day, and 30-day windows
  ending at the response's fixed `generatedAt` time. All Time includes every
  persisted Ace game. Invalid or future timestamps are excluded from timed
  windows.
- Result boards sort by the selected metric descending, then games played,
  win percentage, average margin, and player name. Handicap sorts by absolute
  current handicap ascending, then calibrated cycles descending and player
  name.
- Points per game uses `(wins + skunks) / (wins + skunks + losses + skunked)`.
  Points scored is the sum of the player's cribbage scores. Point differential
  is the sum of the player's cribbage scores minus the sum of the opponents'
  cribbage scores across every game in the selected window.

### Acceptance checks

- The homepage card opens Leaderboard directly and My Stats no longer owns the
  entry point.
- Current Handicap is selected by default, with no time-window tabs. When a
  windowed metric is selected, Monthly is the default timeframe.
- Metric and time-window combinations produce deterministic seeded results and
  preserve keyboard-accessible tab semantics.
- Direct refreshes restore the Leaderboard route after initialization, and
  every pathway Back control resolves its declared parent rather than the
  previously visited sibling.
- Statistics uses the shared parent-aware Back control without a redundant
  Done button.
- Scoreless `0–0` QA uploads are excluded from every leaderboard aggregate;
  legitimate completed games, including double skunks, remain eligible.

### Verification evidence

- `npm test`: 290 Rust tests across 18 targets passed.
- `npm run test:web`, `npm run typecheck`, and `npm run build`: passed.
- Chromium interaction and visual QA passed at 1440×1050 and 390×844 in light
  and dark mode using fixed signed-in leaderboard fixtures. The pass covered
  the home card, default Handicap board, hidden Handicap windows, every metric
  and time-window control, arrow-key tab navigation, phone scrolling, and the
  pathway-aware return to Home.
- The shared local runtime serves this branch at `http://127.0.0.1:8765/`.

## Progress log

- [x] Workstream captured in this plan.
- [x] PR 1 complete and deployed to production.
- [x] PR 2 complete and deployed to production.
- [x] PR 3 complete and deployed to production.
- [x] PR 4 complete and deployed to production.
- [x] PR 5 complete and deployed to production.
