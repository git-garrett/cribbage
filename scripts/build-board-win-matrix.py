#!/usr/bin/env python3
"""Build phase-seam board matrices from completed two-sided trajectories."""

from __future__ import annotations

import argparse
import bisect
import json
import math
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SCORE_COUNT = 121
DIFF_COUNT = SCORE_COUNT + 1
SEAMS = ("discard", "after_discard", "after_pegging", "after_pone")


@dataclass(frozen=True)
class InputPair:
    cohort: str
    source_db: Path
    trajectory_db: Path


@dataclass(frozen=True)
class GameRef:
    cohort: str
    source_db: Path
    trajectory_db: Path
    game_id: str
    random_seed: str


@dataclass(frozen=True)
class SeamSample:
    minimum_dealer_score: int
    minimum_pone_score: int
    dealer_win_cutoffs: list[int]


class MatrixAggregate:
    def __init__(self, name: str, seam: str) -> None:
        self.name = name
        self.seam = seam
        self.source_games = 0
        self.clusters = 0
        self.observations = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]
        self.wins = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]
        self.contributing_clusters = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]
        self.sum_s2 = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]
        self.sum_ms = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]
        self.sum_m2 = [[0] * SCORE_COUNT for _ in range(SCORE_COUNT)]

    def cells(self) -> list[tuple[int, int, int, int, int, float, float, float, float]]:
        if self.source_games == 0 or self.clusters == 0:
            raise ValueError(f"aggregate {self.name}:{self.seam} is empty")
        output = []
        for dealer_score in range(SCORE_COUNT):
            for pone_score in range(SCORE_COUNT):
                observations = self.observations[dealer_score][pone_score]
                wins = self.wins[dealer_score][pone_score]
                clusters = self.contributing_clusters[dealer_score][pone_score]
                if observations == 0:
                    raise ValueError(
                        f"aggregate {self.name}:{self.seam} has no observations at "
                        f"{dealer_score}:{pone_score}"
                    )
                probability = wins / observations
                residual_sum = (
                    self.sum_s2[dealer_score][pone_score]
                    - (2.0 * probability * self.sum_ms[dealer_score][pone_score])
                    + (probability * probability * self.sum_m2[dealer_score][pone_score])
                )
                correction = clusters / (clusters - 1) if clusters > 1 else 0.0
                variance = correction * max(0.0, residual_sum) / (observations * observations)
                standard_error = math.sqrt(variance)
                low = max(0.0, probability - (1.96 * standard_error))
                high = min(1.0, probability + (1.96 * standard_error))
                output.append(
                    (
                        dealer_score,
                        pone_score,
                        wins,
                        observations,
                        clusters,
                        probability,
                        standard_error,
                        low,
                        high,
                    )
                )
        return output


def add_cluster_to(
    aggregates: list[MatrixAggregate],
    cluster_observations: list[list[int]],
    cluster_wins: list[list[int]],
    source_games: int,
) -> None:
    for aggregate in aggregates:
        aggregate.source_games += source_games
        aggregate.clusters += 1
    for dealer_score in range(SCORE_COUNT):
        for pone_score in range(SCORE_COUNT):
            observations = cluster_observations[dealer_score][pone_score]
            if observations == 0:
                continue
            wins = cluster_wins[dealer_score][pone_score]
            for aggregate in aggregates:
                aggregate.observations[dealer_score][pone_score] += observations
                aggregate.wins[dealer_score][pone_score] += wins
                aggregate.contributing_clusters[dealer_score][pone_score] += 1
                aggregate.sum_s2[dealer_score][pone_score] += wins * wins
                aggregate.sum_ms[dealer_score][pone_score] += observations * wins
                aggregate.sum_m2[dealer_score][pone_score] += observations * observations


def cluster_matrices(samples: list[SeamSample]) -> tuple[list[list[int]], list[list[int]]]:
    if not samples:
        raise ValueError("cannot aggregate an empty seam cluster")
    observation_diff = [[0] * DIFF_COUNT for _ in range(SCORE_COUNT)]
    win_diff = [[0] * DIFF_COUNT for _ in range(SCORE_COUNT)]
    for sample in samples:
        for dealer_score in range(sample.minimum_dealer_score, SCORE_COUNT):
            add_range(
                observation_diff[dealer_score],
                sample.minimum_pone_score,
                SCORE_COUNT - 1,
                1,
            )
            cutoff = sample.dealer_win_cutoffs[dealer_score]
            if cutoff >= sample.minimum_pone_score:
                add_range(
                    win_diff[dealer_score],
                    sample.minimum_pone_score,
                    cutoff,
                    1,
                )
    observations = [prefix_values(row) for row in observation_diff]
    wins = [prefix_values(row) for row in win_diff]
    return observations, wins


def add_range(difference: list[int], start: int, end: int, value: int) -> None:
    if start > end:
        return
    difference[start] += value
    difference[end + 1] -= value


def prefix_values(difference: list[int]) -> list[int]:
    values = []
    current = 0
    for value in difference[:SCORE_COUNT]:
        current += value
        values.append(current)
    return values


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--input",
        action="append",
        required=True,
        metavar="COHORT,SOURCE_DB,TRAJECTORY_DB",
    )
    parser.add_argument("--out-db", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--allow-partial", action="store_true")
    return parser.parse_args()


def parse_inputs(values: Iterable[str]) -> list[InputPair]:
    result = []
    for value in values:
        parts = value.split(",", 2)
        if len(parts) != 3:
            raise ValueError(f"invalid --input {value!r}")
        cohort, source_db, trajectory_db = parts
        pair = InputPair(cohort, Path(source_db).resolve(), Path(trajectory_db).resolve())
        if not pair.source_db.is_file():
            raise ValueError(f"missing source DB {pair.source_db}")
        if not pair.trajectory_db.is_file():
            raise ValueError(f"missing trajectory DB {pair.trajectory_db}")
        result.append(pair)
    return result


def load_games(
    inputs: list[InputPair], allow_partial: bool = False
) -> dict[tuple[str, str], list[GameRef]]:
    clusters: dict[tuple[str, str], list[GameRef]] = defaultdict(list)
    for pair in inputs:
        trajectory = sqlite3.connect(pair.trajectory_db)
        source = sqlite3.connect(pair.source_db)
        trajectory_rows = trajectory.execute(
            "SELECT source_game_id, random_seed FROM trajectory_games "
            "WHERE reconstruction_verified = 1 ORDER BY source_game_id"
        ).fetchall()
        expected = source.execute(
            "SELECT COUNT(*) FROM compact_games "
            "WHERE reproducible = 1 AND included_in_tables = 1"
        ).fetchone()[0]
        source.close()
        trajectory.close()
        if not allow_partial and len(trajectory_rows) != expected:
            raise ValueError(
                f"{pair.trajectory_db} has {len(trajectory_rows)} completed trajectories; expected {expected}"
            )
        for game_id, random_seed in trajectory_rows:
            clusters[(pair.cohort, str(random_seed))].append(
                GameRef(
                    cohort=pair.cohort,
                    source_db=pair.source_db,
                    trajectory_db=pair.trajectory_db,
                    game_id=game_id,
                    random_seed=str(random_seed),
                )
            )
    return clusters


class ConnectionCache:
    def __init__(self) -> None:
        self.connections: dict[Path, sqlite3.Connection] = {}

    def get(self, path: Path) -> sqlite3.Connection:
        if path not in self.connections:
            connection = sqlite3.connect(path)
            connection.row_factory = sqlite3.Row
            self.connections[path] = connection
        return self.connections[path]

    def close(self) -> None:
        for connection in self.connections.values():
            connection.close()


def game_samples(
    game: GameRef, connections: ConnectionCache
) -> dict[str, list[SeamSample]]:
    source = connections.get(game.source_db)
    trajectory = connections.get(game.trajectory_db)
    terminal = trajectory.execute(
        "SELECT terminal_hand_number, terminal_start_left_score, terminal_start_right_score, "
        "final_left_score, final_right_score FROM trajectory_games WHERE source_game_id = ?",
        (game.game_id,),
    ).fetchone()
    if terminal is None:
        raise ValueError(f"missing trajectory metadata for {game.game_id}")
    terminal_hand = int(terminal["terminal_hand_number"])
    events: list[tuple[int, int]] = []
    seam_offsets: dict[str, list[tuple[int, int]]] = {seam: [] for seam in SEAMS}
    left_score = 0
    right_score = 0
    hands = source.execute(
        "SELECT hand_number, dealer, pone, start_left_score, start_right_score, cut_card, "
        "left_pegging_points, right_pegging_points, left_hand_points, right_hand_points, crib_points "
        "FROM compact_hands WHERE game_id = ? AND hand_number < ? ORDER BY hand_number",
        (game.game_id, terminal_hand),
    ).fetchall()
    for hand in hands:
        if left_score != hand["start_left_score"] or right_score != hand["start_right_score"]:
            raise ValueError(f"{game.game_id} prefix score diverged at hand {hand['hand_number']}")
        dealer = int(hand["dealer"])
        pone = int(hand["pone"])
        seam_offsets["discard"].append((len(events), dealer))
        accounted = [0, 0]
        if int(hand["cut_card"]) // 4 == 10:
            append_event(events, dealer, 2)
            accounted[dealer] += 2
            if dealer == 0:
                left_score += 2
            else:
                right_score += 2
        seam_offsets["after_discard"].append((len(events), dealer))
        peg_rows = source.execute(
            "SELECT left_score, right_score FROM compact_peg_plays "
            "WHERE game_id = ? AND hand_number = ? ORDER BY sequence",
            (game.game_id, hand["hand_number"]),
        ).fetchall()
        for peg in peg_rows:
            next_left = int(peg["left_score"])
            next_right = int(peg["right_score"])
            left_delta = next_left - left_score
            right_delta = next_right - right_score
            if left_delta < 0 or right_delta < 0:
                raise ValueError(f"{game.game_id} has a backward pegging score")
            append_event(events, 0, left_delta)
            append_event(events, 1, right_delta)
            accounted[0] += left_delta
            accounted[1] += right_delta
            left_score = next_left
            right_score = next_right
        pegging_totals = [int(hand["left_pegging_points"]), int(hand["right_pegging_points"])]
        for player in (0, 1):
            remainder = pegging_totals[player] - accounted[player]
            if remainder < 0:
                raise ValueError(f"{game.game_id} over-accounted pegging in hand {hand['hand_number']}")
            append_event(events, player, remainder)
            if player == 0:
                left_score += remainder
            else:
                right_score += remainder
        seam_offsets["after_pegging"].append((len(events), dealer))
        hand_points = [int(hand["left_hand_points"]), int(hand["right_hand_points"])]
        append_event(events, pone, hand_points[pone])
        if pone == 0:
            left_score += hand_points[pone]
        else:
            right_score += hand_points[pone]
        seam_offsets["after_pone"].append((len(events), dealer))
        append_event(events, dealer, hand_points[dealer])
        if dealer == 0:
            left_score += hand_points[dealer]
        else:
            right_score += hand_points[dealer]
        crib_points = int(hand["crib_points"])
        append_event(events, dealer, crib_points)
        if dealer == 0:
            left_score += crib_points
        else:
            right_score += crib_points

    if left_score != int(terminal["terminal_start_left_score"]) or right_score != int(
        terminal["terminal_start_right_score"]
    ):
        raise ValueError(f"{game.game_id} prefix does not reach its terminal-hand start")
    extension = trajectory.execute(
        "SELECT hand_number, dealer, player, phase, points FROM trajectory_events "
        "WHERE source_game_id = ? ORDER BY sequence",
        (game.game_id,),
    ).fetchall()
    extension_hands: dict[int, list[sqlite3.Row]] = {}
    for event in extension:
        extension_hands.setdefault(int(event["hand_number"]), []).append(event)
    for hand_number, hand_events in extension_hands.items():
        dealer = int(hand_events[0]["dealer"])
        seam_offsets["discard"].append((len(events), dealer))
        for event in hand_events:
            if event["phase"] != "heels":
                continue
            left_score, right_score = append_tracked_event(
                events, left_score, right_score, event
            )
        seam_offsets["after_discard"].append((len(events), dealer))
        for event in hand_events:
            if event["phase"] != "pegging":
                continue
            left_score, right_score = append_tracked_event(
                events, left_score, right_score, event
            )
        seam_offsets["after_pegging"].append((len(events), dealer))
        for event in hand_events:
            if event["phase"] != "pone_hand":
                continue
            left_score, right_score = append_tracked_event(
                events, left_score, right_score, event
            )
        seam_offsets["after_pone"].append((len(events), dealer))
        for event in hand_events:
            if event["phase"] not in ("dealer_hand", "crib"):
                continue
            left_score, right_score = append_tracked_event(
                events, left_score, right_score, event
            )
        known_phases = {"heels", "pegging", "pone_hand", "dealer_hand", "crib"}
        unknown = {str(event["phase"]) for event in hand_events} - known_phases
        if unknown:
            raise ValueError(
                f"{game.game_id} hand {hand_number} has unknown phases {sorted(unknown)}"
            )
    if left_score != int(terminal["final_left_score"]) or right_score != int(
        terminal["final_right_score"]
    ):
        raise ValueError(f"{game.game_id} extension score total is inconsistent")
    if left_score < 121 or right_score < 121:
        raise ValueError(f"{game.game_id} is not a completed two-sided trajectory")

    seam_counts = {seam: len(offsets) for seam, offsets in seam_offsets.items()}
    if len(set(seam_counts.values())) != 1:
        raise ValueError(f"{game.game_id} has inconsistent seam counts: {seam_counts}")

    return {
        seam: [seam_sample(events, offset, dealer) for offset, dealer in offsets]
        for seam, offsets in seam_offsets.items()
    }


def append_tracked_event(
    events: list[tuple[int, int]],
    left_score: int,
    right_score: int,
    event: sqlite3.Row,
) -> tuple[int, int]:
    player = int(event["player"])
    points = int(event["points"])
    append_event(events, player, points)
    if player == 0:
        left_score += points
    else:
        right_score += points
    return left_score, right_score


def seam_sample(events: list[tuple[int, int]], offset: int, dealer: int) -> SeamSample:
    dealer_cumulative: list[int] = []
    pone_cumulative: list[int] = []
    dealer_gain = 0
    pone_gain = 0
    for player, points in events[offset:]:
        if player == dealer:
            dealer_gain += points
        else:
            pone_gain += points
        dealer_cumulative.append(dealer_gain)
        pone_cumulative.append(pone_gain)
    minimum_dealer_score = max(0, 121 - dealer_gain)
    minimum_pone_score = max(0, 121 - pone_gain)
    dealer_crossings = [
        bisect.bisect_left(dealer_cumulative, required)
        for required in range(1, min(dealer_gain, 121) + 1)
    ]
    pone_crossings = [
        bisect.bisect_left(pone_cumulative, required)
        for required in range(1, min(pone_gain, 121) + 1)
    ]
    cutoffs = [-1] * SCORE_COUNT
    for dealer_score in range(minimum_dealer_score, SCORE_COUNT):
        required = 121 - dealer_score
        dealer_event = dealer_crossings[required - 1]
        first_slower_pone_requirement = bisect.bisect_right(pone_crossings, dealer_event)
        cutoffs[dealer_score] = 120 - first_slower_pone_requirement
    return SeamSample(minimum_dealer_score, minimum_pone_score, cutoffs)


def append_event(events: list[tuple[int, int]], player: int, points: int) -> None:
    if points > 0:
        events.append((player, points))


def initialize_output(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.executescript(
        """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
DROP TABLE IF EXISTS matrix_cells;
DROP TABLE IF EXISTS matrix_cohorts;
CREATE TABLE matrix_cohorts (
  cohort TEXT NOT NULL,
  seam TEXT NOT NULL,
  source_games INTEGER NOT NULL,
  seed_clusters INTEGER NOT NULL,
  PRIMARY KEY (cohort, seam)
);
CREATE TABLE matrix_cells (
  cohort TEXT NOT NULL,
  seam TEXT NOT NULL,
  dealer_score INTEGER NOT NULL,
  pone_score INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  observations INTEGER NOT NULL,
  contributing_clusters INTEGER NOT NULL,
  win_probability REAL NOT NULL,
  cluster_standard_error REAL NOT NULL,
  ci95_low REAL NOT NULL,
  ci95_high REAL NOT NULL,
  PRIMARY KEY (cohort, seam, dealer_score, pone_score)
);
"""
    )
    return connection


def write_aggregate(connection: sqlite3.Connection, aggregate: MatrixAggregate) -> None:
    connection.execute(
        "INSERT INTO matrix_cohorts (cohort, seam, source_games, seed_clusters) "
        "VALUES (?, ?, ?, ?)",
        (aggregate.name, aggregate.seam, aggregate.source_games, aggregate.clusters),
    )
    connection.executemany(
        "INSERT INTO matrix_cells (cohort, seam, dealer_score, pone_score, wins, "
        "observations, contributing_clusters, win_probability, cluster_standard_error, "
        "ci95_low, ci95_high) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ((aggregate.name, aggregate.seam, *cell) for cell in aggregate.cells()),
    )


def summarize(
    aggregates: dict[tuple[str, str], MatrixAggregate], output: sqlite3.Connection
) -> dict:
    report = {
        "schemaVersion": 2,
        "matrixShape": [len(SEAMS), SCORE_COUNT, SCORE_COUNT],
        "seams": list(SEAMS),
        "perspective": "player dealing in the hand containing the seam",
        "population": "every eligible phase-seam suffix transposed to every finishable score cell",
        "confidence": "pointwise normal 95% interval with original random seed as cluster",
        "cohorts": {},
    }
    for (name, seam), aggregate in aggregates.items():
        row = output.execute(
            "SELECT MAX((ci95_high-ci95_low)/2), "
            "AVG(CASE WHEN win_probability BETWEEN 0.4 AND 0.6 THEN (ci95_high-ci95_low)/2 END), "
            "SUM(CASE WHEN (ci95_high-ci95_low)/2 <= 0.01 THEN 1 ELSE 0 END), "
            "MIN(observations), MAX(observations) "
            "FROM matrix_cells WHERE cohort = ? AND seam = ?",
            (name, seam),
        ).fetchone()
        cohort_report = report["cohorts"].setdefault(name, {"seams": {}})
        cohort_report["sourceGames"] = aggregate.source_games
        cohort_report["seedClusters"] = aggregate.clusters
        cohort_report["seams"][seam] = {
            "minimumObservations": row[3],
            "maximumObservations": row[4],
            "maximumCi95HalfWidth": row[0],
            "averageTippingBandCi95HalfWidth": row[1],
            "cellsAtOrBelowOnePointHalfWidth": row[2],
        }
    cohort_names = list(dict.fromkeys(name for name, _seam in aggregates if name != "pooled"))
    if len(cohort_names) == 2:
        left, right = cohort_names
        report["cohortComparison"] = {"left": left, "right": right, "seams": {}}
        for seam in SEAMS:
            comparison = output.execute(
                "SELECT MAX(ABS(a.win_probability-b.win_probability)), "
                "AVG(ABS(a.win_probability-b.win_probability)), "
                "AVG(CASE WHEN p.win_probability BETWEEN 0.4 AND 0.6 "
                "THEN ABS(a.win_probability-b.win_probability) END), "
                "SUM(CASE WHEN ABS(a.win_probability-b.win_probability) > 0.01 THEN 1 ELSE 0 END) "
                "FROM matrix_cells a JOIN matrix_cells b USING(seam,dealer_score,pone_score) "
                "JOIN matrix_cells p USING(seam,dealer_score,pone_score) "
                "WHERE a.cohort=? AND b.cohort=? AND p.cohort='pooled' AND a.seam=?",
                (left, right, seam),
            ).fetchone()
            report["cohortComparison"]["seams"][seam] = {
                "maximumAbsoluteDifference": comparison[0],
                "meanAbsoluteDifference": comparison[1],
                "meanAbsoluteDifferenceInPooledFortyToSixtyBand": comparison[2],
                "cellsDifferingByMoreThanOnePoint": comparison[3],
            }
    return report


def main() -> None:
    args = parse_args()
    inputs = parse_inputs(args.input)
    clusters = load_games(inputs, args.allow_partial)
    cohort_names = list(dict.fromkeys(pair.cohort for pair in inputs))
    aggregates = {
        (name, seam): MatrixAggregate(name, seam)
        for name in [*cohort_names, "pooled"]
        for seam in SEAMS
    }
    connections = ConnectionCache()
    try:
        total = len(clusters)
        for index, ((cohort, _seed), games) in enumerate(sorted(clusters.items()), start=1):
            samples_by_seam = {seam: [] for seam in SEAMS}
            for game in games:
                game_samples_by_seam = game_samples(game, connections)
                for seam in SEAMS:
                    samples_by_seam[seam].extend(game_samples_by_seam[seam])
            for seam in SEAMS:
                observations, wins = cluster_matrices(samples_by_seam[seam])
                add_cluster_to(
                    [aggregates[(cohort, seam)], aggregates[("pooled", seam)]],
                    observations,
                    wins,
                    len(games),
                )
            if index % 100 == 0 or index == total:
                print(f"processed {index}/{total} seed clusters", flush=True)
    finally:
        connections.close()

    output = initialize_output(args.out_db.resolve())
    try:
        with output:
            for aggregate in aggregates.values():
                write_aggregate(output, aggregate)
        report = summarize(aggregates, output)
    finally:
        output.close()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
