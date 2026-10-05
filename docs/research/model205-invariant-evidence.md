# Model 20.5 invariant evidence constraints

**Complete; not adopted.** The idea safely removes some zero-weight evidence,
but this prototype did not show a dependable pone-opening improvement. It was
removed from the working engine; 20.5 still inherited 20.4 behavior at that point. The
frozen prototype, tests, and results are retained in the assessment artifacts.
Baseline was Model 20.4 with the same learning assets and compiler configuration;
the earlier root-preparation prototype was absent. The active 20.3–20.4 benchmark
is unchanged.

## Why the proposal is correct

The evidence cache stores action-by-opponent-hand continuation outcomes. Cut and
own discards do not enter the continuation itself, so the current cache removes
both from its observation key and reweights its broad support for each actual
query. It therefore calculates some outcomes that can never have positive weight
within the current live decision.

The cut is public and fixed throughout that solve. For queries from the root
player's role, that player's own discards are also fixed. Keeping those fields
in the evidence key permits the existing support generator to exclude impossible
hands before calculating outcomes. For normal queries in one solve, adding these
constant fields does not split a previously shared key. Own initial keep and
public played cards were already retained in the key.

Opponent discard variants must remain shared. Their private discards vary across
worlds; the prototype still removes that actor's own discards from the evidence
key and applies them only during the existing per-query reweighting. It retains
the cut for both roles. The policy stores only the root **role**, never the root's
private card values, and takes retained fields from each acting player's legal
observation. It cannot inject root private cards into an opponent observation.
Actual retained fields remain in the key, so an unexpected changed cut or root
own discards creates a separate entry rather than reusing incompatible support.

## Implementation and safeguards

In the prototype, only `load_model205` enables the new policy option. Scalar WP evidence, batched
query grouping, and EV evidence use one key helper. Posterior generation already
filters by available cards; no new approximate filter or probability cutoff is
added. Raw empirical weights, fixed depletion denominators, weight arithmetic,
retained-hand order, board scores, continuation evaluation, tie-breaking, and
physical fallback remain unchanged. Capacity stays at 300,000 evidence outcomes.
All caches remain decision-local under the pegging-policy ADR.

Focused tests exercise both player roles and both root-role assignments, physical
and empirical priors, depletion on/off, zero-weight exclusion, exact retained
weight/outcome/utility bits, exact EV bits, and continued sharing across opponent
discard variants. Batched versus scalar checks include changed cut/discard
queries, duplicate queries, tiny and zero likelihoods, empty empirical support,
physical fallback, score-out positions, and exact ties. The complete Rust suite
passes 436 tests across 22 targets.

## Measurement

`/private/tmp/cribbage-205-invariant-evidence` contains independently frozen
screening and PGO sources. The ordinary-release screen adds diagnostic counters
for WP evidence requests, hits, constructed hands/outcomes, and capacity clears.
The PGO candidate omits those counters. Both compare 20.4 and 20.5 in separate
warmed processes using one binary, alternating order and reversing it on the
second repetition. Timing uses process CPU alongside recorded wall time because
six independent benchmark workers share the Mac.

The screen covers six discovery positions twice. Final validation covers 18
discovery/held-out positions twice, plus three full-hand fixtures twice. It checks
physical actions/cards, integer EV/WP bits, and terminal states. Whole-hand
pegging totals are measured directly, separately for pone and dealer, rather than
inferred from isolated decision timings. Final PGO training includes both models.

## Ordinary-release screen

All 12 paired decisions matched exactly. First-decision CPU means were
14.861681 to 14.953100 seconds for pone (0.62% slower), and 2.116912 to 2.073440
seconds for dealer (2.05% faster). This mixed screen is not grounds for adoption.

The two pone openings constructed 0.27% and 0.43% fewer WP evidence outcomes.
Capacity clears stayed at 30 and 43 per decision respectively. Dealer openings
also avoided some evidence work without reducing clear counts. These counters
measure WP evidence construction, not unique complete game worlds or total
runtime saved. The actual posterior weights and all outputs were unchanged.

The limited reduction has a concrete explanation: this cache represents hands
by rank, so a known physical card only makes a rank hand impossible when its
required multiplicity exceeds the copies still available. Most compatible rank
hands remain possible and merely receive a lower weight, which the reference
already calculates. The actor's initial keep and publicly played cards were
already included in the constraints. Keeping the cut and root discards removes
only the additional impossible cases, not all hands containing one of those
ranks.

The existing 20.4 action cache is also relevant: it retains root-player decisions,
so repeated exact root queries return before rebuilding evidence. The numerous
opponent private-hand variants still need posterior evaluation, but only the
public cut is invariant across those variants. Root private discards cannot
safely tighten that opponent support. This limits where the additional root
constraints can save work.

## Final PGO results

Both models ran in the same freshly trained PGO binary, in separate warmed
processes, with alternating order reversed on the second repetition. Compiler
checks confirmed bit-exact ordinary-release/instrumented/PGO results separately
for both models. Source hashes matched before and after the build.

All **100 paired decisions** matched physical actions/cards and integer EV/WP
bits: 36 isolated comparisons and 64 decisions in six complete-hand runs. All
six terminal states matched. These are Mac process-CPU measurements with the
separate six-worker benchmark sharing the host, not production wall latency.

| Isolated first decision | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | ---: | ---: | ---: |
| pone, all eight comparisons | 11.597208 s | 11.631346 s | -0.29% |
| dealer, all eight comparisons | 1.829589 s | 1.829044 s | 0.03% |
| pone, four held-out comparisons | 9.669824 s | 9.719132 s | -0.51% |
| dealer, four held-out comparisons | 1.868169 s | 1.873677 s | -0.29% |

Only two of eight isolated pone-opening comparisons were faster; neither
held-out pone fixture improved on average. The differences are small and may
include timing noise; they do not establish a systematic regression, but they
do not establish the desired gain either.

Three complete-hand fixtures, each repeated twice:

| Role | Measure | 20.4 mean CPU | Prototype mean CPU | Reduction |
| --- | --- | ---: | ---: | ---: |
| pone | first decision | 10.491908 s | 10.381048 s | 1.06% |
| pone | whole-hand pegging | 10.679428 s | 10.569182 s | 1.03% |
| dealer | first decision | 1.382036 s | 1.366367 s | 1.13% |
| dealer | whole-hand pegging | 1.408571 s | 1.393594 s | 1.06% |

All six complete-hand pone timings improved, so there are modest fixture-specific
gains. These measurements cover actual whole-hand pegging, including scoring out
in the close-race fixture; they are not estimates from partial-hand observations.
They use different positions from the isolated comparison above.

## Decision

Do not retain this implementation as a general optimization. The conceptual
opportunity is real, the zero-weight exclusion is sound, and no tested decision
or valuation changed. However, first-decision results depend on the positions:
approximately 1% improvements in the complete-hand set did not carry through to
the isolated or held-out opening set. The screen removed only **0.365%** of
constructed pone-opening WP evidence outcomes and **0.318%** for dealer, with
unchanged capacity-clear counts. That is too little evidence of a dependable
critical-path improvement to justify another policy option and cache-key path.

This assessment rejects the current implementation on performance evidence,
not because it exposed a play-quality defect. A future broader redesign can
reuse the invariant-constraint idea, but it should still preserve actor-local
information and demonstrate a gain on held-out pone openings. No ongoing
benchmark or production engine was rebuilt or restarted for this experiment.

Artifacts: `/private/tmp/cribbage-205-invariant-evidence`, with a durable copy of
source, prototype/tests, provenance, job records, scripts, build receipt, and
results at `benchmarks/model20/evaluation-20260929/invariant-evidence-assessment`.

Final retained-code verification after removing the prototype: **434 Rust tests
across 22 targets passed**, and `git diff --check` passed. The experimental build
had passed 436 tests, including the two additional invariant-evidence tests now
preserved with its source snapshot. The ongoing benchmark's binary hash was
verified unchanged after cleanup.
