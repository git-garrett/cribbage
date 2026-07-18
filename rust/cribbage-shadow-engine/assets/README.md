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
