# Model 20.5: validate and prepare the root once

Model 20.5 starts from Model 20.4, with identical learned assets and scoring
semantics. It is separate from both frozen engines in the new paired benchmark
and from production Ace (13.23). New optimization experiments belong to 20.5;
20.3 and 20.4 retain their respective execution settings.

**Complete; not adopted.** The prototype was removed; 20.5 inherited
20.4 behavior at the end of this assessment. `world_state` still reconstructs the same
root public observation, compares it to the caller's observation, and checks
physical-deck compatibility for every candidate/world pair. Posterior batching
has not removed these repetitions.

The prototype validates the root once, retains a decision-local state template,
and computes a compatibility bit once per world. It creates each rollout from
the template with that world's private hand and discards. Invalid-world errors
are delayed until the same world would have been visited by the reference, so
batch fallback and scalar error ordering are preserved. Cancellation is checked
during preparation. Simulation order, action order, probability arithmetic,
pruning, downstream observation validation, and policy inputs remain unchanged.
No observation-to-action table or path graph is introduced.

The assessment uses a frozen source snapshot under
`/private/tmp/cribbage-205-root-prepare`, 18 existing discovery/held-out positions,
and three complete-hand fixtures. 20.4 and 20.5 run in separate processes using
the same binary, with alternating order, CPU and wall timing, and exact decision,
EV-bit, WP-bit, and final-state comparisons. A fresh PGO build trains both models.
Only actual complete-hand fixtures supply whole-hand pegging totals.

The prototype and its tests remain in the frozen assessment artifacts, not in
the retained engine.

## Initial ordinary-release screen

All 12 paired decisions matched exactly. Pone first-decision mean CPU was
16.876333 seconds for 20.4 and 18.748167 seconds for the candidate (11.09% slower).
Dealer first-decision CPU was 2.084203 versus 2.082312 seconds (0.09% faster).
One pone sample dominated the slowdown; even the reference repeated timings
varied substantially while other work shared the Mac. This is inconclusive
screening evidence, not grounds for adoption. The full Rust suite passed 436
tests across 22 targets, including root/error-order and exact forecast tests.
TypeScript, web, and release-build tests also passed.

## Final PGO results

Both model paths used the same binary and freshly generated common PGO profile,
with default CPU targeting. PGO-versus-ordinary-release build checks passed exact
parity separately for both versions. All **100 paired decisions** matched cards,
actions, integer EV bits, and integer WP bits: 36 isolated decision comparisons
plus 64 decisions through six complete-hand runs. All six terminal states matched.
These are Mac process-CPU measurements with the separate six-worker benchmark
sharing the host, not production latency measurements.

| Isolated first decision | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | ---: | ---: | ---: |
| pone | 11.730356 s | 11.702890 s | 0.23% |
| dealer | 1.860079 s | 1.835536 s | 1.32% |

Held-out pone openings alone regressed **0.20%**: 9.801177 to 9.820989 seconds.
Held-out dealer openings improved 0.75%.

Three complete-hand fixtures, each repeated twice:

| Role | Measure | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | --- | ---: | ---: | ---: |
| pone | first | 10.565034 s | 10.558991 s | 0.06% |
| pone | whole-hand pegging | 10.755061 s | 10.740189 s | 0.14% |
| dealer | first | 1.394990 s | 1.384555 s | 0.75% |
| dealer | whole-hand pegging | 1.423135 s | 1.412639 s | 0.74% |

Whole-hand totals were measured directly through the end of pegging, including
termination on scoring out in the close-race fixture. They are not extrapolated
from isolated or partial-hand positions.

## Decision

Do not adopt this implementation. It found no decision/value regression, but
pone-first savings were only 6 milliseconds per complete-hand fixture on average,
and the held-out opening subset was slightly slower. This is insufficient
evidence for a dependable critical-path improvement. The candidate adds a root
representation and a compatibility buffer while continuation evaluation remains
the dominant work. Posterior construction already conditions worlds for deck
compatibility; the later checks repeat that guarantee, but removing their repeated
execution produced little net benefit here.

The repeated work still exists, so the suggestion was not wholly obsolete. It
may be worth revisiting as part of a broader internal-state refactor, but these
measurements do not justify this extra execution path by itself. Frozen 20.3,
20.4, the ongoing benchmark, and production Ace were not changed by the prototype.

Artifacts: `/private/tmp/cribbage-205-root-prepare`, with a durable copy of source,
provenance, scripts, build receipt, and results under
`benchmarks/model20/evaluation-20260929/root-preparation-assessment`.
The final 20.5 identity retains the same 20.3 learned assets, 20.2 board matrix,
and 20.4 optimizations. The package and default benchmark build target are 20.5;
matchups should always pass their explicit model IDs.

Final retained-code verification after removing the prototype: **434 Rust tests
across 22 targets passed**. TypeScript, web, and release-build checks also passed
for the 20.5 identity changes. No production deployment or benchmark restart was
needed after the assessment.
