# Native model learning in the workbench

Models 32 and 33 have separate read-only tabs. Each tab shows independent seed
curves against the frozen original Model 31, paired evaluation intervals, the
larger Model 31 reference, current activity, and completed-round throughput.
Candidate tests and fixed-dataset validation are shown separately. Continued
training inherits its source run's live-training time on the graph. Offline
pretraining, evaluation, archiving, and GPU queue time are excluded from that
axis; throughput includes self-play, neural updates and WP updates only.

Register each tab with the existing workbench registry. A descriptor has the
normal job ID and shared campaign `jobRoot`, plus `trainingStudy` fields:

```json
{
  "mode": "native-search",
  "model": 32,
  "target": 24,
  "title": "Model 32 · component predictions",
  "root": "/persistent/campaign/train-32-seed-1",
  "campaignRoot": "/persistent/campaign",
  "reference": {
    "label": "Larger Model 31 final assessment",
    "winRate": 0.6428,
    "paired95": [0.6356508901641191, 0.649949109835881],
    "games": 10000
  }
}
```

Use a different `root` per model so tab visibility remains independent. The
reference must come from the retained final assessment against the same frozen
opponent. The adapter reads small JSON receipts and validation histories; it
never loads models, game records, or GPU libraries.

After the normal PR/review/merge workflow, deploy through
`scripts/local-runtime.sh workbench-start`. Existing experiment-specific
workbench snapshots can retain their Model 31 adapters: apply the small dispatch,
asset and runtime-copy changes from this release and copy the new Python and
JavaScript modules into their source snapshot before running that snapshot's
runtime manager. Keep a backup of the previous source and registry. Do not
replace the snapshot wholesale with a generic workbench or restart training.

Validation: `npm run test:workbench` and
`node scripts/test_native_search_workbench.cjs`. The browser test also accepts
a JSON file containing two live read-only report snapshots as its argument.
