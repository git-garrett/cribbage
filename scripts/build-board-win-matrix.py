#!/usr/bin/env python3
"""Build dealer-at-next-hand win matrices from completed scoring trajectories."""

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


class MatrixAggregate:
    def __init__(self, name: str) -> None:
        self.name = name
        self.games = 0
        self.clusters = 0
        self.sum_cluster_size_squared = 0
        self.wins_diff = [[0] * DIFF_COUNT for _ in range(SCORE_COUNT)]
        self.sum_s2_diff = [[0] * DIFF_COUNT for _ in range(SCORE_COUNT)]
        self.sum_ms_diff = [[0] * DIFF_COUNT for _ in range(SCORE_COUNT)]

    def add_cluster(self, cutoffs_by_game: list[list[int]]) -> None:
        cluster_size = len(cutoffs_by_game)
        if cluster_size == 0:
            return
        self.games += cluster_size
        self.clusters += 1
        self.sum_cluster_size_squared += cluster_size * cluster_size
        for dealer_score in range(SCORE_COUNT):
            cutoffs = sorted(
                cutoff[dealer_score]
                for cutoff in cutoffs_by_game
                if cutoff[dealer_score] >= 0
            )
            for cutoff in cutoffs:
                add_range(self.wins_diff[dealer_score], 0, cutoff, 1)
            if not cutoffs:
                continue
            active = len(cutoffs)
            start = 0
            index = 0
            while index < len(cutoffs):
                cutoff = cutoffs[index]
                add_range(self.sum_s2_diff[dealer_score], start, cutoff, active * active)
                add_range(
                    self.sum_ms_diff[dealer_score],
                    start,
                    cutoff,
                    cluster_size * active,
                )
                while index < len(cutoffs) and cutoffs[index] == cutoff:
                    index += 1
                    active -= 1
                start = cutoff + 1

    def cells(self) -> list[tuple[int, int, int, int, float, float, float, float]]:
        if self.games == 0 or self.clusters == 0:
            raise ValueError(f"aggregate {self.name} is empty")
        output = []
        correction = self.clusters / (self.clusters - 1) if self.clusters > 1 else 0.0
        for dealer_score in range(SCORE_COUNT):
            wins = prefix_values(self.wins_diff[dealer_score])
            sum_s2 = prefix_values(self.sum_s2_diff[dealer_score])
            sum_ms = prefix_values(self.sum_ms_diff[dealer_score])
            for pone_score in range(SCORE_COUNT):
                probability = wins[pone_score] / self.games
                residual_sum = (
                    sum_s2[pone_score]
                    - (2.0 * probability * sum_ms[pone_score])
                    + (probability * probability * self.sum_cluster_size_squared)
                )
                variance = correction * max(0.0, residual_sum) / (self.games * self.games)
                standard_error = math.sqrt(variance)
                low = max(0.0, probability - (1.96 * standard_error))
                high = min(1.0, probability + (1.96 * standard_error))
                output.append(
                    (
                        dealer_score,
                        pone_score,
                        wins[pone_score],
                        self.games,
                        probability,
                        standard_error,
                        low,
                        high,
                    )
                )
        return output


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


def game_cutoffs(game: GameRef, connections: ConnectionCache) -> list[int]:
    source = connections.get(game.source_db)
    trajectory = connections.get(game.trajectory_db)
    terminal = trajectory.execute(
        "SELECT terminal_hand_number, terminal_start_left_score, terminal_start_right_score, "
        "final_left_score, final_right_score FROM trajectory_games WHERE source_game_id = ?",
        (game.game_id,),
    ).fetchone()
    if terminal is None:
        raise ValueError(f"missing trajectory metadata for {game.game_id}")
    first_dealer_row = source.execute(
        "SELECT dealer FROM compact_hands WHERE game_id = ? ORDER BY hand_number LIMIT 1",
        (game.game_id,),
    ).fetchone()
    if first_dealer_row is None:
        raise ValueError(f"missing first hand for {game.game_id}")
    first_dealer = int(first_dealer_row[0])
    terminal_hand = int(terminal["terminal_hand_number"])
    events: list[tuple[int, int]] = []
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
        accounted = [0, 0]
        if int(hand["cut_card"]) // 4 == 10:
            append_event(events, dealer, 2)
            accounted[dealer] += 2
            if dealer == 0:
                left_score += 2
            else:
                right_score += 2
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
        hand_points = [int(hand["left_hand_points"]), int(hand["right_hand_points"])]
        append_event(events, pone, hand_points[pone])
        if pone == 0:
            left_score += hand_points[pone]
        else:
            right_score += hand_points[pone]
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
        "SELECT player, points FROM trajectory_events WHERE source_game_id = ? ORDER BY sequence",
        (game.game_id,),
    ).fetchall()
    for event in extension:
        player = int(event["player"])
        points = int(event["points"])
        append_event(events, player, points)
        if player == 0:
            left_score += points
        else:
            right_score += points
    if left_score != int(terminal["final_left_score"]) or right_score != int(
        terminal["final_right_score"]
    ):
        raise ValueError(f"{game.game_id} extension score total is inconsistent")
    if left_score < 121 or right_score < 121:
        raise ValueError(f"{game.game_id} is not a completed two-sided trajectory")

    dealer_cumulative = []
    pone_cumulative = []
    dealer_gain = 0
    pone_gain = 0
    for player, points in events:
        if player == first_dealer:
            dealer_gain += points
        else:
            pone_gain += points
        dealer_cumulative.append(dealer_gain)
        pone_cumulative.append(pone_gain)
    dealer_crossings = [
        bisect.bisect_left(dealer_cumulative, required) for required in range(1, 122)
    ]
    pone_crossings = [
        bisect.bisect_left(pone_cumulative, required) for required in range(1, 122)
    ]
    if dealer_crossings[-1] == len(events) or pone_crossings[-1] == len(events):
        raise ValueError(f"{game.game_id} cumulative gains do not both reach 121")
    cutoffs = []
    for dealer_score in range(SCORE_COUNT):
        required = 121 - dealer_score
        dealer_event = dealer_crossings[required - 1]
        first_slower_pone_requirement = bisect.bisect_right(pone_crossings, dealer_event)
        cutoffs.append(120 - first_slower_pone_requirement)
    return cutoffs


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
  cohort TEXT PRIMARY KEY,
  games INTEGER NOT NULL,
  seed_clusters INTEGER NOT NULL
);
CREATE TABLE matrix_cells (
  cohort TEXT NOT NULL,
  dealer_score INTEGER NOT NULL,
  pone_score INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  games INTEGER NOT NULL,
  win_probability REAL NOT NULL,
  cluster_standard_error REAL NOT NULL,
  ci95_low REAL NOT NULL,
  ci95_high REAL NOT NULL,
  PRIMARY KEY (cohort, dealer_score, pone_score)
);
"""
    )
    return connection


def write_aggregate(connection: sqlite3.Connection, aggregate: MatrixAggregate) -> None:
    connection.execute(
        "INSERT INTO matrix_cohorts (cohort, games, seed_clusters) VALUES (?, ?, ?)",
        (aggregate.name, aggregate.games, aggregate.clusters),
    )
    connection.executemany(
        "INSERT INTO matrix_cells (cohort, dealer_score, pone_score, wins, games, "
        "win_probability, cluster_standard_error, ci95_low, ci95_high) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ((aggregate.name, *cell) for cell in aggregate.cells()),
    )


def summarize(aggregates: dict[str, MatrixAggregate], output: sqlite3.Connection) -> dict:
    report = {
        "schemaVersion": 1,
        "matrixShape": [SCORE_COUNT, SCORE_COUNT],
        "perspective": "player dealing the next hand",
        "confidence": "pointwise normal 95% interval with original random seed as cluster",
        "cohorts": {},
    }
    for name, aggregate in aggregates.items():
        row = output.execute(
            "SELECT MAX((ci95_high-ci95_low)/2), "
            "AVG(CASE WHEN win_probability BETWEEN 0.4 AND 0.6 THEN (ci95_high-ci95_low)/2 END), "
            "SUM(CASE WHEN (ci95_high-ci95_low)/2 <= 0.01 THEN 1 ELSE 0 END) "
            "FROM matrix_cells WHERE cohort = ?",
            (name,),
        ).fetchone()
        report["cohorts"][name] = {
            "games": aggregate.games,
            "seedClusters": aggregate.clusters,
            "maximumCi95HalfWidth": row[0],
            "averageTippingBandCi95HalfWidth": row[1],
            "cellsAtOrBelowOnePointHalfWidth": row[2],
        }
    cohort_names = [name for name in aggregates if name != "pooled"]
    if len(cohort_names) == 2:
        left, right = cohort_names
        comparison = output.execute(
            "SELECT MAX(ABS(a.win_probability-b.win_probability)), "
            "AVG(ABS(a.win_probability-b.win_probability)), "
            "AVG(CASE WHEN p.win_probability BETWEEN 0.4 AND 0.6 "
            "THEN ABS(a.win_probability-b.win_probability) END), "
            "SUM(CASE WHEN ABS(a.win_probability-b.win_probability) > 0.01 THEN 1 ELSE 0 END) "
            "FROM matrix_cells a JOIN matrix_cells b USING(dealer_score,pone_score) "
            "JOIN matrix_cells p USING(dealer_score,pone_score) "
            "WHERE a.cohort=? AND b.cohort=? AND p.cohort='pooled'",
            (left, right),
        ).fetchone()
        report["cohortComparison"] = {
            "left": left,
            "right": right,
            "maximumAbsoluteDifference": comparison[0],
            "meanAbsoluteDifference": comparison[1],
            "meanAbsoluteDifferenceInPooledFortyToSixtyBand": comparison[2],
            "cellsDifferingByMoreThanOnePoint": comparison[3],
        }
    return report


def verify_monotonicity(connection: sqlite3.Connection, cohort: str) -> None:
    cells = {
        (dealer, pone): probability
        for dealer, pone, probability in connection.execute(
            "SELECT dealer_score, pone_score, win_probability FROM matrix_cells WHERE cohort=?",
            (cohort,),
        )
    }
    for dealer in range(SCORE_COUNT):
        for pone in range(SCORE_COUNT):
            value = cells[(dealer, pone)]
            if dealer < 120 and cells[(dealer + 1, pone)] + 1e-15 < value:
                raise ValueError(f"{cohort} is not monotone in dealer score at {dealer}:{pone}")
            if pone < 120 and cells[(dealer, pone + 1)] - 1e-15 > value:
                raise ValueError(f"{cohort} is not monotone in pone score at {dealer}:{pone}")


def main() -> None:
    args = parse_args()
    inputs = parse_inputs(args.input)
    clusters = load_games(inputs, args.allow_partial)
    cohort_names = list(dict.fromkeys(pair.cohort for pair in inputs))
    aggregates = {name: MatrixAggregate(name) for name in cohort_names}
    aggregates["pooled"] = MatrixAggregate("pooled")
    connections = ConnectionCache()
    try:
        total = len(clusters)
        for index, ((cohort, _seed), games) in enumerate(sorted(clusters.items()), start=1):
            cutoffs = [game_cutoffs(game, connections) for game in games]
            aggregates[cohort].add_cluster(cutoffs)
            aggregates["pooled"].add_cluster(cutoffs)
            if index % 100 == 0 or index == total:
                print(f"processed {index}/{total} seed clusters", flush=True)
    finally:
        connections.close()

    output = initialize_output(args.out_db.resolve())
    try:
        with output:
            for aggregate in aggregates.values():
                write_aggregate(output, aggregate)
        for name in aggregates:
            verify_monotonicity(output, name)
        report = summarize(aggregates, output)
    finally:
        output.close()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
