# Automatic opening-asset archiving

The asset builder keeps mutable work on the internal disk. A separate, bounded
archive worker transfers committed chunks to TerraMaster and releases their
internal copies after hash verification and a durable queue checkpoint. It
continues while the screen is locked and does not require a Codex conversation
to remain active. The Mac must remain awake, the user must remain logged in, and
the archive volume must remain mounted. Locking the screen is supported; sleeping,
logging out, rebooting, or disconnecting the drive is not an availability promise.

## Permission setup

An ordinary launchd Python process cannot necessarily write removable volumes.
Do not route around a macOS access denial or give a general-purpose interpreter
Full Disk Access. Use the small `Cribbage Archive.app` helper to obtain an explicit
grant to the configured archive folder through the macOS folder picker.

Build a local, ad-hoc signed helper once at a stable internal location:

```sh
scripts/run-quiet.sh --show-warnings 'Archive access helper' python3 scripts/build_archive_access_app.py '/private/tmp/ARCHIVE-RUNTIME/Cribbage Archive.app'
```

While unlocked, run the helper's `authorize BOOKMARK DESTINATION` mode. Select
exactly the intended archive folder. The helper saves a security-scoped bookmark
with mode 0600. It does not start the worker or change any privacy preference.
Replacing the signed helper or moving the chosen folder may require a fresh
grant. Do not attempt interactive authorization from an unattended job.

Run a **separate one-shot supervisor probe** with this stage command before
enabling the archive worker:

```text
/private/tmp/ARCHIVE-RUNTIME/Cribbage Archive.app/Contents/MacOS/ArchiveAccess
access
/private/tmp/ARCHIVE-RUNTIME/archive.bookmark
/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/ace283-production-20261005
/usr/bin/python3
/private/tmp/ARCHIVE-RUNTIME/probe.py
```

The probe must verify a read/write round trip in the chosen folder and remove its
own test file. A saved bookmark or foreground success alone is insufficient:
only success in the launchd process confirms unattended access. If macOS denies
access, retain the failure and request a new explicit grant; never substitute an
unrelated app's permissions. A locked-screen probe must also pass before claiming
that the specific installation has been verified while locked.

## Worker

Freeze `watch_model283_archive.py`, `archive_model283_opening_assets.py`, their
Python imports, and the active build's configuration in an internal runtime
directory. Preserve the policy, native input hashes, queue path, target, builder
worker cap, and publication credentials. This process never changes model
decisions, builder scheduling, or production publication.

Use `scripts/cribbage_job_queue.py` to validate and install a versioned one-shot
job. Its archive stage invokes the signed helper in `access` mode, followed by:

```text
/usr/bin/python3
/private/tmp/ARCHIVE-RUNTIME/watch_model283_archive.py
/private/tmp/ARCHIVE-RUNTIME/config.json
/Volumes/TerraMasterWDBlue/Dev/cribbage/benchmarks/model28/ace283-production-20261005
/private/tmp/ARCHIVE-RUNTIME/worker-state.json
--mount
/Volumes/TerraMasterWDBlue
```

Keep all executables, supervisor state, mutable output, and configuration on the
internal disk. The stage's completion check requires `worker-state.json` status
`complete` and its `archived` field equal to the frozen `maxChunks`. Verify that
the installed job uses one supervisor under `/private/tmp` and `KeepAlive=false`.
The job ends when the finite build target has been durably archived. Stop it with
the supervisor's `stop` command, preserving the same job specification for resume.

The worker checks once a minute. It transfers when at least 4,096 new chunks are
ready, the previous archive is 30 minutes old, available disk space is within
4 GiB of the builder's reserve, or the build reaches its target. The foreground
and background archivers share a lock; a busy lock is a normal wait. Copy,
permission, integrity, and missing-volume failures stop the job without retrying.
Inspect the failure, fix its cause, then explicitly reinstall the same job.

## Integrity and storage

Incremental passes validate the prior local and external SQLite checkpoint hashes,
the durable receipt, and exact receipt equality against the new consistent live
queue snapshot. They identify new IDs by a join, not a contiguous prefix or row
count, so out-of-order completions are retained. Previously verified immutable
shards are reused; new shards are individually copied and hash-verified. A full
audit remains available by omitting `--incremental` from the archive command.

Checkpoint files and their parent directories are flushed before archive progress
is published or any staging copy is removed. Interrupted cleanup is safe to resume:
surviving previously archived staging files require a fresh destination hash check
before release. Older local checkpoint copies are removed after replacement; their
durable external copies remain. The current checkpoint is retained for builder
verification. A damaged prior checkpoint or changed committed receipt stops the
pass, preserving staging data.

`archive-transfer-progress.json` describes the current transfer phase.
`archive-progress.json` records only a durable completed snapshot.
`worker-state.json` describes the automatic worker. None of these reports should
be interpreted as successful archival of chunks produced after that snapshot.

Deleting staging files does not guarantee an immediate increase in available disk
space: APFS/Time Machine snapshots may retain their blocks. The worker does not
delete backups or lower the builder's reserve. Thinning local Time Machine
snapshots is a separate user-approved operation.

Apple references: [security-scoped folder bookmarks](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox),
[removable-volume consent](https://developer.apple.com/documentation/bundleresources/information-property-list/nsremovablevolumesusagedescription),
and [sleep settings](https://support.apple.com/guide/mac-help/set-sleep-and-wake-settings-mchle41a6ccd/mac).
