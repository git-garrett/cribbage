#!/usr/bin/env python3

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("report_paired_benchmark.py")
SPEC = importlib.util.spec_from_file_location("report_paired_benchmark", MODULE_PATH)
reporter = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(reporter)


class PairedBenchmarkReportTests(unittest.TestCase):
    def test_combines_orientations_and_pairs_by_seed(self):
        candidate = "candidate"
        opponent = "opponent"
        candidate_left = [
            self.game(0, "100", candidate, opponent, 0, 121, 111),
            self.game(1, "101", candidate, opponent, 1, 116, 121),
        ]
        opponent_left = [
            self.game(0, "100", opponent, candidate, 1, 109, 121),
            self.game(1, "101", opponent, candidate, 1, 118, 121),
        ]

        report = reporter.build_report(
            candidate_left, opponent_left, candidate, opponent, 2
        )

        self.assertEqual(report["candidateWins"], 3)
        self.assertEqual(report["pairedSeeds"]["candidateSweeps"], 1)
        self.assertEqual(report["pairedSeeds"]["splitPairs"], 1)
        self.assertEqual(report["pairedSeeds"]["opponentSweeps"], 0)

    def test_consolidates_decision_timing_across_orientations(self):
        with tempfile.TemporaryDirectory() as directory:
            candidate_left = Path(directory) / "candidate-left.db"
            opponent_left = Path(directory) / "opponent-left.db"
            self.timing_database(
                candidate_left,
                [
                    ("discard", 1, "candidate", 1_000),
                    ("discard", 1, "candidate", 3_000),
                    ("discard", 1, "opponent", 4_000),
                    ("pegging", 0, "candidate", 500),
                    ("pegging", 0, "opponent", 1_000),
                    ("pegging", 0, "opponent", 3_000),
                ],
            )
            self.timing_database(
                opponent_left,
                [
                    ("discard", 1, "candidate", 5_000),
                    ("discard", 1, "opponent", 2_000),
                    ("discard", 1, "opponent", 6_000),
                    ("pegging", 0, "candidate", 1_500),
                    ("pegging", 0, "opponent", 2_000),
                ],
            )

            timing = reporter.summarize_timing(
                reporter.merge_decision_timings(
                    reporter.read_decision_timings(candidate_left),
                    reporter.read_decision_timings(opponent_left),
                ),
                "candidate",
                "opponent",
            )

        discard_candidate = next(
            row
            for row in timing["rows"]
            if row["kind"] == "discard" and row["model"] == "candidate"
        )
        self.assertEqual(discard_candidate["decisions"], 3)
        self.assertEqual(discard_candidate["avgMs"], 3.0)
        self.assertEqual(discard_candidate["p50Ms"], 3.0)
        self.assertEqual(discard_candidate["p90Ms"], 5.0)
        discard_comparison = next(
            row for row in timing["comparisons"] if row["kind"] == "discard"
        )
        self.assertEqual(discard_comparison["candidateMinusOpponentMs"], -1.0)
        self.assertEqual(discard_comparison["candidateToOpponentRatio"], 0.75)

    @staticmethod
    def timing_database(path, rows):
        with sqlite3.connect(path) as database:
            database.executescript(
                """
                CREATE TABLE compact_games (
                  game_id TEXT PRIMARY KEY,
                  included_in_tables INTEGER NOT NULL
                );
                CREATE TABLE compact_discards (
                  game_id TEXT NOT NULL,
                  role INTEGER,
                  model TEXT,
                  decision_elapsed_us INTEGER
                );
                CREATE TABLE compact_peg_plays (
                  game_id TEXT NOT NULL,
                  role INTEGER,
                  model TEXT,
                  decision_elapsed_us INTEGER
                );
                INSERT INTO compact_games VALUES ('game', 1);
                """
            )
            for kind, role, model, elapsed_us in rows:
                table = (
                    "compact_discards" if kind == "discard" else "compact_peg_plays"
                )
                database.execute(
                    f"INSERT INTO {table} VALUES ('game', ?, ?, ?)",
                    (role, model, elapsed_us),
                )

    @staticmethod
    def game(index, seed, left, right, winner, left_score, right_score):
        return {
            "game_index": index,
            "random_seed": seed,
            "left_engine": left,
            "right_engine": right,
            "winner": winner,
            "final_left_score": left_score,
            "final_right_score": right_score,
        }


if __name__ == "__main__":
    unittest.main()
