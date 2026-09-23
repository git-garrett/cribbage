# Ace opening calculation and progress

Ace 13.23 starts its pone lead immediately after its discard recommendation
finishes, even while the human is still choosing discards. The actual starter is
fixed at deal time; its visual cut, reveal, and confirmation are presentation
steps and do not delay calculation. Preparation projects Ace's chosen discard,
the opponent's eventual four-card count, and any heels points into the upcoming
opening. The opponent's hidden cards and choice of discard do not enter the
policy. The already-completed discard decision cannot use the starter-dependent
lead calculation. The prepared opening must match the actual position before
its move can be used.

Finishing discards also starts preparation when there was no prefetch. As dealer,
Ace starts its first reply as soon as the human lead is committed, overlapping
the card animation. Actively resuming an eligible game starts preparation;
passive home-page listings do not.
Each game has one ephemeral opening job, shared by preparation and play requests.
The worker receives the same legal-observation engine input and shared per-hand
belief caches as before. It holds no game-state lock while evaluating. Before a
move is applied, the current legal position must still match the prepared one.
Jobs and actions are never serialized into session storage or a policy table.
Completed abandoned jobs expire from the registry after ten minutes, on the next
preparation. Failed jobs can be retried by a subsequent game request.

The waiting overlay uses a native progress bar starting at 0% when it appears.
Its baseline is the first work counter received for that visible wait, so progress
covers the remaining calculation rather than including preparation already done.
Setup without a known total stays at 0%. Search counts resolved candidate/world
pairs, including work eliminated by exact pruning. Counters are published once
per 256 worlds and at candidate boundaries; search and tie breaks are unchanged.
The client reads a small account-scoped response at most twice per second, with
one request in flight and no game rerender. Stale/hidden waits are cancelled.
Search completion is capped at 99% until the move is ready. This is UI progress
through the visible wait, not an estimate of elapsed or remaining seconds.
