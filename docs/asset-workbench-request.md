# Asset build progress request

Target 1,250,000 chunks of the existing frozen 28.3.fast heat-ranked build,
retaining all completed work and filling missing indices only. Use the ten
available workers with normal scheduling. Keep full-depth assets locally and
publish only the first two dealer replies to production. Leave both stopped
benchmarks stopped and do not change the production engine or model policy.

Add a workbench tab with build/publication/archive progress, recent throughput,
ETA and milestones, workers, storage, observed opening coverage, and histories.
Keep paired reports working, including phone and keyboard use. Distinguish
empirical coverage from build percentage, archival status from publication, and
unavailable/stale data from zero. Use the existing managed local runtime.

The full build exceeds internal staging space. Preserve the existing foreground
external-volume permission boundary: verified foreground archival may release
redundant staging copies. Pause new work safely at a disk reserve if needed;
never discard the only full copy, grant broad disk permission, or introduce
periodic chat updates. Preserve immutable calculation receipts across resume.

Verification: focused supervisor/build and reporting tests, desktop/mobile UI
checks, exact queue-receipt preservation during the operational handoff, and
confirmation of the target, worker count, scheduling, and frozen policy.
