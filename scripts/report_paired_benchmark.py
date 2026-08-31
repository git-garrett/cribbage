#!/usr/bin/env python3
"""Create a model-neutral paired, side-swapped cribbage benchmark summary."""

from __future__ import annotations

import argparse
import json
import math
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def read_games(path: Path) -> list[dict]:
    with sqlite3.connect(path) as database:
        database.row_factory = sqlite3.Row
        rows = database.execute(
            """
            SELECT game_index, random_seed, left_engine, right_engine, winner,
                   final_left_score, final_right_score
            FROM compact_games
            WHERE included_in_tables = 1
            ORDER BY game_index
            """
        ).fetchall()
    return [dict(row) for row in rows]


def read_decision_timings(path: Path) -> dict[tuple[str, int, str], list[int]]:
    buckets: dict[tuple[str, int, str], list[int]] = {}
    with sqlite3.connect(path) as database:
        database.row_factory = sqlite3.Row
        for kind, table in [
            ("discard", "compact_discards"),
            ("pegging", "compact_peg_plays"),
        ]:
            columns = {
                row["name"]
                for row in database.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if "decision_elapsed_us" not in columns:
                continue
            timing_rows = database.execute(
                f"""
                SELECT decision.role, decision.model, decision.decision_elapsed_us
                FROM {table} AS decision
                JOIN compact_games AS game ON game.game_id = decision.game_id
                WHERE game.included_in_tables = 1
                  AND decision.model IS NOT NULL
                  AND decision.role IS NOT NULL
                  AND decision.decision_elapsed_us IS NOT NULL
                """
            )
            for row in timing_rows:
                key = (kind, int(row["role"]), row["model"])
                buckets.setdefault(key, []).append(int(row["decision_elapsed_us"]))
    return buckets


def merge_decision_timings(
    *sources: dict[tuple[str, int, str], list[int]],
) -> dict[tuple[str, int, str], list[int]]:
    merged: dict[tuple[str, int, str], list[int]] = {}
    for source in sources:
        for key, values in source.items():
            merged.setdefault(key, []).extend(values)
    return merged


def wilson95(wins: int, games: int) -> list[float]:
    z = 1.959963984540054
    probability = wins / games
    denominator = 1 + z * z / games
    center = (probability + z * z / (2 * games)) / denominator
    half_width = (
        z
        * math.sqrt(probability * (1 - probability) / games + z * z / (4 * games * games))
        / denominator
    )
    return [center - half_width, center + half_width]


def mean(values: list[int]) -> float:
    return sum(values) / len(values)


def percentile(values: list[int], quantile: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(quantile * len(ordered)) - 1))
    return ordered[index]


def summarize_timing(
    buckets: dict[tuple[str, int, str], list[int]], candidate: str, opponent: str
) -> dict:
    timing_rows = []
    for (kind, role_code, model), raw_values in sorted(buckets.items()):
        if model not in {candidate, opponent} or role_code not in (0, 1):
            continue
        values = [value for value in raw_values if value >= 0]
        if not values:
            continue
        role = "dealer" if role_code == 1 else "pone"
        timing_rows.append(
            {
                "kind": kind,
                "role": role,
                "model": model,
                "decisions": len(values),
                "avgMs": mean(values) / 1_000,
                "p50Ms": percentile(values, 0.50) / 1_000,
                "p90Ms": percentile(values, 0.90) / 1_000,
                "maxMs": max(values) / 1_000,
                "totalSeconds": sum(values) / 1_000_000,
            }
        )

    by_key = {
        (row["kind"], row["role"], row["model"]): row for row in timing_rows
    }
    comparisons = []
    for kind, role in sorted({(row["kind"], row["role"]) for row in timing_rows}):
        candidate_row = by_key.get((kind, role, candidate))
        opponent_row = by_key.get((kind, role, opponent))
        if not candidate_row or not opponent_row:
            continue
        candidate_average = candidate_row["avgMs"]
        opponent_average = opponent_row["avgMs"]
        comparisons.append(
            {
                "kind": kind,
                "role": role,
                "candidate": candidate,
                "opponent": opponent,
                "candidateAvgMs": candidate_average,
                "opponentAvgMs": opponent_average,
                "candidateMinusOpponentMs": candidate_average - opponent_average,
                "candidateToOpponentRatio": (
                    candidate_average / opponent_average if opponent_average else None
                ),
            }
        )

    return {
        "note": (
            "Rust model decision calls only; forced no-model rows are excluded. "
            "Positive candidateMinusOpponentMs means the candidate was slower."
        ),
        "rows": timing_rows,
        "comparisons": comparisons,
    }


def build_report(
    candidate_left: list[dict],
    opponent_left: list[dict],
    candidate: str,
    opponent: str,
    expected_games: int,
    timing: dict | None = None,
) -> dict:
    for label, rows, left, right in [
        ("candidate-left", candidate_left, candidate, opponent),
        ("opponent-left", opponent_left, opponent, candidate),
    ]:
        if len(rows) != expected_games:
            raise ValueError(f"{label} has {len(rows)} games; expected {expected_games}")
        for expected_index, row in enumerate(rows):
            if row["game_index"] != expected_index:
                raise ValueError(f"{label} is missing game index {expected_index}")
            if row["left_engine"] != left or row["right_engine"] != right:
                raise ValueError(f"{label} game {expected_index} has unexpected engines")
            if row["winner"] not in (0, 1):
                raise ValueError(f"{label} game {expected_index} has no decisive winner")

    candidate_left_wins = sum(row["winner"] == 0 for row in candidate_left)
    opponent_left_candidate_wins = sum(row["winner"] == 1 for row in opponent_left)
    candidate_wins = candidate_left_wins + opponent_left_candidate_wins
    total_games = expected_games * 2
    candidate_left_margins = [
        row["final_left_score"] - row["final_right_score"] for row in candidate_left
    ]
    opponent_left_candidate_margins = [
        row["final_right_score"] - row["final_left_score"] for row in opponent_left
    ]

    candidate_sweeps = 0
    opponent_sweeps = 0
    split_pairs = 0
    paired_margins: list[float] = []
    for first, second, first_margin, second_margin in zip(
        candidate_left,
        opponent_left,
        candidate_left_margins,
        opponent_left_candidate_margins,
    ):
        if first["random_seed"] != second["random_seed"]:
            raise ValueError(f"paired seed mismatch at game {first['game_index']}")
        wins = int(first["winner"] == 0) + int(second["winner"] == 1)
        if wins == 2:
            candidate_sweeps += 1
        elif wins == 0:
            opponent_sweeps += 1
        else:
            split_pairs += 1
        paired_margins.append((first_margin + second_margin) / 2)

    candidate_left_rate = candidate_left_wins / expected_games
    opponent_left_candidate_rate = opponent_left_candidate_wins / expected_games
    return {
        "status": "complete",
        "candidate": candidate,
        "opponent": opponent,
        "games": total_games,
        "gamesPerOrientation": expected_games,
        "candidateWins": candidate_wins,
        "opponentWins": total_games - candidate_wins,
        "candidateWinRate": candidate_wins / total_games,
        "candidateWilson95": wilson95(candidate_wins, total_games),
        "candidateMeanMargin": mean(candidate_left_margins + opponent_left_candidate_margins),
        "orientations": {
            "candidateLeft": {
                "candidateWins": candidate_left_wins,
                "opponentWins": expected_games - candidate_left_wins,
                "candidateWinRate": candidate_left_rate,
                "candidateMeanMargin": mean(candidate_left_margins),
            },
            "opponentLeft": {
                "candidateWins": opponent_left_candidate_wins,
                "opponentWins": expected_games - opponent_left_candidate_wins,
                "candidateWinRate": opponent_left_candidate_rate,
                "candidateMeanMargin": mean(opponent_left_candidate_margins),
            },
            "candidateWinRateDifference": candidate_left_rate - opponent_left_candidate_rate,
        },
        "pairedSeeds": {
            "pairs": expected_games,
            "candidateSweeps": candidate_sweeps,
            "opponentSweeps": opponent_sweeps,
            "splitPairs": split_pairs,
            "candidateMeanMargin": mean(paired_margins),
        },
        "timing": timing
        or {
            "note": "Decision timing was not supplied.",
            "rows": [],
            "comparisons": [],
        },
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=path.name, dir=path.parent)
    try:
        with os.fdopen(handle, "w") as temporary:
            json.dump(value, temporary, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate-left-db", type=Path, required=True)
    parser.add_argument("--opponent-left-db", type=Path, required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--opponent", required=True)
    parser.add_argument("--expected-games", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    report = build_report(
        read_games(arguments.candidate_left_db),
        read_games(arguments.opponent_left_db),
        arguments.candidate,
        arguments.opponent,
        arguments.expected_games,
        summarize_timing(
            merge_decision_timings(
                read_decision_timings(arguments.candidate_left_db),
                read_decision_timings(arguments.opponent_left_db),
            ),
            arguments.candidate,
            arguments.opponent,
        ),
    )
    atomic_json(arguments.output, report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
