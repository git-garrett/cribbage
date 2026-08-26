# Leaderboard Timestamp Repair

Completed-game ingestion uses timestamps in this order:

1. A valid UTC timestamp from `finalResult.at`.
2. The game start time encoded in the game ID.
3. The server receipt time when neither earlier source is available.

The second source is explicitly an approximation. Browser IDs encode Unix
milliseconds in base 36 (`game-<millis>-...`), while Rust session IDs encode
them in hexadecimal (`rust-<millis>-...`). The encoded instant is when the
game was created, so it can precede completion by the duration of the game.
It is nevertheless a materially better historical date than the instant when
many offline games happened to be uploaded together.

The repair utility first checks both persisted upload-history tables for an
exact completion event. It only decodes a game ID for legacy millisecond
receipt-time rows that lack an exact source. Other existing timestamps remain
untouched.

Preview production changes before applying them:

```bash
python3 /opt/cribbage/scripts/repair_leaderboard_timestamps.py --dry-run
```

Apply the repair:

```bash
python3 /opt/cribbage/scripts/repair_leaderboard_timestamps.py
```

An apply run creates a mode-`0600`, timestamped backup in
`/var/lib/cribbage/leaderboard-backups` before atomically replacing the TSV.
The operation is idempotent: once timestamps are repaired, later runs report
no changes and do not create another backup.
