# Working Guidance

- For pegging-policy architecture, read `docs/adr/0001-use-an-executable-pegging-policy.md`. Use an executable legal-information policy and decision-local memoization; never use a persistent observation-to-action table or exhaustive pegging-path graph.
- For starting, resuming, stopping, or queuing long cribbage benchmarks and builds, use the `cribbage-benchmark-runner` skill and its one-shot job supervisor.
- For local web/API listeners or LAN/iOS testing, use `scripts/local-runtime.sh`; it owns the shared ports and launchd services for every Codex client.
- For unrelated implementation work or production deployment, read `docs/production-workflow.md` and follow its branch-to-PR-to-review-to-merge-to-deploy sequence.
