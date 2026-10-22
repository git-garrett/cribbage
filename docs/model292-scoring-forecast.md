# Model 29.2 scoring forecast

29.2 inherits the stopped 29.1 generation's WP, crib, opponent keep/discard and
negative-evidence priors. It removes both prior post-WP forecast overlays.
The new forecast initially reproduces the legacy joint pegging distribution;
therefore initial parity is against inherited priors WITHOUT those overlays.

The learned object is a normalized joint distribution of our pegging points and
opponent pegging points, for an exact six-card hand, exact discard, role and board
region. Global suit renamings are equivalent; distinct/similar hands never share
point bins. The distribution replaces the pegging histogram BEFORE existing
hand/crib forecasts and the WP matrix value the candidate discard. Both pegging
means and total-point EV use it. Play still chooses the highest WP option.
No WP regression, post-WP adjustment, or learned pegging-action lookup is used.

Each row begins with 32 effective samples of the legacy distribution. Modern
completed pegging observations add joint point bins. The legacy fraction is
32/(32+n), where n includes supported censored observations; it fades rather
than being abruptly retired. Unvisited contexts/regions still use the legacy
forecast. The original binary is still needed for fallback. Modern distributions
are stored with their legacy prior, so the new file contains the complete
posterior, not just a correction to WP.

Ordinary played hands supply evidence. Training mode defaults ON and also plays
all 14 rejected discards for both actors against the same physical opponent
keep/cut, at the actual source board and immutable source policy. Neither actor's
policy receives illegal information. Toggle OFF collects only ordinary choices.
Suit-equivalent alternatives in one physical world count once for a context.
Alternatives are correlated evidence, never additional independent full games.

A game that finishes during pegging supplies two lower bounds, not a completed
point pair. Six deterministic EM steps allocate that partial observation only
among compatible full totals supported by the legacy prior or completed modern
hands. No play beyond 121 is manufactured. Unsupported partial observations are
retained and reported but do not change the forecast. This is an approximate
interval-censoring likelihood: it ignores scoring-event order and does not claim
to identify the unobserved remainder. Heels-only wins supply no pegging evidence.

Initially there is one board region per role. During forecast updates, a small
axis-aligned tree can split it (up to eight regions per role). Targets are the
modern own/opponent point residuals relative to the legacy means, averaged over
each source hand/actor's alternatives. Only wholly completed worlds train the
boundary model. Candidate thresholds occur every ten board points, with at least
128 training worlds per leaf and at least 2% training error reduction. A proposed
map must also reduce two-output point error by 2% on at least 64 freshly held-out
worlds; whole source games are held out, then admitted to subsequent training.
This is a conservative empirical partition, not an implementation or validation
of Colvert's pars. Boundary fitting excludes terminal worlds and can underlearn
finishing-position differences. All original boards remain stored: after a map
change observations are regrouped into their new regions, never transposed.
Shared boundary learning does not pool point-outcome bins across card contexts.

Cycles collect 20 ordinary games per WP/crib/holds/discards/declines phase and
then update the scoring forecast from the accumulated 100 games and alternatives.
Snapshots are immutable and updates idempotent. XZ compresses the scoring asset
on disk; Rust decompresses once per immutable worker snapshot. Prior traces are
compressed in evidence records. There is no compression in each decision lookup.

The continuous job uses two workers (the existing DDEV accommodation), fresh
reserved seeds, and a separate 1,000-game paired comparison against original 29.0
after each 5,000 new ordinary games. Comparisons are excluded from learning and
retain full telemetry and the evolving-branch confidence analysis. The opening
cache keeps its inherited completed-game clock and 50,000-game TTL, with no
proactive refresh or early audits. 29.1 and 29.0 caches are read-only fallbacks;
new misses write only 29.2's cache. Disk protection stops at 10 GiB free.

Exact-hand reuse and early region validation are empirical limitations. A small
run demonstrates collection and learning, not stronger play, mature boundaries,
or widespread retirement of legacy data. Workbench reports complete/partial and
unsupported sample counts, exact contexts, region distributions and accepted
boundary changes separately from full-game comparisons.
