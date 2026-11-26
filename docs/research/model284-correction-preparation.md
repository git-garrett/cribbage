# Ace 28.4 discard-correction preparation

User request: audit whether cleaned, smoothed evidence is adequate, regenerate
corrections if computationally light, and prepare reader/dispatch and validation.

## Evidence and adequacy

The retained cleaned snapshots contain 121,996 added games for hold beliefs,
124,729 games for conditional discards, and 64,131 qualified decline games.
The hold and discard cohorts include substantial strategic 13.x/20.x evidence
as well as approved older observations. Decline evidence uses only the reviewed
strategic cohort under ADR-0003. The inherited hold and discard evidence chains
exclude 15.x/16.x actors. These are overlapping corpora, not independent totals.

This is adequate aggregate evidence to build and test a candidate. It does not
establish precision in every rare context or stronger play. Smoothing retains
all 1,820 keeps per role and 165,295 physical keep/discard cells per role.
In particular, four-of-a-kind decline evidence remains sparse; do not mistake
positive smoothed support for many direct observations.

`scripts/prepare_model284_corrections.py` verifies the retained evidence/asset
identities and exports `beliefs.bin`, `factors.json`, `keep-prior.json` and
`discard-histograms.json`. No new observations are invented. Opening weights
come from the complete smoothed hold binary. Every conditional discard row is
apportioned to exactly 10^12 positive integer weight, before known-card depletion.
Minimum exported weight is 617,701; even the worst two-card combination ratio
cannot round it to zero. Maximum probability change is 6.01e-13. Keep weights
retain their existing integer precision. The factor adapter adds attributable
cohort metadata while preserving the qualified factor values.
The dedicated decline validator checks registered source hashes, corrected 13.1
snapshots, excluded lead sources, and reconciliation of source/model counts.
The builder additionally requires the exact reviewed factor snapshot, so a broad
model-version allowlist cannot admit an unqualified replacement.

The builder now reads the complete hold and qualified factor formats directly,
with empirical depletion and positive soft support in both optimized and direct
verification policies. Historical input formats retain historical behavior.
The normalized `M20DC001` output format is retained. Its four input FNV identities
change, and the baseline identity is zero for generation inline. A historical
baseline file is not to be supplied for this changed policy.

Audit: [model284-correction-input-audit.json](model284-correction-input-audit.json).
Pinned runtime identities: `assets/model284-correction-inputs.json`.
Prepared files: `/Volumes/TerraMasterWDBlue/Dev/cribbage/output/model284-correction-inputs-20261126`.

## Cost and remaining work

The historical exhaustive build took about four days on six workers. Complete
smoothed support expands the workload; the new full build is not timed and may
take longer. This is computationally heavy, so the user's conditional instruction
does not authorize silently launching it. No full rebuild, persistent pilot,
paired strength benchmark, or production activation has been launched.

A future authorized run must first freeze source/binary/input identities on
persistent internal storage, use the one-shot supervisor, measure representative
dealer/pone keep ranges, and produce a revised estimate. Use the prepared inputs
with `--joint-distributions --model20-normalized-discards`; baseline traces are
generated inline. Merge requires complete, gap-free dealer/pone coverage and
consistent input fingerprints. Export every row's positive mass, normalization,
moments, and support checks before producing an activation manifest.

Then benchmark frozen candidate versus 28.3.fast on fresh paired seeds and report
strength, calibration, changed discards and timing. Existing 28.3 policy objectives,
discard-time marginal correlations and aggregated score-out limitations are not
corrected by this work. The build retains the older net-points rollout objective.

## Reader and activation gate

`Model1323CorrectionTable::load_normalized` requires complete normalized-format
rows, exact SHA-256, and the pinned cleaned input fingerprints. The historical
loader continues rejecting normalized artifacts. Candidate loading is serialized
and cached separately from the production correction asset.

The separate 28.4 discard/review path is enabled only by the explicit process
configuration `CRIBBAGE_284_CORRECTIONS_MANIFEST=/absolute/path/manifest.json`.
The manifest must contain only `schemaVersion: 1`, `modelVersion: "28.4"`, and
`assetSha256: "<verified full SHA-256>"`. The full asset must be named
`model284-corrections.bin` beside it. No manifest is created by preparation.
An enabled path fails on missing, corrupt, partial, or mismatched inputs; it
does not silently use the old asset. The same setting applies to discard review.
Changing configuration or assets requires a process restart. Pegging remains
28.3.fast with its existing fingerprint-checked accelerator.

Create and enable that manifest only after completed output verification and an
acceptable held-out strength assessment. Checksums establish identity and
integrity; they do not certify playing strength. Production Ace remains 28.3.fast.
