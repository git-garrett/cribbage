# Qualify scoring-decline data by the actual pegging policy

Accepted 2026-09-27 for Model 20.3's decline-factor asset and its successors.

Historical overall Ace strength is insufficient eligibility for an asset that
interprets an opponent's refusal of a scoring play. The 9.x observations pooled
into Model 20.3 materially underpredicted strategic declines. Their chooser
forecasts averaged legal continuations, although 9.11 adds go/decline inference.
This asset will use verified strategic pegging policies and retain positive
Bayesian smoothing.

The current approved versions are 13.0, 13.2, 13.21, 13.215, 13.23 and 20.0–20.3.
Model 13.1 qualifies only in the two verified corrected legal-lead snapshots.
Other versions require an audit of the actual live policy before admission.
Version numbers are not sufficient: 13.22 uses the 9.11 chooser, and the first
13.1 benchmark did not use the later corrected 13.1 live policy.

Exclude 9.x and other unqualified policies, the 13.1 actor in the original
mixed-policy run, and both actors in the superseded pre-cut-lead run. Exclude
the inherited human aggregate because its skill/policy cannot be classified.
Apply qualification to each acting player, respecting per-play overrides.
An approved actor against an excluded opponent may still contribute.
ADR-0002's unconditional exclusion of 15.x/16.x remains in force.

Known source snapshots are checked by SHA-256 against
`training/model203-decline-source-policies.json`. Before adding a new snapshot,
verify its frozen runner/engine and policy provenance, then register its hash;
this review does not require user permission. A new hash must not silently
inherit eligibility from its filename or a reused model label. The builder
records per-source/per-model raw counts and verifies that they reproduce the
aggregate. Reserved validation seeds remain excluded across all sources and
paired orientations. Checkpoints retain exact included game identities.

This restriction is specific to behavioral decline learning. It does not
retroactively disqualify 9.x discard data or change other assets' eligibility.
The previous broad evidence, factors, and audit remain archived for reproduction;
they are not priors or training counts in the qualified asset.

See [the asset report](../model-20.3-decline-factors.md) for prediction checks and
the distinction between inference quality and playing strength.
