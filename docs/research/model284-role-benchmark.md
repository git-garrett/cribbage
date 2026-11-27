# Ace 28.4 role segmentation versus Ace

The requested experiment retains separate dealer and pone tables in both score
regimes and uses the previously selected all-score cutoffs: dealer early 0–109,
late 110–120; pone early 0–111, late 112–120. Each regime uses that player's
public score at the start of the hand, before heels or pegging. Both role
distributions remain fixed throughout the live hand and hypothetical continuations.

Before gameplay, matched early-only controls assess whether role labels help:
for each selected cutoff, train and smooth a pooled-role control on exactly the
same early score range as the role-separated early model. Compare them on the
same earlier confirmation seed groups, reporting holding, discard and composite
log loss, plus paired whole-seed bootstrap intervals. This reused corpus is not
new blind evidence. No cutoff is reselected from these controls or game outcomes.

The candidate replaces the smoothed hold and keep-conditioned rank-discard
beliefs used during pegging, including future policy beliefs and the root joint
counting calculation. Verified production suit evidence and decline factors
remain in use. Discard choices and the old discard-correction forecast remain
unchanged; this test does not rebuild the correction asset. Production Ace
already has separate role tables: the game comparison tests refreshed,
score-segmented beliefs against those existing tables, not role separation alone.

Four serialized profiles cover the independent early/late combinations for
dealer and pone. Packing must preserve the exact selected probabilities. The
manifest binds each asset checksum, both cutoffs and the sweep provenance;
the runner pins the manifest checksum. Candidate 28.4 uses the executable
28.3 strategy without incompatible production opening books. Opponent Ace is
the production `schell_table-peg_table-28.3.fast` policy; without opening books,
it uses its exact executable fallback. Only 28.4 with the explicit benchmark
manifest selects the new beliefs. There is no production activation.

The fixed game contract is **512 seed pairs / 1,024 complete games**, 512 per
reciprocal seat orientation. Initial dealer alternates by game index. A fresh
seed range is chosen before play and excluded from retained training/tuning/test
seeds. Six workers run one orientation at a time. No game outcome changes the
candidate, cutoff or sample size. The deterministic paired reporter supplies
actual wins, paired uncertainty, score margin, phase outcomes, calibration,
timing and integrity. An inconclusive interval is not evidence of equal strength.

The one-shot job builds a frozen PGO binary with exact decision/value parity,
validates the native routing and probabilities, plays two reciprocal smoke
games, then runs both orientations. Verification, reports, durable synchronization
and read-only archive verification are separate ordered stages. Resumes enumerate
every missing game-index interval and preserve out-of-order completed games.

Implementation: `scripts/prepare_model284_role_benchmark.py`,
`scripts/model284_role_benchmark_stage.py`, and the opt-in native loader
`rust/cribbage-shadow-engine/model284_beliefs.rs`.

## Early role result and execution

Role separation helps in the early asset for both roles. Negative log-loss
deltas favor separate role tables; these are prediction losses, not win rates.

| Early role | Player-hands | Composite NLL delta | Paired 95% interval |
| --- | ---: | ---: | ---: |
| Dealer, 0–109 | 11,934 | −0.13444 | −0.14316 to −0.12616 |
| Pone, 0–111 | 11,918 | −0.14948 | −0.15725 to −0.14108 |

Holding and discard prediction each improve for both roles; their individual
intervals also exclude zero. The fixed 0–99 window gives the same conclusion.
See the [matched assessment](model284-early-role-assessment.json).

The job is `ace284-roles-vs-ace-20261126-v1`, rooted at
`/Users/garrett/Library/Application Support/StrongCribbage/runtimes/ace284-roles-vs-ace-20261126-v1`.
Its 11 ordered stages include 512 games per orientation. Engine source is
`42c86b99b6de3208184e069dc77db427d9cab66c`; numeric game seeds start at
`3038634487`, disjoint from 50,127 retained numeric seeds. Historical nonnumeric
seed IDs are recorded separately and cannot establish numerical RNG-range
disjointness. Durable output is scheduled for
`benchmarks/model284/roles-vs-ace-20261126-v1` in the shared project checkout.

Preparation's exact-equality guard caught a second hold quantization before any
games. Offline patch `e6ebc5d3877c500b15bcf034ba41032707013d67` now copies the
selected integer records unchanged. The original failed preparation and hashes
are retained in the runtime's repair receipt; the engine revision, job
specification, seeds, cutoffs and sample size did not change. All four packaged
profiles pass exact probability equality. [Preparation identity](model284-role-prepared.json).

The paired gameplay result is pending; production remains unchanged.
