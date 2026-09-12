import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build_training_drills.py")
SPEC = importlib.util.spec_from_file_location("build_training_drills", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class TrainingDrillBuilderTests(unittest.TestCase):
    def test_selects_only_a_unique_immediate_scoring_card(self):
        easy = {
            "type": "pegging",
            "action": "play",
            "hand": ["2h", "5d", "9s", "Kc"],
            "playedCards": ["6c"],
            "countBefore": 6,
        }
        ambiguous = {**easy, "hand": ["2h", "5d", "9s", "9h"]}

        selected = MODULE.select_easy_scoring_plays([easy, ambiguous])

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["answer"], "9s")
        self.assertEqual(selected[0]["points"], 2)

    def test_pegging_score_matches_pair_run_and_thirty_one_rules(self):
        points, components = MODULE.score_pegging_play(["5c", "7d"], "6h", 12)
        self.assertEqual((points, components["run"]), (3, 3))
        points, components = MODULE.score_pegging_play(["10c", "10d"], "10h", 20)
        self.assertEqual((points, components["pairs"]), (6, 6))
        points, components = MODULE.score_pegging_play(["10c", "10d"], "As", 30)
        self.assertEqual((points, components["thirtyOne"]), (2, 2))

    def test_discard_requires_unique_made_points_winner_and_ace_agreement(self):
        event = {
            "type": "discard",
            "player": "human",
            "handBeforeDiscard": ["4c", "4d", "5h", "6s", "Qc", "Kd"],
            "cribOwner": "human",
            "review": {"recommended": ["Qc", "Kd"]},
        }
        disagreement = json.loads(json.dumps(event))
        disagreement["review"]["recommended"] = ["4c", "Kd"]

        selected = MODULE.select_easy_discards([event, disagreement], minimum_margin=4)

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["answer"], ["Qc", "Kd"])
        self.assertEqual(selected[0]["keptCards"], ["4c", "4d", "5h", "6s"])
        self.assertEqual(selected[0]["madePoints"], 12)

    def test_computer_discard_is_reframed_from_the_acting_players_view(self):
        event = {
            "type": "discard",
            "player": "ai",
            "handBeforeDiscard": ["4c", "4d", "5h", "6s", "Qc", "Kd"],
            "cards": ["Qc", "Kd"],
            "cribOwner": "ai",
        }

        selected = MODULE.select_easy_discards([event], minimum_margin=4)

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["cribOwner"], "player")

    def test_completed_upload_replaces_legacy_copy_and_output_is_anonymous(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "games.db"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE game_uploads (game_id TEXT PRIMARY KEY, events_json TEXT NOT NULL);
                CREATE TABLE cribbage_completed_game_uploads (game_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
                """
            )
            legacy = [{"type": "game", "sessionTag": "Private Name"}]
            current = [{
                "type": "pegging", "action": "play", "hand": ["2h", "5d", "9s", "Kc"],
                "playedCards": ["6c"], "countBefore": 6, "sessionTag": "Private Name",
            }]
            connection.execute("INSERT INTO game_uploads VALUES (?, ?)", ("secret-game", json.dumps(legacy)))
            connection.execute(
                "INSERT INTO cribbage_completed_game_uploads VALUES (?, ?)",
                ("secret-game", json.dumps({"events": current})),
            )
            connection.commit()
            connection.close()

            catalog = MODULE.build_catalog(database)

        encoded = json.dumps(catalog)
        self.assertEqual(catalog["source"]["distinctCompletedGames"], 1)
        self.assertEqual(catalog["counts"]["scoringPlayDrills"], 1)
        self.assertNotIn("secret-game", encoded)
        self.assertNotIn("Private Name", encoded)


if __name__ == "__main__":
    unittest.main()
