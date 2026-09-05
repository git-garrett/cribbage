# Compact work output

Keep routine success output small without discarding information needed to fix a
failure.

## Tests and builds

Use the repository commands instead of invoking their underlying tools directly:

- `npm test` for the full Rust suite
- `npm run test:web` for Vitest
- `npm run typecheck` for TypeScript
- `npm run build` for the client build
- `npm run qa:predeploy` for the complete deployment gate

Successful commands print one summary line. A failed command prints its complete
captured output. Builds also print warning blocks and their context on a
successful run that contains warnings, so warnings are never hidden.

Wrap any new routine QA command with `scripts/run-quiet.sh`. Use
`--show-warnings` for compilers, bundlers, and other commands whose successful
warnings may require action.

## Background jobs

Start with the supervisor's summary, which reads its status file and configured
SQLite completion counts without opening worker logs:

```bash
python3 scripts/cribbage_job_queue.py summary path/to/job.json
```

Use `status` for the complete machine-readable record. Read a stage log only
after a failure, or when timestamps and database counts show that progress has
stalled.

## Structured data

When inspecting an API response or database, print only the fields, counts, or
aggregates needed for the current decision. Expand the raw payload or rows only
when diagnosing missing, malformed, or contradictory data.

## Reviews

Report actionable findings in severity order with file and line references. If
there are no findings, say `No findings.` Add at most one short verification or
residual-risk note; do not restate the implementation.
