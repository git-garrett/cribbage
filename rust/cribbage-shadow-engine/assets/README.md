# Rust runtime assets

These are lookup tables required by the retained native Rust models. They are
runtime data, not independently selectable browser models. In particular,
`model13-pairwise.bin` was formerly stored beneath the retired 12.0 web-model
directory; keeping it here preserves the 13.0 Rust evaluator without retaining
any pre-13.0 model surface.

`board-win-matrix.bin` (`BWM2`) contains the four pooled phase-seam matrices
used by Model 13.215: discard, after discard, after pegging, and after pone's
count. The after-discard seam is after starter reveal and any heels points.
Generate it from the verified matrix SQLite database with
`scripts/export-board-win-matrix.py`; do not hand-edit it.

Model 16's offline-trained pegging policy is packed to
`model16-pegging-policy.bin` by the `pack_policy` binary. The artifact records
its key schema, training seed and iterations, source checkpoint checksum,
coverage threshold, provenance, and missing-key backoff. It is not required by
models 13.0 through 15.2. The server packaging script copies this entire asset
directory, so a generated Model 16 policy is included without a separate
deployment rule.

Legal-action probabilities use deterministic largest-remainder quantization
with a denominator of 65,535. Each unpacked probability differs from its
normalized trainer value by at most `1 / 65,535`; illegal actions remain
exactly zero.

Model 9.1 uses four isolated runtime assets:

- `model91-pair-outcomes.bin` (`M91PR001`) stores both terminal pegging totals
  for all 1,820 × 1,820 ordered dealer/pone rank-only keep matchups; incompatible
  cells are explicitly marked invalid.
- `model91-pone-leads.bin` (`M91LD001`) stores the original context-free
  rollout-policy opening lead for each pone keep. Corrected live Model 9.x play
  no longer executes this pre-cut lead.
- `model91-pegging-beliefs.bin` (`M91BL001`) is the packed historical Model 9
  empirical remaining-hand distribution used after public opponent plays.
- `model91-discard-ev.bin` (`M91EV001`) contains the exact 330,590
  six-card/discard/role weighted-sum rows. Each row was compiled by removing
  all six visible cards and exactly reweighting the compatible opponent keeps.
  Runtime evaluates all discard candidates by direct row lookup.

As of the 2026-08-28 legal-known-card correction, both Model 9.0 and 9.1 live
pegging remove the actor's own two discards and the revealed cut from possible
opponent hands. The opponent's two discards remain absent from the policy
observation. Opening leads are recomputed at pegging time rather than replayed
from the frozen pre-cut tables. No client-side model exists in the web or iOS
bundle; both clients use this server-side Rust path.

The 9.0 and 9.1 discard EV files remain frozen discard-time forecasts, and the
13.1 histogram remains a frozen derivative of the original context-free
rollouts. Rebuilding a policy-consistent discard forecast would be a new asset
version: own discards can be keyed directly, but the not-yet-known cut must be
integrated over every legal cut context. The completed historical benchmarks
therefore describe the pre-correction live policy unless explicitly rerun.

The exact joint distribution is the **Model 13.1 histogram asset**. Its
rollouts use the Model 9.1 observation-only policy, but Model 9.1 itself reads
only the mean-EV table. The original six-byte-bin compiler output
(`M91HS001`) remains in the durable full-build record under
`benchmarks/model91/full-20260827/` as provenance.

The packaged Model 13.1 representation is
`model131-discard-histograms.bin` (`M131H001`). This is a lossless runtime
repacking, not a new simulation or a quantized approximation: each row stores
one byte of bin count, and each four-byte bin packs the original ten-bit score
pair plus its original seventeen-bit integer weight. The complete asset has
330,590 rows, 24,884,749 bins, and 99,869,610 bytes. Model 13.1 applies Model
13.0's board-aware win-probability discard objective to these distributions
while retaining Model 13.0's pairwise lead selection and live pegging. This is
an intentionally narrow discard-asset ablation; the histogram's observation-
only rollout policy is not substituted into live play. Frozen Model 13.0
continues to use `model13-pairwise.bin` unchanged.

Model 13.0 and 13.1 use their own discards, the cut, and public plays to remove
impossible opponent cards during live pegging; they never receive the
opponent's discards. Pairwise lead selection remains part of their pre-cut
discard forecasts, but the executable opening lead is recomputed after the cut
instead of replaying that forecast.

`model90-discard-ev.bin` (`M90EV001`) is a lossless packed transcription of
the historical Model 9.0 table. It is used only to provide an immutable native
9.0 baseline for controlled Model 9.1 evaluation.

Model 13.2 uses `model132-keep-pairs.bin` (`M132P001`), an exhaustive dense
1,820 by 1,820 matrix of terminal dealer/pone pegging outcomes plus frozen
role-specific empirical keep priors. At discard time the runtime removes the
actor's four kept cards and two candidate crib discards from physical
opponent-hand availability, reweights compatible opponent keeps, and passes
the resulting score distribution into Model 13.0's unchanged board objective.
The initial Model 13.2 comparison deliberately retains Model 13.0 live pegging
and all non-asset discard logic.

Model 20 live pegging additionally loads `model132-keep-prior.json`, copied
unchanged from the frozen 13.23 correction-builder inputs. Its SHA-256 is
`ce5f9e6fc81854d5a6cab52a539906298e65c70861afa54ddfaf94eb4c09b4a4`, checked at
load time. Generated by `scripts/build_model132_keep_prior.py`, it holds 1,740
dealer and 1,798 pone keep frequencies, blending equally normalized Model 9.x,
Model 13.x, and human cohorts. Model 20 uses the opponent's role distribution
before any opponent play, conditioned on legally known cards. Historical live
policies do not load this JSON. See `docs/model-20-baseline.md` for the depletion
rule and the unchanged discard-asset boundary.

Model 20 also uses that keep prior for cut-conditioned opponent hand scores
when choosing discards. `model20-opponent-discards.bin` supplies its conditional
opponent-discard rank distributions and same-suit rates during discard evaluation
and live pegging/review. It originally consolidated
`model1322-opponent-discard-histograms.json` and the suited-discard information in
`empirical-discard-keep-14.8.bin`. The original 14.8 JSON supplies exact total and
same-suit counts, preserving the evidence behind the rounded rates. Those counts
come from 211,303 games and 2,079,994 usable discard/keep rows; they are not added
to the separate normalized rank weights. Model 20 no longer loads either legacy
discard asset. Historical models retain both original files unchanged. The
conditional section now adds 16,418 newer completed games from 13.215, 13.23 and
20.0, bringing it to 747,316 usable decisions. Raw conditional counts and the
exact per-run import ledger are retained in
`training/model20-opponent-discard-evidence.json.gz`. The suit section is unchanged.

Regenerate with `python3 scripts/pack_model20_opponent_discards.py`; use `--check`
to verify byte-for-byte reproducibility. The packer reads the original suit JSON
from its recorded Git revision, or accepts `--suit-source PATH` when that history
is unavailable. Runtime needs only the committed packed file. See
`docs/model-20-opponent-discards.md` for format, provenance, and validation.
Model 20 continues using the existing crib rank/histogram assets for crib rank
weights and scores.

Model 13.22 calibration uses `model1322-decline-factors.json`, a schema-3
empirical evidence asset derived from human server play and compact benchmark
logs. For every observed non-scoring decline it records whether the player
actually held the legally playable scoring rank. `heldGivenDeclinePpm` exposes
that posterior probability directly; `multiplierPpm` retains the corresponding
held-card likelihood update so the policy can reweight its own current prior
rather than replacing it with the corpus-wide prior. Model rows are accepted
only for the explicit 13.x–15.x exhaustive
pegging-policy cohort. Human, exhaustive-model, and pooled counts are retained
separately. Every opportunity requires the scoring rank to be held and legal,
and is excluded when the opponent has no cards left or the chosen alternative
itself scores. Rates are split by whether the choice is the player's first,
second, or third card. In addition to pair/run completion rates, the asset
distinguishes declining a pair royal after a pair, declining four of a kind
after a pair royal, and declining a pair or pair royal when retaliation was
known to be impossible from dead/held/played cards, the 31 limit, or the
opponent having already said go in that round. Runtime uses the pooled
parts-per-million likelihoods; source hashes and raw counts make later
regeneration auditable.

`model1322-opponent-discard-histograms.json` stores the role-specific
conditional distribution of an opponent's two private discard ranks given
their four-card keep. Model 9.x and Model 13.x source cohorts are normalized
independently within every role/keep before blending. The calibration removes
histogram entries made impossible by the actor's six known cards, reweights
the remaining entries for physical rank availability, and removes the
opponent's modeled private discards before enumerating cuts. The JSON form is
kept for provenance and future strength updates; a production build may pack
the same integer weights without changing their semantics.

Model 9.11 is the reusable context-free four-keep by four-keep baseline for
Model 13.22. It retains Model 9.1's complete-opponent-hand EV evaluation but
uses Model 13.22's go and scoring-decline logic at every non-forced decision.
Its durable pair asset stores terminal pegging totals only. Model 13.22 applies
the actor's two known discards and the cut as a sparse correction: cached
action-by-hidden-hand continuation evidence is reweighted, unchanged actions
reuse the 9.11 terminal cell, and only the suffix after the first changed
action is replayed. Action traces and evidence caches are builder-local and
are not runtime assets. See `docs/model-9.11-13.22-sparse-build.md`.

`model1322-corrections.bin` (`M1322C01`) is the resulting finite runtime asset.
It stores one weighted terminal pegging summary for each canonical six-card
hand, candidate discard, and role, plus cut-indexed pone opening-lead masks.
After the opening lead, live pegging continues through the same executable
legal-information policy used by the builder; the asset contains no later
observation-to-action table or pegging-path graph.

Model 13.23 requires the separately verified `model1323-corrections.bin`
(`M1323C01`) correction-only rebuild. It retains exact joint own/opponent
terminal pegging histograms, not just means. The native engine integrates these
distributions through the exact BWM2 asset used by 13.215 and selects by live
board WP. It does not execute the inherited diagnostic lead masks. Live candidate
forecasts use the unchanged correction-builder continuation chooser, with
decision-local memoization, exhaustive world enumeration, and exact WP pruning.
The verified 522,911,094-byte asset is installed separately from the ignored
`benchmarks/model1323/correction-20260913-v2/work/merged/` archive. Its SHA-256 is
`ff0894471867cd80c636a46bb4c8c148b7300090a9b536dd61d991fea6fe293a`.
Verification evidence is committed under `artifact-archive/model1323/`.
There is no means-only or Model 13.0 board fallback. See
`docs/model-13.23-wp-strategy.md` for required identities and approximation limits.

The selectable Model 9.11 runtime uses `model911-discard-ev.bin`, an exact
six-card aggregation of that completed keep-pair matrix. Live pegging executes
the same legal-information policy with the actor's own discards, cut, public
go evidence, and scoring-decline likelihoods. Because deployment has a human
on the other side, every later model decision retains the same actor-relative
perspective: exact continuation states calculated on the model's earlier move
are cached in memory and reused after the human's play narrows or reweights the
possible opponent hands. The cache belongs to that game session rather than an
HTTP worker thread, so reconnecting requests resume the same analysis. It is
cleared when pegging ends and contains no observation-to-action table or
durable pegging-path graph.
