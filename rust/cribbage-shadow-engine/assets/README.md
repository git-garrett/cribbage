# Rust runtime assets

These are lookup tables required by the retained native Rust models. They are
runtime data, not independently selectable browser models. In particular,
`model13-pairwise.bin` was formerly stored beneath the retired 12.0 web-model
directory; keeping it here preserves the 13.0 Rust evaluator without retaining
any pre-13.0 model surface.
