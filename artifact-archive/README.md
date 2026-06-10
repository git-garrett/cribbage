# Artifact Archive

Long-running benchmark, AI-vs-AI, and table-builder runs write into ignored
working directories such as `benchmarks/` and `.background/` so active runs do
not dirty the git tree.

When a run is complete and worth preserving for disaster recovery, promote its
curated outputs into this tracked archive:

```sh
npm run promote:artifact -- benchmarks/ai-smoke/my-complete-run
npm run promote:artifact -- benchmarks/pegging-table/my-complete-table-run --type pegging-table
```

The promotion script copies summaries, status files, top-level JSON results,
and pegging-table policy/summary JSON files. It intentionally skips logs, PID
files, raw row streams, and batch directories by default because those files can
be very large and noisy.

Use `--include-raw` only when the raw run material is intentionally small enough
to keep in git:

```sh
npm run promote:artifact -- benchmarks/ai-smoke/small-run --include-raw
```
