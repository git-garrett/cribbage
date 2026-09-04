#!/usr/bin/env python3
"""Export one verified SQLite phase-matrix cohort as the compact BWM2 asset."""

from __future__ import annotations

import argparse
import json
import sqlite3
import struct
from pathlib import Path


MAGIC = b"BWM2"
VERSION = 2
SCORE_COUNT = 121
CELL_COUNT = SCORE_COUNT * SCORE_COUNT
SEAMS = ("discard", "after_discard", "after_pegging", "after_pone")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cohort", default="pooled")
    return parser.parse_args()


def load_probabilities(
    database: Path, cohort: str
) -> tuple[list[float], int, int, dict[str, tuple[int, int]]]:
    if not database.is_file():
        raise ValueError(f"missing input database: {database}")
    connection = sqlite3.connect(f"file:{database.resolve()}?mode=ro", uri=True)
    try:
        metadata_rows = connection.execute(
            "SELECT seam, source_games, seed_clusters FROM matrix_cohorts WHERE cohort = ?",
            (cohort,),
        ).fetchall()
        metadata = {row[0]: (int(row[1]), int(row[2])) for row in metadata_rows}
        if set(metadata) != set(SEAMS):
            raise ValueError(f"missing matrix cohort: {cohort}")
        if len(set(metadata.values())) != 1:
            raise ValueError(f"inconsistent seam metadata for cohort: {cohort}")
        rows_by_seam = {
            seam: connection.execute(
                "SELECT dealer_score, pone_score, observations, win_probability "
                "FROM matrix_cells WHERE cohort = ? AND seam = ? "
                "ORDER BY dealer_score, pone_score",
                (cohort, seam),
            ).fetchall()
            for seam in SEAMS
        }
    finally:
        connection.close()

    probabilities: list[float] = []
    observation_ranges: dict[str, tuple[int, int]] = {}
    for seam in SEAMS:
        rows = rows_by_seam[seam]
        if len(rows) != CELL_COUNT:
            raise ValueError(
                f"expected {CELL_COUNT} {seam} matrix cells, found {len(rows)}"
            )
        observations_for_seam = []
        for index, (dealer_score, pone_score, observations, probability) in enumerate(rows):
            expected = divmod(index, SCORE_COUNT)
            if (dealer_score, pone_score) != expected:
                raise ValueError(
                    f"{seam} matrix shape mismatch at cell {index}: "
                    f"expected {expected}, found {(dealer_score, pone_score)}"
                )
            probability = float(probability)
            if int(observations) <= 0 or not 0.0 <= probability <= 1.0:
                raise ValueError(f"invalid {seam} cell {(dealer_score, pone_score)}")
            observations_for_seam.append(int(observations))
            probabilities.append(probability)
        observation_ranges[seam] = (
            min(observations_for_seam),
            max(observations_for_seam),
        )
    games, seed_clusters = metadata[SEAMS[0]]
    return probabilities, games, seed_clusters, observation_ranges


def main() -> None:
    args = parse_args()
    probabilities, games, seed_clusters, observation_ranges = load_probabilities(
        args.input_db, args.cohort
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    with temporary.open("wb") as output:
        output.write(MAGIC)
        output.write(struct.pack("<III", VERSION, SCORE_COUNT, len(SEAMS)))
        output.write(struct.pack(f"<{len(probabilities)}d", *probabilities))
    temporary.replace(args.output)
    print(
        json.dumps(
            {
                "cohort": args.cohort,
                "games": games,
                "seedClusters": seed_clusters,
                "seams": list(SEAMS),
                "cells": len(SEAMS) * CELL_COUNT,
                "observationRanges": observation_ranges,
                "bytes": args.output.stat().st_size,
                "output": str(args.output.resolve()),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
