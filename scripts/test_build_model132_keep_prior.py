import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build_model132_keep_prior.py")
SPEC = importlib.util.spec_from_file_location("build_model132_keep_prior", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class Model132KeepPriorTests(unittest.TestCase):
    def test_blends_model_cohorts_equally_and_records_missing_humans(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "games.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE compact_games (
                  game_id TEXT PRIMARY KEY,
                  left_engine TEXT NOT NULL,
                  right_engine TEXT NOT NULL,
                  included_in_tables INTEGER NOT NULL
                );
                CREATE TABLE compact_hands (
                  game_id TEXT NOT NULL,
                  dealer INTEGER NOT NULL,
                  left_keep BLOB NOT NULL,
                  right_keep BLOB NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT INTO compact_games VALUES (?, ?, ?, 1)",
                ("g", "schell_table-peg_table-9.1", "schell_table-peg_table-13.1"),
            )
            connection.execute(
                "INSERT INTO compact_hands VALUES (?, ?, ?, ?)",
                ("g", 0, bytes([0, 4, 8, 12]), bytes([16, 20, 24, 28])),
            )
            connection.commit()
            connection.close()

            prior = MODULE.build_prior([database])

        cohorts = {entry["name"]: entry for entry in prior["cohorts"]}
        self.assertTrue(cohorts["model-9.x"]["included"])
        self.assertTrue(cohorts["model-13.x"]["included"])
        self.assertFalse(cohorts["human"]["included"])
        self.assertEqual(sum(prior["roles"]["dealer"].values()), 1_000_000_000)
        self.assertEqual(sum(prior["roles"]["pone"].values()), 1_000_000_000)

    def test_compact_keep_uses_rank_major_encoding(self):
        self.assertEqual(MODULE.keep_key(bytes([0, 1, 4, 51])), "2100000000001")

    def test_production_adapter_deduplicates_and_anonymizes_human_keeps(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "production.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE game_uploads (
                  game_id TEXT PRIMARY KEY,
                  events_json TEXT NOT NULL
                );
                CREATE TABLE cribbage_completed_game_uploads (
                  game_id TEXT PRIMARY KEY,
                  payload_json TEXT NOT NULL
                );
                CREATE TABLE cribbage_game_events (
                  session_id TEXT NOT NULL,
                  action TEXT NOT NULL,
                  game_json TEXT NOT NULL
                );
                """
            )
            legacy_event = {
                "type": "discard",
                "player": "human",
                "handNumber": 1,
                "role": "dealer",
                "remainingHand": ["Ad", "2c", "3h", "4s"],
            }
            current_event = {
                "type": "discard",
                "player": "human",
                "handNumber": 2,
                "role": "pone",
                "remainingHand": ["5d", "6c", "7h", "8s"],
            }
            connection.execute(
                "INSERT INTO game_uploads VALUES (?, ?)",
                ("legacy", json.dumps([legacy_event])),
            )
            connection.execute(
                "INSERT INTO cribbage_completed_game_uploads VALUES (?, ?)",
                ("current", json.dumps({"events": [current_event]})),
            )
            duplicate_game = {
                "hand_number": 2,
                "dealer": "Right",
                "players": [{"hand": [{"rank": rank} for rank in (4, 5, 6, 7)]}],
            }
            active_game = {
                "hand_number": 3,
                "dealer": "Left",
                "players": [{"hand": [{"rank": rank} for rank in (8, 9, 10, 11)]}],
            }
            connection.execute(
                "INSERT INTO cribbage_game_events VALUES (?, 'discard', ?)",
                ("current", json.dumps(duplicate_game)),
            )
            connection.execute(
                "INSERT INTO cribbage_game_events VALUES (?, 'discard', ?)",
                ("active", json.dumps(active_game)),
            )
            connection.commit()
            connection.close()

            counts = {
                cohort: {role: MODULE.Counter() for role in MODULE.ROLES}
                for cohort in MODULE.COHORTS
            }
            source = MODULE.tally_database(database, counts)

        self.assertEqual(source["adapter"], "production-human-games")
        self.assertEqual(source["acceptedHumanHands"], 3)
        self.assertEqual(sum(counts["human"]["dealer"].values()), 2)
        self.assertEqual(sum(counts["human"]["pone"].values()), 1)
        self.assertNotIn("tag", json.dumps(source).lower())


if __name__ == "__main__":
    unittest.main()
