#!/usr/bin/env python3

import importlib.util
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
