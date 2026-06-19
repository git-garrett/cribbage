# Server/Client Architecture Plan

## Goal

Split the app into:

- a lightweight static client for gameplay UI, user moves, scoring, and game flow
- a small API server that performs AI decisions

The intended deployment target is a Linode Nanode-class server with roughly 1 CPU core, 1 GB RAM, and 25 GB storage. The client and server will run on the same machine. Static assets can be served from the same host as the API.

## Current Direction

The client remains the game referee:

- handles user input
- applies user discards and peg plays
- validates legal moves
- advances pegging and scoring
- displays the board, notifications, reports, and game log
- records the full game log

The server acts as an AI decision service:

- receives a serialized game state
- chooses AI discard or pegging play
- returns the chosen move and optional decision metadata
- receives completed game logs from the client for durable storage

## Nanode Constraints

Model 13 resources are large enough that blindly loading every artifact into RAM at startup may not be viable on a 1 GB server.

The server should be designed to support:

- lazy loading of model artifacts
- memory caps or LRU caches
- disk-backed artifacts
- streaming or binary reads where practical
- a lower-memory fallback model if Model 13 is too heavy for the host
- startup that does not require loading all historical models

Initial target: only expose the production/default AI model needed by the simple client. Avoid shipping or loading old model artifacts on the server path unless explicitly needed.

## Proposed API

### `GET /health`

Returns basic process health.

### `GET /api/model`

Returns the active model id, version, and readiness.

### `POST /api/ai/discard`

Request:

- serialized game state
- AI hand
- crib owner / dealer role
- score and board state
- cut card if already known
- optional session tag

Response:

- selected discard card ids
- model id
- optional point EV / win probability metadata
- think time
- warning or fallback metadata if applicable

### `POST /api/ai/peg`

Request:

- serialized game state
- AI hand
- played stack
- count
- go state
- scores
- known cards
- optional session tag

Response:

- selected card id, or go
- model id
- optional point EV / win probability metadata
- think time
- warning or fallback metadata if applicable

### `POST /api/games`

At game end, the client sends the full game log to the server.

Server stores:

- game id
- client/session tag if supplied
- app version
- model version
- full event log
- final result
- uploaded-at timestamp
- source metadata

The server should validate basic shape and size before inserting into the database.

## Static Hosting

Options:

1. NGINX or Caddy serves static files and reverse-proxies `/api/*` to Node.
2. Node serves both static files and API.

Preferred starting point: Caddy or NGINX in front of Node, because static serving and TLS/reverse proxying are simpler and more reliable there, and Node can focus on API work.

If operational simplicity matters more than traditional separation, Node-only is acceptable for a small private deployment, but it is less ideal for TLS, compression, caching, and process isolation.

## API Protection

Browser clients cannot prove they are the official client in a strong cryptographic sense if all credentials are public in shipped JavaScript.

Practical protections:

- enforce HTTPS
- strict CORS allowlist for the deployed origin
- reject unexpected origins where present
- request size limits
- rate limiting
- optional per-session token issued by the server when the client first loads
- optional simple shared secret only for private/testing builds, not public web clients
- server-side validation of all game states and legal requested context

Important limitation: CORS/origin checks stop ordinary browser misuse but do not stop direct scripted requests. For a public endpoint, rate limits and request validation are mandatory.

## Persistence

Use SQLite initially.

Suggested tables:

- `game_uploads`
- `game_events`
- `ai_requests`
- `ai_decisions`
- `sessions`

The client should upload completed game logs at end of game. The server can separately log AI requests for debugging and model analysis, but the completed game upload is the authoritative full game record.

## Implementation Steps

1. Extract AI decision entrypoints behind a clean server-callable interface.
2. Define serialized request/response schemas.
3. Add Node API server with health/model endpoints.
4. Add discard and pegging endpoints using the current model logic.
5. Add client API adapter for AI turns.
6. Keep a local/offline AI path only for dev if needed.
7. Add completed-game upload endpoint and SQLite inserts.
8. Add deployment config for static hosting plus API reverse proxy.
9. Test fixed game states against current local decisions.
10. Measure Nanode memory and response times with Model 13 artifacts.

## Open Questions

- Can Model 13 run acceptably on a 1 GB RAM host without holding the largest artifacts fully in memory?
- Should the first server version use Model 12 or a trimmed Model 13 path if Model 13 is too heavy?
- Which reverse proxy is preferable for this deployment: Caddy, NGINX, or Node-only?
- How strict should API access controls be for the first public test?
