#!/usr/bin/env python3

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("build_model1322_decline_factors.py")
SPEC = importlib.util.spec_from_file_location("factors", SCRIPT)
FACTORS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(FACTORS)


class DeclineFactorTest(unittest.TestCase):
    def test_completion_categories(self):
        self.assertEqual(FACTORS.completion([2], 2), "pair")
        self.assertEqual(FACTORS.completion([2, 2], 2), "threeOfAKind")
        self.assertEqual(FACTORS.completion([2, 2, 2], 2), "fourOfAKind")
        self.assertEqual(FACTORS.completion([0, 1], 2), "threeCardRun")
        self.assertEqual(FACTORS.completion([0, 1, 2], 3), "fourPlusCardRun")
        self.assertIsNone(FACTORS.completion([0], 4))

    def test_declined_pair_is_measured_from_cards_actually_held(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "games.db"
            db = sqlite3.connect(database)
            db.executescript(
                """
                CREATE TABLE compact_hands (
                  game_id TEXT, hand_number INTEGER, left_keep BLOB, right_keep BLOB
                );
                CREATE TABLE compact_peg_plays (
                  game_id TEXT, hand_number INTEGER, sequence INTEGER, player INTEGER,
                  action INTEGER, card INTEGER, count_before INTEGER, count_after INTEGER
                );
                """
            )
            # Left holds two fives (rank-major card ids 16 and 17) and declines the pair by
            # playing an ace after right leads a five.
            db.execute("INSERT INTO compact_hands VALUES ('g', 1, ?, ?)", (bytes([16, 17, 0, 1]), bytes([18, 8, 12, 20])))
            db.executemany(
                "INSERT INTO compact_peg_plays VALUES ('g', 1, ?, ?, 0, ?, ?, ?)",
                [(0, 1, 18, 0, 5), (1, 0, 0, 5, 6)],
            )
            db.commit()
            db.close()
            counts = FACTORS.database_counts(database)
            self.assertEqual(counts["pair"]["first"]["opportunities"], 1)
            self.assertEqual(counts["pair"]["first"]["declined"], 1)
            self.assertEqual(counts["pair"]["first"]["observedDeclines"], 1)
            self.assertEqual(counts["pair"]["first"]["declinesWithCardHeld"], 1)

    def test_new_pair_tactics_use_exhaustive_models_and_exclude_empty_opponents(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "games.db"
            db = sqlite3.connect(database)
            db.executescript(
                """
                CREATE TABLE compact_hands (
                  game_id TEXT, hand_number INTEGER, cut_card INTEGER,
                  left_dealt BLOB, right_dealt BLOB, left_keep BLOB, right_keep BLOB
                );
                CREATE TABLE compact_peg_plays (
                  game_id TEXT, hand_number INTEGER, sequence INTEGER, player INTEGER,
                  action INTEGER, card INTEGER, count_before INTEGER, count_after INTEGER,
                  model TEXT
                );
                """
            )

            def add_hand(game, left, right, plays, model="schell_table-peg_table-13.0"):
                db.execute(
                    "INSERT INTO compact_hands VALUES (?, 1, ?, ?, ?, ?, ?)",
                    (game, 48, bytes(left), bytes(right), bytes(left[:4]), bytes(right[:4])),
                )
                db.executemany(
                    "INSERT INTO compact_peg_plays VALUES (?, 1, ?, ?, 0, ?, ?, ?, ?)",
                    [(game, *play, model) for play in plays],
                )

            # Rank-major compact ids: fives are 16..19. Left declines a pair
            # royal after the two public fives.
            add_hand(
                "pair-royal",
                [16, 17, 0, 4, 8, 12],
                [18, 20, 24, 28, 32, 36],
                [(0, 0, 16, 0, 5), (1, 1, 18, 5, 10), (2, 0, 0, 10, 11)],
            )
            # Right declines the fourth five after a public pair royal.
            add_hand(
                "four-kind",
                [16, 17, 0, 4, 8, 12],
                [18, 19, 20, 24, 28, 32],
                [
                    (0, 0, 16, 0, 5),
                    (1, 1, 18, 5, 10),
                    (2, 0, 17, 10, 15),
                    (3, 1, 20, 15, 21),
                ],
            )
            # Left knows the opponent cannot retaliate: its own six contains
            # three fives and the opponent has publicly played the fourth.
            add_hand(
                "safe-pair",
                [16, 17, 19, 0, 4, 8],
                [18, 20, 24, 28, 32, 36],
                [(0, 1, 18, 0, 5), (1, 0, 0, 5, 6)],
            )
            # The same dead-card fact makes a declined pair royal safe.
            add_hand(
                "safe-pair-royal",
                [16, 17, 19, 0, 4, 8],
                [18, 20, 24, 28, 32, 36],
                [(0, 0, 16, 0, 5), (1, 1, 18, 5, 10), (2, 0, 0, 10, 11)],
            )
            # This otherwise-valid safe-pair decline is excluded because the
            # opponent has no cards remaining after its lead.
            add_hand(
                "opponent-empty",
                [16, 17, 19, 0, 4, 8],
                [18],
                [(0, 1, 18, 0, 5), (1, 0, 0, 5, 6)],
            )
            # Non-exhaustive model behavior must not enter the model cohort.
            add_hand(
                "myrmidon",
                [16, 17, 19, 0, 4, 8],
                [18, 20, 24, 28, 32, 36],
                [(0, 1, 18, 0, 5), (1, 0, 0, 5, 6)],
                model="myrmidon-5",
            )
            db.commit()
            db.close()

            counts = FACTORS.compact_database_counts(database)
            self.assertEqual(counts["pairRoyalAfterPair"]["second"]["declined"], 2)
            self.assertEqual(
                counts["fourOfAKindAfterPairRoyal"]["second"]["declined"], 1
            )
            self.assertEqual(counts["safePair"]["first"]["declined"], 1)
            self.assertEqual(counts["safePairRoyal"]["second"]["declined"], 1)

    def test_human_event_adapter_uses_private_legal_knowledge(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "server.sqlite"
            db = sqlite3.connect(database)
            db.execute(
                """
                CREATE TABLE cribbage_game_events (
                  session_id TEXT, event_sequence INTEGER, action TEXT,
                  request_json TEXT, game_json TEXT
                )
                """
            )
            game = {
                "count": 6,
                "plays": [
                    {"id": 4, "rank": 4, "value": 5},
                    {"id": 0, "rank": 0, "value": 1},
                ],
                "turn_card": {"id": 12, "rank": 12, "value": 10},
                "players": [
                    {
                        "hand": [
                            {"id": 17, "rank": 4, "value": 5},
                            {"id": 30, "rank": 4, "value": 5},
                            {"id": 2, "rank": 2, "value": 3},
                        ],
                        "table": [{"id": 0, "rank": 0, "value": 1}],
                        "discarded_to_crib": [
                            {"id": 43, "rank": 4, "value": 5},
                            {"id": 1, "rank": 1, "value": 2},
                        ],
                    },
                    {
                        "hand": [
                            {"id": 5, "rank": 5, "value": 6},
                            {"id": 6, "rank": 6, "value": 7},
                            {"id": 7, "rank": 7, "value": 8},
                        ],
                        "table": [{"id": 4, "rank": 4, "value": 5}],
                        "discarded_to_crib": [],
                    },
                ],
            }
            db.execute(
                "INSERT INTO cribbage_game_events VALUES ('s', 1, 'play-human', ?, ?)",
                (json.dumps({"payload": {"id": 0}}), json.dumps(game)),
            )
            db.commit()
            db.close()

            counts = FACTORS.human_database_counts(database)
            self.assertEqual(counts["safePair"]["first"]["opportunities"], 1)
            self.assertEqual(counts["safePair"]["first"]["declined"], 1)

    def test_opponent_go_makes_pair_retaliation_safe(self):
        counts = FACTORS.empty_counts()
        remaining = [0] * 13
        remaining[4] = 1
        remaining[0] = 1

        FACTORS.observe_action(
            counts,
            remaining=remaining,
            opponent_remaining_count=2,
            actor_known=[0] * 13,
            series=[4],
            count_before=5,
            actual=0,
            card_ordinal=2,
            opponent_said_go=True,
        )

        self.assertEqual(counts["safePair"]["second"]["declined"], 1)

    def test_competing_scoring_play_is_not_a_decline(self):
        counts = FACTORS.empty_counts()
        remaining = [0] * 13
        remaining[4] = 1  # Could pair the five at 26.
        remaining[9] = 1  # Instead plays a ten to make 31.

        FACTORS.observe_action(
            counts,
            remaining=remaining,
            opponent_remaining_count=2,
            actor_known=[0] * 13,
            series=[4],
            count_before=21,
            actual=9,
            card_ordinal=2,
        )

        self.assertEqual(counts["pair"]["second"]["opportunities"], 0)
        self.assertEqual(counts["pair"]["second"]["observedDeclines"], 0)

    def test_non_scoring_play_remains_a_decline(self):
        counts = FACTORS.empty_counts()
        remaining = [0] * 13
        remaining[4] = 1
        remaining[0] = 1

        FACTORS.observe_action(
            counts,
            remaining=remaining,
            opponent_remaining_count=2,
            actor_known=[0] * 13,
            series=[4],
            count_before=5,
            actual=0,
            card_ordinal=2,
        )

        self.assertEqual(counts["pair"]["second"]["declined"], 1)
        row = FACTORS.factor_rows(counts)["pair"]["byCardOrdinal"]["second"]
        self.assertEqual(row["heldGivenDeclinePpm"], 1_000_000)

    def test_observed_decline_records_when_scoring_card_was_not_held(self):
        counts = FACTORS.empty_counts()
        remaining = [0] * 13
        remaining[0] = 1

        FACTORS.observe_action(
            counts,
            remaining=remaining,
            opponent_remaining_count=2,
            actor_known=[0] * 13,
            series=[4],
            count_before=5,
            actual=0,
            card_ordinal=2,
        )

        raw = counts["pair"]["second"]
        self.assertEqual(raw["opportunities"], 0)
        self.assertEqual(raw["observedDeclines"], 1)
        self.assertEqual(raw["declinesWithCardHeld"], 0)
        self.assertEqual(raw["declinesWithoutCardHeld"], 1)
        row = FACTORS.factor_rows(counts)["pair"]["byCardOrdinal"]["second"]
        self.assertEqual(row["heldGivenDeclinePpm"], 0)


if __name__ == "__main__":
    unittest.main()
