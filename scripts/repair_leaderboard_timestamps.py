#!/usr/bin/env python3
"""Repair leaderboard receipt timestamps from exact upload history or game IDs."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile


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


@dataclass(frozen=True)
class RepairStats:
    exact: int = 0
    approximated: int = 0
    unchanged: int = 0


def load_exact_timestamps(sqlite_path: Path) -> dict[str, str]:
    if not sqlite_path.exists():
        return {}
    connection = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    try:
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        exact: dict[str, str] = {}
        if "game_uploads" in tables:
            for game_id, final_result_json in connection.execute(
                "SELECT game_id, final_result_json FROM game_uploads"
            ):
                timestamp = timestamp_from_json(final_result_json, nested=False)
                if timestamp:
                    exact[str(game_id)] = timestamp
        if "cribbage_completed_game_uploads" in tables:
            for game_id, payload_json in connection.execute(
                "SELECT game_id, payload_json FROM cribbage_completed_game_uploads"
            ):
                timestamp = timestamp_from_json(payload_json, nested=True)
                if timestamp:
                    exact[str(game_id)] = timestamp
        return exact
    finally:
        connection.close()


def timestamp_from_json(text: object, *, nested: bool) -> str | None:
    if not isinstance(text, str):
        return None
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    final_result = payload.get("finalResult") if nested else payload
    if isinstance(final_result, dict):
        timestamp = canonical_timestamp(final_result.get("at"))
        if timestamp:
            return timestamp
    if nested and isinstance(payload.get("events"), list):
        for event in reversed(payload["events"]):
            if (
                isinstance(event, dict)
                and event.get("type") == "game"
                and event.get("action") == "end"
                and (timestamp := canonical_timestamp(event.get("at")))
            ):
                return timestamp
    return None


LEGACY_MILLIS = re.compile(r"^(\d{11,16})Z?$")


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
    rows: dict[str, LedgerRow] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != 9 or fields[8] != "v1":
            raise ValueError(f"{path}:{line_number} is not a v1 leaderboard record")
        row = LedgerRow(
            game_id=decode_field(fields[0]),
            player=decode_field(fields[1]),
            winner=decode_field(fields[2]),
            result=decode_field(fields[3]),
            human_score=int(fields[4]),
            ai_score=int(fields[5]),
            model=decode_field(fields[6]),
            ended_at=decode_field(fields[7]),
        )
        if not row.game_id:
            raise ValueError(f"{path}:{line_number} has an empty game ID")
        rows[row.game_id] = row
    return rows


def ledger_text(rows: dict[str, LedgerRow]) -> str:
    lines = []
    for row in sorted(rows.values(), key=lambda record: record.game_id):
        lines.append("\t".join((
            encode_field(row.game_id),
            encode_field(row.player),
            encode_field(row.winner),
            encode_field(row.result),
            str(row.human_score),
            str(row.ai_score),
            encode_field(row.model),
            encode_field(row.ended_at),
            "v1",
        )))
    return "\n".join(lines) + ("\n" if lines else "")


def canonical_timestamp(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    legacy = LEGACY_MILLIS.fullmatch(value)
    try:
        if legacy:
            moment = datetime.fromtimestamp(int(legacy.group(1)) / 1000, tz=timezone.utc)
        else:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if moment.tzinfo is None:
                return None
            moment = moment.astimezone(timezone.utc)
    except (OverflowError, ValueError):
        return None
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def game_start_timestamp(game_id: str) -> str | None:
    try:
        if game_id.startswith("game-"):
            millis = int(game_id.split("-", 2)[1], 36)
        elif game_id.startswith("rust-"):
            millis = int(game_id.split("-", 2)[1], 16)
        else:
            return None
        moment = datetime.fromtimestamp(millis / 1000, tz=timezone.utc)
    except (IndexError, OverflowError, ValueError):
        return None
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def repair_rows(
    rows: dict[str, LedgerRow], exact_timestamps: dict[str, str]
) -> tuple[dict[str, LedgerRow], RepairStats]:
    repaired: dict[str, LedgerRow] = {}
    exact = 0
    approximated = 0
    unchanged = 0
    for game_id, row in rows.items():
        exact_timestamp = canonical_timestamp(exact_timestamps.get(game_id))
        if exact_timestamp and exact_timestamp != row.ended_at:
            repaired[game_id] = replace(row, ended_at=exact_timestamp)
            exact += 1
        elif LEGACY_MILLIS.fullmatch(row.ended_at) and (start_time := game_start_timestamp(game_id)):
            repaired[game_id] = replace(row, ended_at=start_time)
            approximated += 1
        else:
            repaired[game_id] = row
            unchanged += 1
    return repaired, RepairStats(exact=exact, approximated=approximated, unchanged=unchanged)


def repair_ledger(
    sqlite_path: Path,
    tsv_path: Path,
    backup_dir: Path,
    *,
    dry_run: bool,
) -> dict[str, int]:
    rows = load_tsv(tsv_path)
    exact_timestamps = load_exact_timestamps(sqlite_path)
    repaired, repair_stats = repair_rows(rows, exact_timestamps)
    stats = {
        "records": len(rows),
        "exact_sources": len(exact_timestamps),
        "exact": repair_stats.exact,
        "approximated": repair_stats.approximated,
        "unchanged": repair_stats.unchanged,
    }
    if dry_run or repaired == rows:
        return stats

    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_dir / f"{tsv_path.name}.{timestamp}.pre-timestamp-repair"
    shutil.copy2(tsv_path, backup)
    os.chmod(backup, 0o600)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{tsv_path.name}.", suffix=".tmp", dir=tsv_path.parent, text=True
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(ledger_text(repaired))
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, 0o644)
        os.replace(temporary_name, tsv_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sqlite",
        type=Path,
        default=Path("/var/lib/cribbage/cribbage-server.sqlite"),
    )
    parser.add_argument(
        "--tsv",
        type=Path,
        default=Path("/var/lib/cribbage/leaderboard-games.tsv"),
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path("/var/lib/cribbage/leaderboard-backups"),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report proposed repairs without changing the ledger.",
    )
    arguments = parser.parse_args()
    stats = repair_ledger(
        arguments.sqlite,
        arguments.tsv,
        arguments.backup_dir,
        dry_run=arguments.dry_run,
    )
    print(json.dumps(stats, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"Leaderboard timestamp repair failed: {error}", file=sys.stderr)
        raise SystemExit(1)
