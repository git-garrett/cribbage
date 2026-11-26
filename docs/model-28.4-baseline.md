# Ace 28.4 baseline

Request: begin the next decimal Ace model as a separate starting point for the
reviewed improvements. The initial version must preserve current Ace behavior.

`schell_table-peg_table-28.4` (CLI alias `28.4`) starts from production
`schell_table-peg_table-28.3.fast` at commit
`d68457dd9b3fd4afd8f8cc9537b3a9fb3143d869`.

The new model has its own persisted and benchmark identity. It is experimental:
the production Ace alias, Dynamic delegates, and production Ace resume/rating
classification retain their existing models. The API advertises 28.4 and can
create, save, resume, and review its games explicitly.

All decision and review entry points delegate 28.4 execution to 28.3.fast.
This preserves the same strategy, tie rules, immutable assets, hand caches,
optional fingerprint-checked opening accelerator, and exact solver fallback.
No asset is copied or rebuilt; none of the outstanding modeling fixes is applied
in this baseline.

Before changing 28.4 strategy or inputs, replace its baseline delegation in
`model.rs::with_execution_model` with an isolated 28.4 path. Any changed policy
must have its own asset fingerprint and cache identity; do not reuse a 28.3
opening shard for changed behavior. Preserve versioned 28.3 behavior.

Validation includes bit-exact pegging actions/EV/WP in both roles, ordinary and
near-finish scores, shared caches, and combined/selected review of both choices.
The installed-asset discard test compares decisions and alternative-discard
reviews in both roles; it is part of the predeploy gate.
