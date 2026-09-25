# Working Guidance

- For pegging-policy architecture, read `docs/adr/0001-use-an-executable-pegging-policy.md`. Use an executable legal-information policy and decision-local memoization; never use a persistent observation-to-action table or exhaustive pegging-path graph.
- For starting, resuming, stopping, or queuing long cribbage benchmarks and builds, use the `cribbage-benchmark-runner` skill and its one-shot job supervisor.
- For each new benchmark, generate and record a fresh random base seed, avoiding previously recorded seed ranges. Share the saved seed sequence between paired orientations and preserve it on resume; reuse an earlier benchmark's seeds only for an explicitly requested reproduction.
- For local web/API listeners or LAN/iOS testing, use `scripts/local-runtime.sh`; it owns the shared ports and launchd services for every Codex client.
- For unrelated implementation work or production deployment, read `docs/production-workflow.md` and follow its branch-to-PR-to-review-to-merge-to-deploy sequence.
- For tests, builds, job monitoring, structured-data inspection, and review reporting, follow `docs/compact-output.md`.
