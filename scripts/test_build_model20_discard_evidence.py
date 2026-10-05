import copy
import json
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model20_discard_evidence as builder
from learning_model_policy import discard_cohort
from pack_model20_opponent_discards import ASSETS, rank_keys


def empty_evidence():
    return {"schemaVersion": 1, "countsByModel": {}, "games": {}, "sources": [],
            "baselineEndedAt": "2026-08-29T17:35:41Z", "blend": "test", "eligibility": "test"}


def create_database(path):
    connection = sqlite3.connect(path)
    connection.executescript("""
        CREATE TABLE compact_games (
          game_id TEXT, run_id TEXT, matchup_id TEXT, game_index INTEGER, random_seed TEXT,
          left_engine TEXT, right_engine TEXT, included_in_tables INTEGER, reproducible INTEGER,
          winner INTEGER, final_left_score INTEGER, final_right_score INTEGER, ended_at TEXT);
        CREATE TABLE compact_hands (
          game_id TEXT, hand_number INTEGER, dealer INTEGER, start_left_score INTEGER,
          start_right_score INTEGER, cut_card INTEGER, left_dealt BLOB, right_dealt BLOB,
          left_keep BLOB, right_keep BLOB);
    """)
    return connection


def add_game(connection, name, index, left="13.23", right="20.0", complete=True,
             ended="2026-09-25T00:00:00Z", seed=None):
    connection.execute("INSERT INTO compact_games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        name, "run", "matchup", index, str(index if seed is None else seed),
        f"schell_table-peg_table-{left}", f"schell_table-peg_table-{right}",
        1, 1, 0 if complete else None, 121 if complete else 0, 90, ended))
    connection.execute("INSERT INTO compact_hands VALUES (?,?,?,?,?,?,?,?,?,?)", (
        name, 1, 0, 0, 0, 51, bytes([0, 4, 8, 12, 16, 17]),
        bytes([20, 24, 28, 32, 36, 40]), bytes([0, 4, 8, 12]), bytes([20, 24, 28, 32])))
    connection.commit()


class DiscardEvidenceTests(unittest.TestCase):
    def test_excludes_defunct_and_unknown_models_including_inherited_counts(self):
        for version in ("15.0", "15.1", "15.2", "15.99", "16.0", "16.1", "16.99", "15.2-renamed"):
            self.assertIsNone(discard_cohort(f"schell_table-peg_table-{version}", historical=True))
        self.assertIsNone(discard_cohort("unknown"))
        self.assertIsNone(discard_cohort("schell_table-peg_table-9.1"))
        self.assertEqual(discard_cohort("schell_table-peg_table-9.1", historical=True), "historical-9.x")
        value = empty_evidence()
        value["countsByModel"]["schell_table-peg_table-15.2"] = {}
        with self.assertRaisesRegex(ValueError, "ineligible inherited"):
            builder.histograms(value)

    def test_incremental_import_filters_and_retains_exact_indices(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.db"
            db = create_database(path)
            add_game(db, "accepted", 0)
            add_game(db, "partial", 1, complete=False)
            add_game(db, "excluded", 2, left="15.2", right="16.1")
            add_game(db, "mixed", 3, left="13.23", right="15.1")
            add_game(db, "old", 4, ended="2026-08-28T00:00:00Z")
            db.close()
            value = empty_evidence()
            builder.add_database(value, path)
            self.assertEqual(len(value["games"]), 2)
            self.assertEqual(value["sources"][0]["statistics"]["decisionsAdded"], 3)
            self.assertEqual(sorted(index for run in value["sources"][0]["includedGames"]
                                    for index in run["gameIndices"]), [0, 3])
            counts = copy.deepcopy(value["countsByModel"])
            # Complete the missing game, add a replay with a new ID and retain old rows.
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET winner=0,final_left_score=121 WHERE game_id='partial'")
            add_game(db, "replay", 5, seed=0)
            db.close()
            builder.add_database(value, path)
            self.assertEqual(len(value["games"]), 3)
            self.assertEqual(value["sources"][-1]["statistics"]["duplicateGames"], 3)
            self.assertEqual(value["sources"][-1]["includedGames"][0]["gameIndices"], [1])
            self.assertNotEqual(value["countsByModel"], counts)
            unchanged = copy.deepcopy(value)
            builder.add_database(value, path)
            self.assertEqual(value, unchanged)
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET final_right_score=89 WHERE game_id='accepted'")
            db.commit()
            db.close()
            with self.assertRaisesRegex(ValueError, "conflicting completed game identity"):
                builder.add_database(value, path)

    def test_rejects_duplicate_cards_and_same_rank_wrong_suit_keep(self):
        for dealt, keep in (([0, 0, 8, 12, 16, 17], [0, 4, 8, 12]),
                            ([0, 4, 8, 12, 16, 17], [1, 4, 8, 12])):
            with self.assertRaises(ValueError):
                builder.strict_discard(bytes(dealt), bytes(keep))

    def test_every_packed_rank_weight_matches_retained_evidence(self):
        evidence = builder.read_evidence(builder.EVIDENCE)
        expected = builder.histograms(evidence)
        packed = (ASSETS / "model20-opponent-discards.bin").read_bytes()
        metadata_length = struct.unpack_from("<I", packed, 12)[0]
        metadata = json.loads(packed[64:64 + metadata_length])
        self.assertEqual(metadata["conditionalDiscards"]["sourceGameCount"], len(evidence["games"]))
        offset = 64 + metadata_length
        pairs = rank_keys(2)
        for role in ("dealer", "pone"):
            offset += 16 + 91 * 24
            for keep in [None] + rank_keys(4):
                length, = struct.unpack_from("<H", packed, offset)
                offset += 2
                row = {}
                for _ in range(length):
                    pair, weight = struct.unpack_from("<BQ", packed, offset)
                    offset += 9
                    row[pairs[pair]] = weight
                wanted = expected["roles"][role].get(keep, {}) if keep else expected["fallbackByRole"][role]
                self.assertEqual(row, wanted, (role, keep))
        self.assertEqual(offset, len(packed))
        self.assertEqual(sum(s["statistics"].get("gamesAdded", 0) for s in evidence["sources"]), len(evidence["games"]))
        for source in evidence["sources"]:
            self.assertEqual(sum(len(run["gameIndices"]) for run in source["includedGames"]),
                             source["statistics"].get("gamesAdded", 0))


if __name__ == "__main__":
    unittest.main()
