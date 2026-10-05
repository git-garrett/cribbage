# Model 28.3 private information and scoring-tree follow-up

2026-10-03. Work tree: `/private/tmp/cribbage-model283-score-blocks`.

## Decision and scope

The user explicitly made opening speed a hard gate after the private-context
expansion was identified. The registered model must therefore remain unchanged
unless the complete fix passes that gate. This is an experimental correction,
not a deployed upgrade or evidence of stronger play.

Restoring own discards is not just subtracting two extra cards at the live root.
The root already does that. Every hypothetical future actor must know its own
two discards, and must remain uncertain about the other actor's discards. Two
private contexts with the same keep can consequently select different moves.
Averaging their discards before selecting a move does not restore that knowledge:
maximizing an average is different from averaging the separately chosen results.

## Candidate semantics

The experimental candidate distinguishes `(initial keep, own discards)` at
future choices. It uses the existing smoothed keep prior and conditional discard
asset. For an actor's known six cards, each opposing keep's discard variants are
normalized within that keep; multiplying by that keep's existing posterior mass
preserves the previous keep marginal. Both players retain their own private
context throughout the continuation. The actual root's discards never restrict
the other player's public hypothetical domain.

Future valuation counts the pone hand, dealer hand and crib in order, observes
121 immediately at each stage, and rotates dealer before the next-hand board
lookup. Within this rank-only experiment, each hypothetical pair's pegging and
counting results stay together until the actor's weighted comparison. The actor
chooses once across all its possible opponents, never separately for a hidden
opponent's cards. Suited bonuses are deliberately not fabricated.

Counting-aware choices also invalidate part of the previous physical shortcut:
an empty opponent still has hidden private discards. The actor must average over
those possibilities before choosing its remaining sequence. Forced suffixes
where both actors have at most one remaining card can still share physical
scoring across discard variants. The candidate implements this sharing using
index maps onto the smaller keep-pair result table, without merging decisions or
private beliefs.

## Representation cost

With a fixed 5 cut and otherwise public opening information, there are 1,819
four-card rank holds per role. Attaching every physically possible own rank
discard pair produces **164,995** private contexts per role, an average of
90.706 variants per hold. Existing smoothed discard rows support them all.

A king lead is compatible with 41,344 such private contexts for its actor. The
current dense nonterminal result layout would therefore require
41,344 × 164,995 = **6,821,553,280 two-byte cells**, or **13,643,106,560 bytes**
for that one returned child table alone. This excludes simultaneously retained
sibling tables, private-context vectors and calculation scratch. The hypothetical
full opening Cartesian product is 27,223,350,025 cells (54.45 GB), though the
live forecast starts by fixing a public candidate and does not allocate that
particular all-opening table.

These are costs of the present representation, not proven lower bounds. Forced
suffix compression helps lower levels but does not remove the dense parent
matrix. A credible next representation would intern equal returned score rows or
columns across discard contexts while retaining distinct posterior weights and
choices. Such equality must be established or proved; discards must not simply
be averaged away. Opening speed is unverified until that representation exists
and passes a matched opening test.

## Suits: what a small summary can and cannot do

A four-entry suit histogram is sufficient for a known hand's flush, but not nobs.
`Js 4h 5c 6d` and `Jh 4s 5c 6d` have identical ranks and suit totals. With a 9s
cut, the first hand has one more point because its jack matches the cut suit.
A histogram plus a right-jack bit can compute a **known** hand's suited bonus
cheaply, or that bonus can simply be stored once.

That does not fill in hypothetical actors' private suits. They may have different
bonuses and make different choices despite sharing ranks. Nor do global suit
totals identify which suits are available at each rank when weighting the
opponent's show or crib. The existing exact live evaluator uses per-rank suit
masks for this reason. No whole suited-hand expansion is authorized under the
speed gate, and no claim is made that one suit counter fully repairs the issue.

## What the lost correlation means

The live root first combines opponent-specific pegging results into a distribution
of final pegging score pairs. Separately, it calculates the opponent's counting
score distribution and a crib distribution. Multiplying those marginals can
combine a pegging result from one hypothetical hand with counting/crib results
from another hypothetical hand that did not produce it. This is inherited from
20.7; the root's actual own counting hand remains exact.

For a deliberately simple numerical illustration, suppose we are dealer, will
have 117 after pegging in both equally likely cases, and hold four counting
points. In one case the pone finishes pegging at 118 and holds two counting
points. In the other the pone finishes at 114 and holds six. The pone reaches
120 in either actual case, then our count wins: 100%. Combining the two marginal
peg scores with the two marginal hand scores invents an `118 + 6` case with 25%
probability, incorrectly reducing that estimate to 75%. This example illustrates
the approximation; it is not a measured model win-rate error.

The repair is to preserve the association until applying WP, for example by
accumulating weighted `(peg pair, opponent show, crib)` outcomes before summing.
C may use the hypothetical cards to calculate these outcomes. The player's
choice must still maximize the weighted expectation over its legal information.
There is no need to expose the hidden cards to the decision policy. The current
request asks for this explanation; it does not authorize silently changing the
live root's correlation approximation as another strategy experiment.

## All card plays or only scoring plays?

The current solver visits legal **rank plays**, including zero-point plays and
Go, before collapsing results into terminal scores. It does not branch separately
for interchangeable physical cards of the same rank. It also compresses terminal
constant tables and uses physical evaluation for forced/uncontested suffixes.
It is not a tree containing only immediately scoring moves.

Removing all zero-point alternatives is incorrect. Every opening lead itself
scores zero. More locally, with 4 and 7 remaining against a 7, either lead scores
zero; the opponent's 7 scores zero after the 4 but a pair after the 7. A non-scoring
play changes the count, remaining ranks, pair/run opportunities, Go, next lead,
and the public evidence used by the other actor. Equal immediate scores do not
make those states interchangeable.

A scoring-oriented representation can collapse forced zero-point chains into
edges and share equal suffix arithmetic. It must preserve a zero-point choice
when that choice changes later scoring opportunities, terminal probabilities or
legal information. Merging nodes requires equivalence of those continuation
outcomes and decisions, not just equality of the current score. Establishing
that equivalence can itself require evaluating the branches. There is no support
for claiming that the original few thousand distinct scoring sequences are a
sufficient strategic state space by themselves.

## Validation

Bounded correctness tests and a serial release comparison are recorded under
`/private/tmp/cribbage-model283-private-contexts-20261003`.
The speed comparison is a late position, not an opening or whole-hand test.
Final verified results and the activation decision are recorded below after
completion.

## Verified result: retain as an experiment, do not activate

The corrected release job completed all four stages. Ten nonignored focused
tests passed; the frozen old opening and this explicit timing test were excluded
from that correctness invocation. Checks include an independent backward
reference over differing keeps and private discards, more than 1,000 recorded
private-context decisions, compressed/uncompressed endpoints, exact existing
keep-marginal probabilities, empty-opponent discard uncertainty, counting order,
scoreouts, dealer rotation, suit-count insufficiency and zero-point alternatives.
The existing hidden-card strategy-fusion witness also still passed.

The matched late-position solver test used the same release binary, serially,
with background task policy, nice 20 and one solving thread. Six unrelated
compute workers remained untouched. It used an existing legal position after
`K, 3, K, A, Go, 3`: pone has two cards left and dealer one. This is a **component
solve with three cards remaining**, not native API latency, a pone opening,
a whole-hand total, or a playing-strength benchmark. The assets/domain setup is
outside the measured solve. Both modes use the ordinary release compiler without
PGO. Core residency was not sampled; small timing ratios should not be inferred
from this shared-machine microtest.

| Measurement | Baseline | Private discards + rank-counting WP |
|---|---:|---:|
| CPU, trial 1 | 0.756 ms | 6.179927 s |
| CPU, trial 2 | 0.746 ms | 4.491439 s |
| Wall, trial 1 | 0.746416 ms | 6.249510 s |
| Wall, trial 2 | 0.739250 ms | 5.048748 s |
| Public score blocks | 12 | 39 |
| Private selection groups | 34 | 10,897 |
| Weight reads | 462 | 4,835,100 |
| Physical forced-pair scores | 407 | 467 |
| Returned score-table bytes | 546 | 4,471,266 |

The particular physical pair ends at 16–15 in both modes and both trials. This
is not evidence of equivalent or superior playing strength. The CPU penalty is
several thousandfold in this component test, even after forced physical-score
sharing and decision-local memoization of counting scores. It is already enough
to decline this implementation under the user's speed gate. A full-opening
slowdown or ETA has **not** been measured or extrapolated. The direct dense
opening table cost above is independently unfavorable.

The result does not establish that legally remembering discards is inherently
this costly. It identifies the weakness of the direct expanded-context layout:
private belief/decision work grows drastically while actual physical scoring
barely grows. The next compact representation should target that work. In
particular, once an actor has no future rank choice, its private discards can
potentially be marginalized in the remaining actor's counting expectation and
omitted from the **physical outcome axis**, provided conditioning and tie rules
are preserved. More generally, equivalent returned rows/columns may be interned
while keeping differing private weights. Merely caching more card scoring will
not address the observed dominant expansion. Forced rows should also bypass
valuation, and alternatives with identical complete conditional score vectors
can share one comparison while preserving the tie rule. Those reductions are
credible and could remove avoidable work in this late component; their opening
benefit has not been implemented or measured here.

Two diagnostic defects were found and repaired before the final measurement:
the compressed physical path's test-only action recorder initially omitted
private keys, and the inherited empirical helper lacked a zero-card remaining
hold row. The final tests exercise both repairs. One additional debug smoke run
was stopped after its first private-context iteration exceeded three minutes;
its baseline and stop receipt are preserved, and no completed candidate time is
claimed for that interrupted debug run.

The candidate is preserved as `private-context-candidate.patch`, full candidate
source, a release test executable, checksummed inputs and verified receipts under
`benchmarks/model28/private-contexts-20261003`. It is a bounded correctness and
cost experiment, not a finished native root integration. Applying its patch
alone does not activate the private-context path: the test explicitly enables
it. No models were registered or deployed by this follow-up.

After the experiment, the registered solver source was restored byte-for-byte.
**All 199 original native-integration inputs were rehashed successfully.** The
105 experimental inputs and test binary had been verified before restoration.
The patch applies cleanly to the restored source. Consequently the first two
requested corrections remain experimental, and the conditional suit extension
has not been enabled. The live root's correlation approximation also remains
unchanged; the explanation above describes its repair rather than claiming it
has been applied.

## Known-only continuation correction (2026-10-04)

The later [known-discard continuation assessment](model283-known-discards-continuations-20261004.md) retains the actual live actor’s two supplied discards throughout its own future choices, without enumerating unknown opponent discard pairs. The earlier large context counts apply to expanding every hypothetical actor’s possible private discards, not this narrow correction. The shared opposing policy remains private-information independent. Native and fresh-PGO checks found the narrow correction inexpensive; historical full-context costs above remain preserved.
