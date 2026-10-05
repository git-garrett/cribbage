# Model 20.3 action-cache admission

Assessment and change based on `1bacdbf134f26d7badc7c9decfd8d36dc0bf908b`.
Model 20.3 now caches inner WP actions only for the root player's role during
one live solve. Both players still use the existing evidence, continuation,
likelihood, and series-scoring caches. No cache limit, posterior, valuation,
world enumeration, scoring rule, tie-break, or live-vs-inner policy is changed.
No benchmark restart or deployment was performed.

## Cause and alternatives

The opening player's private cards stay fixed across simulated worlds. The
opponent's private cards and discards vary, creating a stream of almost unique
action keys. Six discovery positions produced 2,306,030 root-player requests
and 3,093,747 opponent requests. The latter produced only 169 action-cache hits
(0.0055%). Historical fixture names identify the source positions; every probe
executes Model 20.3.

The original 100,000-entry action cache cleared 29 times across those six
positions. Root-only admission produced zero clears and retained just 0–561
entries per position. For the larger pone opening, it preserved all 518 distinct
root keys, reducing root misses from 1,219 to 518, while avoiding insertion of
1,553,374 opponent actions. The opponent decisions are still evaluated normally.

Trace replay screened role partitions from 1/99 through 99/1, two generations
with and without hit promotion, LRU, and root-only admission. Actual engine
screening compared the original cache, a 5/95 role split, both generation
variants, and root-only admission. Partitioning and gradual replacement did not
show a consistent advantage. Root-only admission was the simplest promising
candidate and removes the hash lookups as well as insertions for excluded keys.
The instrumented screening timings are not the final production speed estimates.

## Implementation and safety

`Model91Policy` accepts an optional WP action-cache role. The default preserves
historical behavior. Model 20.3 configures it from the observation at the start
of each prepared or direct forecast. Dealer/pone identity is constant throughout
a hand and is reconstructed for the current simulated actor; the choice of which
role to cache does not use hidden opponent information.

The normal observation validation and calculation paths remain intact. Accepted
keys retain every original observation field, likelihood, and both board scores,
with randomized hashing and complete-key equality. Excluded entries cause normal
recomputation, not an approximation or a different policy. The existing 100,000
entry bound remains available for root keys. All action memoization remains
local to a single live solve.

A regression test uses a small cache and interleaves an opening player's cached
position with a stream of opponent positions. It failed before the admission
guard because opponent actions entered the cache, and passes afterward. It also
checks both roles, changing scores, exact actions against an uncached policy,
and the original capacity bound. A second test compares every forecast action,
world count, and terminal probability bit-for-bit through ordinary and close-race
hands using fixed diagnostic worlds. The full Rust suite passed: 420 tests across
21 targets. Release builds emitted only the pre-existing unused `WeightedEntry`
fields warning.

## Performance validation

Final measurements use separate clean release baseline/candidate binaries,
identical frozen speed-v4 assets, warm-up, and alternating/reversed execution
order. CPU time is reported because the long benchmark can compete for the host.
The main suite contains six discovery and twelve held-out positions, each run
twice. Its interrupted foreground runner resumed after 21 saved comparisons;
completed cases were not repeated. Whole-hand checks use three fixed hands,
including a close race, each twice, with fresh per-player hand caches.

Main-suite aggregate CPU:

| Group | Original | Selective admission | CPU reduction |
| --- | ---: | ---: | ---: |
| All 36 comparisons | 85.259831 s | 82.613804 s | 3.10% |
| Discovery | 47.508096 s | 46.028888 s | 3.11% |
| Held-out validation | 37.751735 s | 36.584916 s | 3.09% |
| Pone decisions | 72.280667 s | 70.149965 s | 2.95% |
| Dealer decisions | 12.979164 s | 12.463839 s | 3.97% |

All 36 comparisons matched serialized action, physical card, EV, and WP exactly,
including signed zero. The two execution orders improved by 2.87% and 3.34%.
These aggregates are decision-fixture CPU measurements, not whole-game throughput
or a new benchmark ETA. The held-out results support a modest repeatable gain;
they do not establish a speedup on every possible position or hardware platform.

Whole-hand mean CPU seconds over three fixtures, each repeated twice:

| Role | First, original | First, selective | Whole pegging, original | Whole pegging, selective |
| --- | ---: | ---: | ---: | ---: |
| Pone | 8.148687 | 7.769950 | 8.334576 | 7.926543 |
| Dealer | 1.273108 | 1.168157 | 1.298679 | 1.191933 |

Pone first-decision CPU fell 4.65%, and total pone pegging CPU fell 4.90%.
Dealer first-decision CPU fell 8.24%, and total dealer pegging CPU fell 8.22%.
All 64 paired live actions, EVs, WPs, and the final game states matched exactly.
Whole-hand aggregate CPU fell from 57.799529 to 54.710852 seconds (5.34%).
These selected hands are a small controlled sample, not population-wide benchmark
averages. Their position mix differs from the eighteen-position main suite.

Peak RSS was not obtained: the host denied the resource wrapper's clock-rate
query. The in-process CPU measurements and decision comparisons completed
successfully; no numerical RAM saving is claimed. Cache entry counts above are
from the successful instrumented engine runs.

## Artifacts

`/private/tmp/cribbage-203-action-churn` contains the diagnostic and clean release
workers, trace replay, candidate screens, raw decision and hand comparisons,
and source/binary provenance. Diagnostic instrumentation and prototype cache
implementations are confined to that directory; none are in the production patch.
