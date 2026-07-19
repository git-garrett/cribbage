#!/usr/bin/env python3
"""Merge legacy SQLite game uploads into the Rust leaderboard TSV ledger.

The importer is idempotent: a game ID already in the TSV wins, so it can be
rerun safely after an interrupted deployment.  A dated backup of the existing
TSV is made before the atomic replacement.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LEGACY_LEADERBOARD_MODELS = {
    "schell_table-peg_table-13.0",
    "schell_table-peg_table-14.3",
    "schell_table-peg_table-15.0",
    "schell_table-peg_table-15.1",
    "schell_table-peg_table-15.2",
}


@dataclass(frozen=True)
class LedgerRow:
    game_id: str
    player: str
    winner: str
    result: str
    human_score: int
    ai_score: int
    model: str
    ended_at: str


def encode_field(value: str) -> str:
    return value.replace("%", "%25").replace("\t", "%09").replace("\n", "%0A").replace("\r", "%0D")


def decode_field(value: str) -> str:
    output: list[str] = []
    index = 0
    escapes = {"25": "%", "09": "\t", "0A": "\n", "0D": "\r"}
    while index < len(value):
        if value[index] != "%":
            output.append(value[index])
            index += 1
            continue
        code = value[index + 1:index + 3]
        if len(code) != 2 or code not in escapes:
            raise ValueError(f"invalid escaped ledger field: {value!r}")
        output.append(escapes[code])
        index += 3
    return "".join(output)


def load_tsv(path: Path) -> dict[str, LedgerRow]:
    if not path.exists():
        return {}
    rows: dict[str, LedgerRow] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != 9 or fields[8] != "v1":
            raise ValueError(f"{path}:{line_number} is not a v1 leaderboard record")
        try:
            row = LedgerRow(
                game_id=decode_field(fields[0]),
                player=decode_field(fields[1]),
                winner=decode_field(fields[2]) if fields[2] else "",
                result=decode_field(fields[3]),
                human_score=int(fields[4]),
                ai_score=int(fields[5]),
                model=decode_field(fields[6]),
                ended_at=decode_field(fields[7]),
            )
        except (ValueError, UnicodeError) as error:
            raise ValueError(f"{path}:{line_number}: {error}") from error
        if not row.game_id:
            raise ValueError(f"{path}:{line_number} has an empty game ID")
        rows[row.game_id] = row
    return rows


def score(value: Any, name: str, game_id: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"legacy game {game_id} has an invalid {name} score")
    integer = int(value)
    if integer != value:
        raise ValueError(f"legacy game {game_id} has a non-integer {name} score")
    return integer


def legacy_rows(sqlite_path: Path) -> dict[str, LedgerRow]:
    if not sqlite_path.exists():
        raise ValueError(f"legacy SQLite database does not exist: {sqlite_path}")
    connection = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        placeholders = ",".join("?" for _ in LEGACY_LEADERBOARD_MODELS)
        query = f"""
            SELECT game_id, tag, model, uploaded_at, final_result_json
            FROM game_uploads
            WHERE model IN ({placeholders})
            ORDER BY uploaded_at ASC
        """
        rows: dict[str, LedgerRow] = {}
        for legacy in connection.execute(query, tuple(sorted(LEGACY_LEADERBOARD_MODELS))):
            game_id = str(legacy["game_id"] or "")
            if not game_id:
                raise ValueError("legacy game_uploads row has an empty game ID")
            try:
                final = json.loads(str(legacy["final_result_json"] or "null"))
            except json.JSONDecodeError as error:
                raise ValueError(f"legacy game {game_id} has invalid final-result JSON") from error
            if not isinstance(final, dict) or not isinstance(final.get("finalScores"), dict):
                raise ValueError(f"legacy game {game_id} has no final scores")
            final_scores = final["finalScores"]
            tag = legacy["tag"] if isinstance(legacy["tag"], str) else ""
            player = tag.strip()[:40] or "Anonymous"
            winner = final.get("winner") if isinstance(final.get("winner"), str) else ""
            result = final.get("result") if isinstance(final.get("result"), str) else "regular"
            ended_at = final.get("at") if isinstance(final.get("at"), str) else str(legacy["uploaded_at"])
            rows[game_id] = LedgerRow(
                game_id=game_id,
                player=player,
                winner=winner,
                result=result,
                human_score=score(final_scores.get("human"), "human", game_id),
                ai_score=score(final_scores.get("ai"), "AI", game_id),
                model=str(legacy["model"]),
                ended_at=ended_at,
            )
        return rows
    finally:
        connection.close()


def ledger_text(rows: dict[str, LedgerRow]) -> str:
    lines = []
    for row in sorted(rows.values(), key=lambda record: record.game_id):
        lines.append("\t".join((
            encode_field(row.game_id), encode_field(row.player), encode_field(row.winner) if row.winner else "",
            encode_field(row.result), str(row.human_score), str(row.ai_score), encode_field(row.model),
            encode_field(row.ended_at), "v1",
        )))
    return "\n".join(lines) + ("\n" if lines else "")


def migrate(sqlite_path: Path, tsv_path: Path, backup_dir: Path, dry_run: bool) -> dict[str, int]:
    current = load_tsv(tsv_path)
    legacy = legacy_rows(sqlite_path)
    additions = {game_id: row for game_id, row in legacy.items() if game_id not in current}
    merged = {**legacy, **current}
    stats = {
        "legacy_records": len(legacy),
        "existing_records": len(current),
        "already_present": len(legacy) - len(additions),
        "added_records": len(additions),
        "merged_records": len(merged),
    }
    if dry_run:
        return stats

    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    if tsv_path.exists():
        backup = backup_dir / f"{tsv_path.name}.{timestamp}.pre-legacy-import"
        shutil.copy2(tsv_path, backup)
        os.chmod(backup, 0o600)
    tsv_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{tsv_path.name}.", suffix=".tmp", dir=tsv_path.parent, text=True)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(ledger_text(merged))
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, 0o644)
        os.replace(temporary_name, tsv_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return stats


def self_test() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        database = root / "legacy.sqlite"
        tsv = root / "leaderboard-games.tsv"
        connection = sqlite3.connect(database)
        connection.execute("CREATE TABLE game_uploads (game_id TEXT PRIMARY KEY, tag TEXT, model TEXT, uploaded_at TEXT, final_result_json TEXT)")
        def add(game_id: str, tag: str, model: str, winner: str, human: int, ai: int) -> None:
            result = {"winner": winner, "result": "regular", "at": "2026-07-18T00:00:00.000Z", "finalScores": {"human": human, "ai": ai}}
            connection.execute("INSERT INTO game_uploads VALUES (?, ?, ?, ?, ?)", (game_id, tag, model, "2026-07-18T00:00:01.000Z", json.dumps(result)))
        add("existing", "Legacy Garrett", "schell_table-peg_table-13.0", "human", 121, 110)
        add("recovered", "Kurtis", "schell_table-peg_table-15.2", "ai", 105, 121)
        add("ignored", "Future", "schell_table-peg_table-16.0", "human", 121, 100)
        connection.commit()
        connection.close()
        tsv.write_text(ledger_text({"existing": LedgerRow("existing", "Current Garrett", "human", "skunk", 121, 90, "schell_table-peg_table-13.0", "now")}), encoding="utf-8")
        preview = migrate(database, tsv, root / "backups", dry_run=True)
        assert preview == {"legacy_records": 2, "existing_records": 1, "already_present": 1, "added_records": 1, "merged_records": 2}
        applied = migrate(database, tsv, root / "backups", dry_run=False)
        assert applied == preview
        merged = load_tsv(tsv)
        assert set(merged) == {"existing", "recovered"}
        assert merged["existing"].player == "Current Garrett"
        assert merged["recovered"].player == "Kurtis"
        assert len(list((root / "backups").iterdir())) == 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, default=Path("/var/lib/cribbage/cribbage-server.sqlite"))
    parser.add_argument("--tsv", type=Path, default=Path("/var/lib/cribbage/leaderboard-games.tsv"))
    parser.add_argument("--backup-dir", type=Path, default=Path("/var/lib/cribbage/leaderboard-backups"))
    parser.add_argument("--dry-run", action="store_true", help="Validate and report without changing the TSV ledger.")
    parser.add_argument("--self-test", action="store_true", help="Run an isolated importer regression test.")
    arguments = parser.parse_args()
    if arguments.self_test:
        self_test()
        print("legacy leaderboard importer self-test passed")
        return 0
    stats = migrate(arguments.sqlite, arguments.tsv, arguments.backup_dir, arguments.dry_run)
    print(json.dumps(stats, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Leaderboard migration failed: {error}", file=sys.stderr)
        raise SystemExit(1)
