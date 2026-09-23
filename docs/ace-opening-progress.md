# Ace opening calculation and progress

Ace 13.23 starts its pone lead when `reveal-turn-card` makes the starter public.
It calculates during the reveal presentation and confirmation rather than waiting
for `advance-pegging`. As dealer, it starts its first reply as soon as the human
lead is committed, overlapping the card animation. Resuming an eligible position
also starts preparation. A finished discard alone is insufficient: the starter
and any heels points affect both the posterior and the chosen lead. Computing
against the server's still-hidden starter would cross the legal-information
boundary.

Each game has one ephemeral opening job, shared by preparation and play requests.
The worker receives the same legal-observation engine input and shared per-hand
belief caches as before. It holds no game-state lock while evaluating. Before a
move is applied, the current legal position must still match the prepared one.
Jobs and actions are never serialized into session storage or a policy table.
Completed abandoned jobs expire from the registry after ten minutes, on the next
preparation. Failed jobs can be retried by a subsequent game request.

The waiting overlay uses a native progress bar. Setup has no known total and is
indeterminate. Once search has enumerated its worlds, progress counts resolved
candidate/world pairs, including work eliminated by exact pruning. Counters are
published once per 256 worlds and at candidate boundaries; search and tie breaks
are unchanged. The client reads a small account-scoped progress response at most
twice per second, with one request in flight and no game rerender. Stale/hidden
waits are cancelled. Search completion is capped at 99% until the move is ready;
the percentage describes resolved work, not elapsed or remaining time.
