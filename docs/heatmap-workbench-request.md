# Heatmap workbench request

The user requested eight workers split four each between the full 28.3 pegging
heatmap refresh and the existing opening asset build, with the new work in the
browser workbench. Discard maps were already generated and remain applicable
because the retained discard behavior is unchanged.

The workbench must register supervised analysis jobs using their explicit root
and target, show completed and reused cases, active worker limit, compute ETA,
progress history and completion by scoring class and role. It must retain the
paired benchmark and asset views. Read only small progress snapshots/history,
never scan the live replay SQLite database. Withhold stale/failed ETAs and keep
compute completion distinct from verified report/archive completion. Support
phone layouts and read-only LAN access through scripts/local-runtime.sh.

The launched job is model283-full-heatmaps-v1, with 1,211,602 original confirmation
cases and 21,351 prior exact results retained. The build remains a separate
four-worker supervised job; disk reserve waits are visible in its existing tab.
