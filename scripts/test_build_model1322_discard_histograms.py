#!/usr/bin/env python3

import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("build_model1322_discard_histograms.py")
SPEC = importlib.util.spec_from_file_location("histograms", SCRIPT)
HISTOGRAMS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(HISTOGRAMS)


class DiscardHistogramTest(unittest.TestCase):
    def test_infers_rank_major_discard_from_deal_and_keep(self):
        keep, discard = HISTOGRAMS.infer_keep_discard(
            bytes([0, 4, 8, 12, 16, 17]), bytes([0, 4, 8, 12])
        )
        self.assertEqual(keep, "1111000000000")
        self.assertEqual(discard, "0000200000000")

    def test_builds_role_conditioned_histogram(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "games.db"
            db = sqlite3.connect(database)
            db.executescript(
                """
                CREATE TABLE compact_games (
                  game_id TEXT, left_engine TEXT, right_engine TEXT,
                  included_in_tables INTEGER
                );
                CREATE TABLE compact_hands (
                  game_id TEXT, dealer INTEGER, left_dealt BLOB, right_dealt BLOB,
                  left_keep BLOB, right_keep BLOB
                );
                """
            )
            db.execute(
                "INSERT INTO compact_games VALUES ('g', ?, ?, 1)",
                ("schell_table-peg_table-13.2", "schell_table-peg_table-9.1"),
            )
            db.execute(
                "INSERT INTO compact_hands VALUES ('g', 0, ?, ?, ?, ?)",
                (
                    bytes([0, 4, 8, 12, 16, 17]),
                    bytes([20, 24, 28, 32, 36, 40]),
                    bytes([0, 4, 8, 12]),
                    bytes([20, 24, 28, 32]),
                ),
            )
            db.commit()
            db.close()
            value = HISTOGRAMS.build([database])
            self.assertIn("1111000000000", value["roles"]["dealer"])
            self.assertIn("0000011110000", value["roles"]["pone"])


if __name__ == "__main__":
    unittest.main()
