---
name: cribbage-benchmark-runner
description: Launch, resume, stop, monitor, or queue long-running cribbage benchmarks and dependent builds with the repository's deterministic one-shot job supervisor. Use whenever a cribbage benchmark or build must survive the Codex session or run after another job; do not use for ordinary foreground tests.
---

# Cribbage Benchmark Runner

Use `/Volumes/TerraMasterWDBlue/Dev/cribbage/scripts/cribbage_job_queue.py`. Never reconstruct a detached command from memory.

## Launch

1. Confirm the requested models from retained head-to-head evidence and freeze the exact seed, orientation count, workers, source revision, binary, assets, and report command.
2. Put the executable, runner script, and mutable runtime output on the internal disk under `/private/tmp`. A benchmark stage may read frozen inputs there; only an explicit final sync stage writes results back to the external workspace.
3. Create a versioned JSON job specification. Read [job-spec.md](references/job-spec.md) when creating or changing one.
4. Validate it, then install the one-shot job:

   ```bash
   python3 scripts/cribbage_job_queue.py validate JOB.json
   python3 scripts/cribbage_job_queue.py install JOB.json
   ```

5. Immediately inspect the status file and `launchctl print gui/$(id -u)/com.strongcribbage.job.JOB_ID`. There must be one job, `KeepAlive` must be false, and the running supervisor path must be under `/private/tmp`.

The queue must place verification, final reports, durable sync, and dependent builds in separate ordered stages. Every stage needs objective completion checks. A failed stage blocks every later stage and remains failed; there is no automatic retry loop.

## Resume or stop

Inspect `status.json` and the failed stage log first. Preserve the original job
specification and every completed game index. A parallel run can commit higher
indexes before a lower one, so resume by enumerating missing contiguous index
ranges. Never infer the new range from row count or contiguous prefix alone;
that can overlap already committed games. Stop with:

```bash
python3 scripts/cribbage_job_queue.py stop JOB.json
```

After fixing the demonstrated cause, reinstall the same specification. Completed stages with passing checks are skipped. Never use `launchctl submit`, a `KeepAlive` job, or a zsh wrapper. Never run two writers against one benchmark database.

## Completion

A benchmark is complete only when both orientation databases have the
contracted row counts and full index intervals, analysis reports exist, the
paired summary is generated, and the final workspace sync passes the same
checks. Report any blocked queued stages explicitly.
