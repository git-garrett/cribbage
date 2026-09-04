# Job specification

Use schema version 1. Commands are argv arrays, never shell strings.
`jobRoot` may be set to an absolute persistent path when checkpoints must
survive a reboot; otherwise the supervisor defaults to `/private/tmp`.
Use absolute `launchdPlistPath` and `supervisorLogPath` overrides when the job
root is on a `noowners` volume that launchd cannot use for registration or
standard-output files. The stage logs and all job state remain in `jobRoot`.

```json
{
  "schemaVersion": 1,
  "jobId": "model91-myrmidon-10k",
  "stages": [
    {
      "name": "benchmark",
      "command": ["/bin/bash", "/private/tmp/FROZEN/scripts/run-benchmark.sh"],
      "env": {
        "OUT_DIR": "/private/tmp/OUTPUT",
        "WORKERS": "5"
      },
      "completionChecks": [
        {
          "type": "sqlite_count",
          "path": "/private/tmp/OUTPUT/left/games.db",
          "table": "compact_games",
          "equals": 5000
        },
        {
          "type": "json_field",
          "path": "/private/tmp/OUTPUT/left/status.json",
          "field": "status",
          "equals": "complete"
        }
      ]
    },
    {
      "name": "sync",
      "command": ["/usr/bin/rsync", "-a", "/private/tmp/OUTPUT/", "/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/OUTPUT/"],
      "completionChecks": [
        {
          "type": "sqlite_count",
          "path": "/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/OUTPUT/left/games.db",
          "table": "compact_games",
          "equals": 5000
        }
      ]
    }
  ]
}
```

Supported checks are `file_exists`, `json_field`, `sqlite_count`, and
`sqlite_contiguous_indices`. For resumable benchmarks, require both the
expected row count and the full index interval so out-of-order worker commits
cannot create a false completion or an overlapping resume. Put dependent
builds after benchmark verification and sync so they cannot compete for CPU or
start from partial results.
