#!/usr/bin/env python3
"""Verify completed trajectory databases and the derived board matrix."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


TRAJECTORY_COUNTS = {
    "legacy-forward.sqlite": 15_000,
    "legacy-reverse.sqlite": 15_000,
    "model91-left.sqlite": 5_000,
    "model911-left.sqlite": 5_000,
}


def verify_trajectory(path: Path, expected: int) -> dict:
    connection = sqlite3.connect(path)
    game = connection.execute(
        "SELECT COUNT(*), SUM(CASE WHEN reconstruction_verified=1 THEN 1 ELSE 0 END), "
        "SUM(event_count), MIN(final_left_score), MIN(final_right_score) FROM trajectory_games"
    ).fetchone()
    events = connection.execute("SELECT COUNT(*) FROM trajectory_events").fetchone()[0]
    inconsistent = connection.execute(
        "SELECT COUNT(*) FROM ("
        "SELECT g.source_game_id FROM trajectory_games g "
        "LEFT JOIN trajectory_events e USING(source_game_id) "
        "GROUP BY g.source_game_id HAVING COUNT(e.sequence) != g.event_count)"
    ).fetchone()[0]
    connection.close()
    if game[0] != expected or game[1] != expected:
        raise ValueError(f"{path} has {game[0]} games and {game[1]} verified; expected {expected}")
    if events != game[2] or inconsistent:
        raise ValueError(f"{path} has inconsistent trajectory event counts")
    if game[3] < 121 or game[4] < 121:
        raise ValueError(f"{path} contains an incomplete two-sided trajectory")
    return {"games": game[0], "events": events, "verified": game[1]}


def verify_matrix(path: Path) -> dict:
    connection = sqlite3.connect(path)
    cohorts = {
        row[0]: {"games": row[1], "seedClusters": row[2]}
        for row in connection.execute(
            "SELECT cohort, games, seed_clusters FROM matrix_cohorts ORDER BY cohort"
        )
    }
    expected = {
        "model9-round-robin": {"games": 30_000, "seedClusters": 5_000},
        "model911-vs-model91": {"games": 10_000, "seedClusters": 5_000},
        "pooled": {"games": 40_000, "seedClusters": 10_000},
    }
    if cohorts != expected:
        raise ValueError(f"matrix cohort metadata differs: {cohorts}")
    for cohort in expected:
        rows = connection.execute(
            "SELECT dealer_score, pone_score, win_probability, ci95_low, ci95_high "
            "FROM matrix_cells WHERE cohort=? ORDER BY dealer_score,pone_score",
            (cohort,),
        ).fetchall()
        if len(rows) != 121 * 121:
            raise ValueError(f"{cohort} has {len(rows)} cells")
        values = {(dealer, pone): probability for dealer, pone, probability, _, _ in rows}
        for dealer, pone, probability, low, high in rows:
            if not (0.0 <= low <= probability <= high <= 1.0):
                raise ValueError(f"{cohort} has invalid probability bounds at {dealer}:{pone}")
            if dealer < 120 and values[(dealer + 1, pone)] + 1e-15 < probability:
                raise ValueError(f"{cohort} decreases with dealer score at {dealer}:{pone}")
            if pone < 120 and values[(dealer, pone + 1)] - 1e-15 > probability:
                raise ValueError(f"{cohort} increases with pone score at {dealer}:{pone}")
    connection.close()
    return cohorts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    trajectory = {
        filename: verify_trajectory(root / filename, expected)
        for filename, expected in TRAJECTORY_COUNTS.items()
    }
    matrix = verify_matrix(root / "board-win-matrix.sqlite")
    report_path = root / "board-win-matrix-report.json"
    if not report_path.is_file():
        raise ValueError(f"missing matrix report {report_path}")
    status = {
        "schemaVersion": 1,
        "status": "complete",
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "trajectory": trajectory,
        "matrix": matrix,
        "report": str(report_path),
    }
    (root / "status.json").write_text(json.dumps(status, indent=2, sort_keys=True) + "\n")
    print(json.dumps(status, sort_keys=True))


if __name__ == "__main__":
    main()
