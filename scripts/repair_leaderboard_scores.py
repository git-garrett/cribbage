#!/usr/bin/env python3
"""Restore leaderboard scores from authoritative completed-game upload history."""

from __future__ import annotations

import argparse
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
from typing import Any

try:
    from scripts.repair_leaderboard_timestamps import LedgerRow, ledger_text, load_tsv
except ModuleNotFoundError:
    from repair_leaderboard_timestamps import LedgerRow, ledger_text, load_tsv


@dataclass(frozen=True)
class ScoreRepairStats:
    repaired: int = 0
    unchanged: int = 0
    without_source: int = 0


def completed_score(value: Any, player: str, game_id: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or int(value) != value
    ):
        raise ValueError(f"completed game {game_id} has an invalid {player} score")
    return int(value)


def scores_from_result(result: object, game_id: str) -> tuple[int, int]:
    if not isinstance(result, dict) or not isinstance(result.get("finalScores"), dict):
        raise ValueError(f"completed game {game_id} has no final scores")
    scores = result["finalScores"]
    return (
        completed_score(scores.get("human"), "human", game_id),
        completed_score(scores.get("ai"), "AI", game_id),
    )


def parsed_json(text: object, game_id: str) -> dict[str, Any]:
    if not isinstance(text, str):
        raise ValueError(f"completed game {game_id} has no JSON payload")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError(f"completed game {game_id} has invalid JSON") from error
    if not isinstance(payload, dict):
        raise ValueError(f"completed game {game_id} has a non-object JSON payload")
    return payload


def load_authoritative_scores(sqlite_path: Path) -> dict[str, tuple[int, int]]:
    if not sqlite_path.exists():
        raise ValueError(f"SQLite database does not exist: {sqlite_path}")
    connection = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    try:
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        scores: dict[str, tuple[int, int]] = {}
        if "game_uploads" in tables:
            for game_id_value, final_result_json in connection.execute(
                "SELECT game_id, final_result_json FROM game_uploads"
            ):
                game_id = str(game_id_value or "")
                if not game_id:
                    raise ValueError("game_uploads contains an empty game ID")
                scores[game_id] = scores_from_result(
                    parsed_json(final_result_json, game_id), game_id
                )
        if "cribbage_completed_game_uploads" in tables:
            for game_id_value, payload_json in connection.execute(
                "SELECT game_id, payload_json FROM cribbage_completed_game_uploads"
            ):
                game_id = str(game_id_value or "")
                if not game_id:
                    raise ValueError(
                        "cribbage_completed_game_uploads contains an empty game ID"
                    )
                payload = parsed_json(payload_json, game_id)
                scores[game_id] = scores_from_result(
                    payload.get("finalResult"), game_id
                )
        return scores
    finally:
        connection.close()


def repair_rows(
    rows: dict[str, LedgerRow], authoritative: dict[str, tuple[int, int]]
) -> tuple[dict[str, LedgerRow], ScoreRepairStats]:
    repaired_rows: dict[str, LedgerRow] = {}
    repaired = 0
    unchanged = 0
    without_source = 0
    for game_id, row in rows.items():
        scores = authoritative.get(game_id)
        if scores is None:
            repaired_rows[game_id] = row
            without_source += 1
        elif scores != (row.human_score, row.ai_score):
            repaired_rows[game_id] = replace(
                row, human_score=scores[0], ai_score=scores[1]
            )
            repaired += 1
        else:
            repaired_rows[game_id] = row
            unchanged += 1
    return repaired_rows, ScoreRepairStats(repaired, unchanged, without_source)


def repair_ledger(
    sqlite_path: Path,
    tsv_path: Path,
    backup_dir: Path,
    *,
    dry_run: bool,
) -> dict[str, int]:
    rows = load_tsv(tsv_path)
    authoritative = load_authoritative_scores(sqlite_path)
    repaired_rows, repair_stats = repair_rows(rows, authoritative)
    stats = {
        "records": len(rows),
        "score_sources": len(authoritative),
        "repaired": repair_stats.repaired,
        "unchanged": repair_stats.unchanged,
        "without_source": repair_stats.without_source,
    }
    if dry_run or repaired_rows == rows:
        return stats

    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_dir / f"{tsv_path.name}.{timestamp}.pre-score-repair"
    shutil.copy2(tsv_path, backup)
    os.chmod(backup, 0o600)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{tsv_path.name}.", suffix=".tmp", dir=tsv_path.parent, text=True
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as temporary:
            temporary.write(ledger_text(repaired_rows))
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
        print(f"Leaderboard score repair failed: {error}", file=sys.stderr)
        raise SystemExit(1)
