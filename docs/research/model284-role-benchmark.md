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
