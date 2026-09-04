# Model 13.215 board-matrix ablation

Model 13.215 is Model 13.0 with one controlled substitution: future board win
probabilities come from the verified pooled board matrix instead of Model
13.0's pre-90 heuristic and post-90 recursive phase model.

The artifact contains four 121 × 121 matrices from the perspective of the
dealer in the hand containing the seam: at the discard decision, after both
discards plus starter reveal/heels resolution, after pegging, and after pone's
count. Each occurrence of each seam in every completed two-sided trajectory
contributes a suffix. That suffix is transposed onto every score cell from
which both players can still cross 121, so the population grows toward the
120–120 corner. Uncertainty remains clustered by the original random seed.

The source pool contains 40,000 completed trajectories across 10,000 seed
clusters. `scripts/export-board-win-matrix.py` validates the SQLite cohort and
exports the compact `BWM2` runtime artifact. The Rust runtime loads the roughly
458 KB artifact once and keeps it in RAM.

The verified schema-2 source is retained at
`benchmarks/model9-board-win-matrix-20260902/phase-seams-v2/`. Its SQLite SHA-256
is `c062fadb36e6228596a53880f413d9bc51a79b3e3a1afdf8e305ecf6f12774d4`; the
exported runtime asset SHA-256 is
`099715bc3aed5b296c39fb3edfd8fa30e0dad13239dede1c8963e344dfe8d679`.

Before a lookup, Model 13.215 applies every legal fact or forecast already
available to Model 13.0. This includes candidate pegging outcomes, an exact own
hand score once the cut is known, the opponent-hand distribution, and the
own-discard-and-cut-conditioned crib distribution. It then looks up the
resulting score at the furthest applicable phase seam. A known or modeled
outcome is never replaced by the population average embedded in an earlier
seam.

Everything else remains frozen at Model 13.0: hand and crib scoring, pairwise
discard-time pegging outcomes, live pegging search, legal-information boundary,
lead selection, and tie breaks.

During benchmark playout, both Model 13.0 and Model 13.215 keep an ephemeral
hidden-world cache for each player for the duration of the hand. The first
analyzed move enumerates the possible opponent hands. Later moves remove worlds
inconsistent with newly public cards and reweight the remaining subset using
the current public history. Each move still executes the pegging policy with a
decision-local transposition arena; no pegging path or selected action persists
between decisions. The hand cache is cleared at the end of pegging.

The paired benchmark uses 5,000 shared-seed games in each side orientation
(10,000 total) against Model 13.0. Both orientations run simultaneously with
two workers each, replacing the four workers released by the matrix build.
