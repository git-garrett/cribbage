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
SEAMS = ("discard", "after_discard", "after_pegging", "after_pone")


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
    metadata = {
        (row[0], row[1]): {"sourceGames": row[2], "seedClusters": row[3]}
        for row in connection.execute(
            "SELECT cohort, seam, source_games, seed_clusters FROM matrix_cohorts "
            "ORDER BY cohort, seam"
        )
    }
    cohort_expected = {
        "model9-round-robin": {"sourceGames": 30_000, "seedClusters": 5_000},
        "model911-vs-model91": {"sourceGames": 10_000, "seedClusters": 5_000},
        "pooled": {"sourceGames": 40_000, "seedClusters": 10_000},
    }
    expected = {
        (cohort, seam): values
        for cohort, values in cohort_expected.items()
        for seam in SEAMS
    }
    if metadata != expected:
        raise ValueError(f"matrix cohort metadata differs: {metadata}")
    summary: dict[str, dict] = {}
    for cohort, seam in expected:
        rows = connection.execute(
            "SELECT dealer_score, pone_score, observations, contributing_clusters, "
            "win_probability, ci95_low, ci95_high FROM matrix_cells "
            "WHERE cohort=? AND seam=? ORDER BY dealer_score,pone_score",
            (cohort, seam),
        ).fetchall()
        if len(rows) != 121 * 121:
            raise ValueError(f"{cohort}:{seam} has {len(rows)} cells")
        for dealer, pone, observations, clusters, probability, low, high in rows:
            if observations <= 0 or clusters <= 0:
                raise ValueError(f"{cohort}:{seam} is empty at {dealer}:{pone}")
            if not (0.0 <= low <= probability <= high <= 1.0):
                raise ValueError(
                    f"{cohort}:{seam} has invalid probability bounds at {dealer}:{pone}"
                )
        minimum = min(row[2] for row in rows)
        maximum = max(row[2] for row in rows)
        if maximum <= minimum:
            raise ValueError(f"{cohort}:{seam} did not gain suffix observations near the corner")
        observations = {(row[0], row[1]): row[2] for row in rows}
        if observations[(120, 120)] <= observations[(0, 0)]:
            raise ValueError(
                f"{cohort}:{seam} is not denser at 120:120 than at 0:0"
            )
        summary.setdefault(cohort, {})[seam] = {
            **expected[(cohort, seam)],
            "minimumObservations": minimum,
            "maximumObservations": maximum,
        }
    for cohort in cohort_expected:
        distinct_cells = connection.execute(
            "SELECT COUNT(*) FROM matrix_cells d JOIN matrix_cells a "
            "USING(cohort,dealer_score,pone_score) "
            "WHERE d.cohort=? AND d.seam='discard' AND a.seam='after_discard' "
            "AND (d.wins<>a.wins OR d.observations<>a.observations)",
            (cohort,),
        ).fetchone()[0]
        if distinct_cells == 0:
            raise ValueError(
                f"{cohort} after-discard seam did not remove starter/heels scoring"
            )
        summary[cohort]["after_discard"]["cellsDistinctFromDiscard"] = distinct_cells
    connection.close()
    return summary


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--trajectory-root", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    trajectory_root = (
        args.trajectory_root.resolve() if args.trajectory_root is not None else root
    )
    trajectory = {
        filename: verify_trajectory(trajectory_root / filename, expected)
        for filename, expected in TRAJECTORY_COUNTS.items()
    }
    matrix = verify_matrix(root / "board-win-matrix.sqlite")
    report_path = root / "board-win-matrix-report.json"
    if not report_path.is_file():
        raise ValueError(f"missing matrix report {report_path}")
    status = {
        "schemaVersion": 2,
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
