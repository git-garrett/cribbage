# Background Process Status

Use the repository status reporter first. It reads the benchmark status files,
prints expected completion as a clock time, and compares that estimate with the
previous check.

```sh
/usr/local/bin/node scripts/report-background-status.cjs
```

For explicit status files:

```sh
/usr/local/bin/node scripts/report-background-status.cjs \
  benchmarks/pegging-table/overnight-20260609-023401/status.json \
  benchmarks/ai-smoke/top-three-10k-full-analytics-20260610-restart/status.json
```

Avoid `npm run status:background` in restricted Codex shells; `npm` and `node`
may not be on PATH. Use `/usr/local/bin/node` directly.

## Verify Live Processes

Use the PID from the status file or launch output:

```sh
ps -p <pid> -o pid,etime,command
```

To find exact benchmark processes without matching Codex conversation text:

```sh
ps -axo pid,etime,command | awk '/node .*scripts\/(generate-iterative-pegging-table|run-top-three-10k-benchmark|launch-background|smoke-four-model-ai)\.cjs/ && !/awk/ {print}'
```

Do not use broad `ps | rg node` checks here; Codex process command lines can
contain old conversation text and create false positives.

## Graceful Table Stop And Resume

Stop the running table builder with SIGTERM:

```sh
kill -TERM <pid>
```

Confirm it exited:

```sh
ps -p <pid> -o pid,etime,command
```

Resume from the existing row file by counting completed rows and passing that
count as the `start` argument:

```sh
wc -l benchmarks/pegging-table/overnight-20260609-023401/iteration-3.rows.jsonl
```

Current N=3 resume command:

```sh
/usr/local/bin/node scripts/launch-background.cjs table-build-stop-at-n3 -- \
  /usr/local/bin/node --max-old-space-size=8192 \
  scripts/generate-iterative-pegging-table.cjs generate \
  benchmarks/pegging-table/overnight-20260609-023401 \
  12 3 282863 0 \
  benchmarks/pegging-table/overnight-20260609-023401/iteration-2.policy.json \
  3 1
```

The final two numbers mean `iteration=3` and `iterationCount=1`, so it finishes
iteration 3 and stops instead of continuing through the earlier N=10 plan.

## AI Vs AI Runner

The completed top-three run status is:

```sh
/usr/local/bin/node scripts/report-background-status.cjs \
  benchmarks/ai-smoke/top-three-10k-full-analytics-20260610-restart/status.json
```

The resumable top-three launch shape is:

```sh
/usr/local/bin/node scripts/launch-background.cjs top-three-10k -- \
  /usr/local/bin/node scripts/run-top-three-10k-benchmark.cjs \
  benchmarks/ai-smoke/top-three-10k-full-analytics 10000 25 10
```

The runner writes child status and summary files below the output directory, so
reruns against the same output path can use existing completed work.
