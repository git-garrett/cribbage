# Model 14.x Speed Optimization Plan

This plan tracks work to improve both actual and perceived playing speed for the 14.x app and server/client architecture.

## Goals

- Keep the UI responsive immediately after every user action.
- Move expensive AI work out of user-visible waiting periods whenever possible.
- Make server-side AI decisions fast enough for normal play on a 1 core / 1 GB RAM nanode.
- Keep model quality intact unless a tradeoff is explicitly accepted.
- Treat model artifacts and AI policy tables as IP that must not be shipped to the production client.

## Current Architecture Notes

Simple production mode already calls server endpoints for AI discard and pegging decisions:

- `POST /api/ai/discard`
- `POST /api/ai/peg`

However, the current client build still imports shared engine/model code and emits large model artifacts as static assets. That means normal play may be server-side, but the production static bundle can still expose IP-heavy artifacts. Fixing that is a security/IP requirement, not only a performance requirement.

## Highest-Impact Work

### 1. Remove Model Assets From The Simple Client

The simple production client must not import local model-heavy code or ship large model assets. The server should own model loading and AI decisions.

Current concern: the client build still emits large artifacts, including the 14.x tripolicy pegging table and pairwise pegging table. This can hurt initial load time, phone memory pressure, and perceived speed even when the server is doing AI work.

Planned direction:

- Split client-only game/UI code from server-only model code.
- Ensure simple mode calls server APIs for AI decisions.
- Keep full local model mode only behind an explicit dev/full-app path.
- Confirm production simple bundle no longer includes model tables or policy artifacts.
- Ensure Caddy/static hosting cannot serve model artifacts directly in production.
- Add a build check that fails if protected model artifacts are present in `dist`.

### 2. Add Server-Side Prepare Calls

The client should start AI work before the exact AI turn whenever the likely future state is known.

Prepare opportunities:

- Start the upcoming hand as early as rules allow.
- While the user reviews hand/crib scores and acknowledges them with OK, the server can process the next deal if already determined by the client.
- While the user studies their discard, the server should already be working on AI discard for the same hand.
- If AI is pone, after AI discard is known the server should begin lead analysis.
- If AI is dealer, after AI discard is known the server should plan responses to every plausible user lead card, ordered by likelihood.
- While the user considers a pegging play, the server should plan responses to each legal user card.
- If the user selects/highlights a card before pressing play, server work should jump to the response for that selected card.
- If the user changes selected card, reprioritize without throwing away still-useful cached work.

The UI should let the user continue normal interaction where legal, while server work continues in the background.

This requires new prepare-style endpoints that are separate from final decision endpoints. The final decision endpoint should reuse prepared work if available and compute missing work only as a fallback.

### 3. Add Hand-Scoped Pegging Sessions

Instead of rebuilding pegging analysis after each play, create a server-side pegging session once a hand reaches pegging.

Session key:

- game id
- hand number
- model version

Additional session metadata:

- role/dealer
- player keep
- cut card
- known discards/dead cards where available
- current played stack
- current go/reset state

Session behavior:

- Build or load the relevant tree/distribution once.
- Update/prune live state after every play.
- Reuse already computed candidate values after each decision.
- Expire session after the hand ends.
- Keep enough state to answer "what if user plays X next?" without rebuilding the full tree.
- Persist reusable session artifacts to disk where practical, but keep active-hand state small enough for RAM.

### 4. Add Disk-Backed Decision Caches

Use disk as the durable cache layer because the nanode has limited RAM.

Recommended storage:

- SQLite table with compact binary blobs.
- Key includes model version, role, keep ranks, cut, known dead cards, played stack, and score context.
- Value stores compact decision summaries or tree/session artifacts.

RAM use:

- Keep only a bounded LRU for current-hand and recently used entries.
- Track cache hit/miss rates and average read/write time.

### 5. Make UI State Advance Before AI Work

Every user action should visibly register before expensive AI work begins.

Examples:

- User discard immediately removes/moves selected cards and repaints.
- User lead immediately appears in the pegging stack.
- AI thinking overlay appears only after the user-visible state has updated.
- The app should avoid synchronous model work before a repaint.

### 6. Use UI Timing Deliberately

Small UI transitions can make unavoidable work less perceptible.

Candidates:

- card movement after discard/play
- score reveal transitions
- cut-for-deal reveal animation
- cut-turn-card reveal animation
- deck slide/cut animation
- short notification pacing
- clear AI thinking overlay with elapsed timer when real work remains

The animation goal is not decoration. It is to preserve user orientation while the app consumes unavoidable fractions of a second.

### 7. Add OK Steps After Scores

Use explicit acknowledgement after score reveals so users do not miss scoring messages and so the app can do useful background prep.

Potential prep during OK windows:

- post-hand analytics/error review
- next hand setup
- AI discard preparation when enough state is known
- pegging-session creation after cut/discard
- AI lead analysis when AI is pone
- AI response planning when AI is dealer

This should be tested carefully so it does not make ordinary play feel slower.

### 8. Add Cut-Card Interaction Windows

Cutting for the turn card should become an explicit UI interaction and a useful background-compute window.

When user is pone:

- Prompt the user to cut the deck for the turn card.
- Let the user tap either the deck/card area or a cut button.
- During this interaction, the server can continue AI discard and pegging preparation.

When user is dealer:

- Animate the deck with the top sliding/cutting off.
- Prompt the user to turn the cut card.
- Let the user tap either the deck/cards or a button to reveal the cut card.
- During this interaction, the server can continue AI discard and lead/response preparation.

The cut-card animation should not block already completed server work. If server prep is still running when the cut-card interaction finishes, show the thinking overlay and elapsed timer.

### 9. Add Selection-Based Pegging Preparation

When the user selects a pegging card but has not yet pressed play:

- Send a low-priority prepare request for the selected card.
- If the user presses play for that same card, promote the prepared job to the final response path.
- If the user selects a different card, reprioritize to the new card.
- Keep prior partial work if it can still be reused in the hand-scoped pegging session.

This should make the UI feel faster because a substantial fraction of "AI response to user play" work can occur while the user is still deciding.

## Measurement Requirements

Before deeper optimization, add instrumentation for:

- AI discard decision time
- AI pegging decision time
- AI discard prepare start/end time
- AI pegging prepare start/end time
- selected-card prepare hit/miss
- prepare job duration
- prepare job hit/miss at decision time
- disk cache hit/miss
- RAM cache hit/miss
- p50/p95/p99 response times
- time from user action to first visual update
- time from user action to AI action
- time hidden behind user review/cut/OK interactions
- production bundle size and protected-artifact presence/absence

Analytics should separate actual compute time from time hidden behind user interaction.

## Possible Native Optimization

Moving hot pegging loops to Rust, C, C++, or WebAssembly may be worth it if profiling proves JavaScript is the bottleneck after architectural fixes.

Preferred approach:

- Do not port the whole app.
- Profile first.
- Port only the packed-state pegging evaluator or binary table scan loop.
- Preserve deterministic output and compare against current JS decisions.

Expected benefit could be large for numeric tree traversal, but this adds build/deploy complexity. It should come after bundle splitting, session reuse, and cache work.

## Open Questions

- Which decisions can safely be prepared before the opponent discard is known?
- How large can the disk cache grow before we need eviction?
- Should cache entries be tied to exact score context or reusable across nearby score contexts?
- What is the acceptable maximum AI wait time before fallback/anytime behavior is considered?
- Should local phone play ever use full 14.x local model assets, or should strong models be server-only?
- Can we preserve deterministic reproducibility while allowing prepare jobs to race ahead of final user decisions?
- Should selected-card prepare requests be debounced, or fired immediately on every card selection?
- What is the correct server behavior when prepared state disagrees with the client snapshot?

## Initial Priority Order

1. Split simple client so model assets are server-only and cannot be served statically.
2. Add timing instrumentation.
3. Add prepare API and client background calls.
4. Add hand-scoped pegging sessions.
5. Add SQLite-backed decision cache.
6. Add score acknowledgement/prep windows.
7. Add cut-card interaction windows.
8. Add selected-card pegging preparation.
9. Profile remaining bottlenecks.
10. Consider native/WASM for the hottest loop only if still needed.
