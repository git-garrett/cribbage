# Rust runtime assets

These are lookup tables required by the retained native Rust models. They are
runtime data, not independently selectable browser models. In particular,
`model13-pairwise.bin` was formerly stored beneath the retired 12.0 web-model
directory; keeping it here preserves the 13.0 Rust evaluator without retaining
any pre-13.0 model surface.

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
