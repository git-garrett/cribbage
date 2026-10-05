import copy
import gzip
import json
import math
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model203_hold as builder
from test_build_model20_discard_evidence import create_database


def add_game(db, name, index, left="13.23", right="20.0", complete=True, seed=None):
    db.execute("INSERT INTO compact_games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        name, "run", "matchup", index, str(index if seed is None else seed),
        f"schell_table-peg_table-{left}", f"schell_table-peg_table-{right}",
        1, 1, 0 if complete else None, 121 if complete else 0, 90, "2026-09-25T00:00:00Z"))
    db.execute("INSERT INTO compact_hands (game_id,hand_number,dealer,start_left_score,"
               "start_right_score,cut_card,left_dealt,right_dealt,left_keep,right_keep) "
               "VALUES (?,?,?,?,?,?,?,?,?,?)", (
                   name, 1, 0, 0, 0, 51, bytes([0,4,8,12,16,17]), bytes([20,24,28,32,36,40]),
                   bytes([0,4,8,12]), bytes([20,24,28,32])))
    db.commit()


class HoldTests(unittest.TestCase):
    def test_cohort_weighting_retains_raw_counts_and_positive_support(self):
        value = builder.empty_evidence()
        keep = '0000000000004'
        other = '0000000000013'
        value['baseline'] = {r: {builder.ZERO: {keep: 10}} for r in builder.ROLES}
        value['updatesByModel'] = {
            'schell_table-peg_table-9.1': {r: {builder.ZERO: {keep: 20}} for r in builder.ROLES},
            'schell_table-peg_table-20.2': {r: {builder.ZERO: {other: 40}} for r in builder.ROLES},
        }
        original = copy.deepcopy(value)
        weighted = builder.merged_counts(value, .25)
        self.assertEqual(weighted['dealer'][builder.ZERO], {keep: 7.5, other: 40})
        self.assertEqual(value, original)
        prior = {'roles': {r: {keep: 1, other: 1} for r in builder.ROLES}}
        rows = builder.distributions(value, prior, [10]*4, older_model_weight=.25)
        self.assertEqual(len(rows['dealer', builder.ZERO]), 1820)
        self.assertTrue(all(p > 0 for row in rows.values() for p in row.values()))
        for bad in (0, -1, float('nan'), 2):
            with self.assertRaises(ValueError):
                builder.distributions(value, prior, [10]*4, older_model_weight=bad)

    def test_smoothing_uses_evidence_without_creating_impossibility(self):
        prior = {"seen": 0.98, "unseen": 0.02}
        self.assertEqual(builder.smooth({}, prior, 100), prior)
        self.assertAlmostEqual(builder.smooth({"seen": 20}, prior, 100)["unseen"], 2 / 120)
        self.assertAlmostEqual(builder.smooth({"seen": 1000}, prior, 100)["unseen"], 2 / 1100)
        self.assertGreater(builder.smooth({"seen": 20, "unseen": 1}, prior, 100)["unseen"], 2 / 120)

    def test_packed_asset_has_every_legal_hand_and_no_impossible_hand(self):
        data = builder.OUTPUT.read_bytes()
        self.assertEqual(data[:8], builder.MAGIC)
        version, contexts, records, cb, rb = struct.unpack_from("<IIIII", data, 8)
        self.assertEqual((version, contexts, cb, rb), (1, 1120, 22, 21))
        record_start = 28 + contexts * cb
        self.assertEqual(len(data), record_start + records * rb)
        seen = set()
        for i in range(contexts):
            row = struct.unpack_from("<B13BII", data, 28 + i * cb)
            role, p, first, length = row[0], row[1:14], row[14], row[15]
            self.assertNotIn((role, p), seen)
            seen.add((role, p))
            actual = {}
            for j in range(first, first + length):
                record = struct.unpack_from("<13BQ", data, record_start + j * rb)
                hand, weight = "".join(map(str, record[:13])), record[13]
                self.assertGreater(weight, 0)
                self.assertNotIn(hand, actual)
                actual[hand] = weight
            prefix = "".join(map(str, p))
            expected = {h for h in builder.keys(4 - sum(p)) if builder.physically_valid(prefix, h)}
            self.assertEqual(set(actual), expected)
            if sum(p) == 0:
                self.assertEqual(len(actual), 1820)

    def test_historical_source_is_audited_and_counts_are_not_packed_weights(self):
        value = json.loads(gzip.decompress(builder.EVIDENCE.read_bytes()))
        builder.validate_evidence(value)
        self.assertEqual(value["sources"][0]["sourceGames"]["gameCount"], 170905)
        for model in ("15.0", "15.2", "16.0", "16.3", "20.3-renamed"):
            bad = copy.deepcopy(value)
            bad["updatesByModel"]["schell_table-peg_table-" + model] = {}
            with self.assertRaisesRegex(ValueError, "ineligible"):
                builder.validate_evidence(bad)
        for role in builder.ROLES:
            self.assertLess(sum(value["baseline"][role][builder.ZERO].values()), 2_000_000)

    def test_incremental_import_no_duplicates_or_defunct_actor_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.db"
            db = create_database(path)
            db.execute("ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB")
            add_game(db, "accepted", 0)
            add_game(db, "partial", 1, complete=False)
            add_game(db, "excluded", 2, left="15.2", right="16.1")
            add_game(db, "mixed", 3, right="15.1")
            # One observed play per actor; only actual visits can add prefix rows.
            db.execute("UPDATE compact_hands SET peg_sequence=?", (bytes([0, 0, 0, 0, 0, 0, 1, 20, 0, 0]),))
            db.commit()
            db.close()
            value = builder.empty_evidence()
            builder.import_database(value, path)
            self.assertEqual(len(value["games"]), 2)
            self.assertEqual(value["sources"][-1]["statistics"]["actorHandsAdded"], 3)
            self.assertTrue(all(builder.eligible(e) for e in value["updatesByModel"]))
            before = copy.deepcopy(value)
            builder.import_database(value, path)
            self.assertEqual(value, before)
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET winner=0,final_left_score=121 WHERE game_id='partial'")
            add_game(db, "replay", 5, seed=0)
            db.execute("UPDATE compact_hands SET peg_sequence=(SELECT peg_sequence FROM compact_hands WHERE game_id='accepted') WHERE game_id='replay'")
            db.commit()
            db.close()
            builder.import_database(value, path)
            self.assertEqual(len(value["games"]), 3)
            self.assertEqual(value["sources"][-1]["statistics"]["duplicateGames"], 3)
            self.assertEqual([g["gameIndex"] for g in value["sources"][-1]["includedGames"]], [1])
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET final_right_score=88 WHERE game_id='accepted'")
            db.commit()
            db.close()
            with self.assertRaisesRegex(ValueError, "conflicting"):
                builder.import_database(value, path)

    def test_opening_observation_does_not_fabricate_unplayed_prefixes(self):
        hand = {"dealer": 0, "left_dealt": bytes([0,4,8,12,16,20]),
                "left_keep": bytes([0,4,8,12]), "peg_sequence": b""}
        self.assertEqual(len(builder.observations(hand, 0)), 1)
        hand["left_keep"] = bytes([0,4,8])
        with self.assertRaises(ValueError):
            builder.observations(hand, 0)

    def test_native_play_table_and_reserved_seed_are_respected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "games.db"
            db = create_database(path)
            db.execute("ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB")
            db.execute("CREATE TABLE compact_peg_plays (game_id TEXT,hand_number INTEGER,sequence INTEGER,action INTEGER,player INTEGER,card INTEGER)")
            add_game(db, "native", 0, left="9.11", right="9.1")
            add_game(db, "reserved", 1)
            db.execute("INSERT INTO compact_peg_plays VALUES ('native',1,0,0,0,0)")
            db.execute("INSERT INTO compact_peg_plays VALUES ('native',1,1,1,1,NULL)")
            db.commit()
            db.close()
            value = builder.empty_evidence()
            value["reservedValidationSeeds"] = ["1"]
            builder.import_database(value, path)
            self.assertEqual(len(value["games"]), 1)
            rows = value["updatesByModel"]["schell_table-peg_table-9.11"]["dealer"]
            self.assertEqual(sum(rows["1000000000000"].values()), 1)
            self.assertEqual(value["sources"][-1]["statistics"]["reservedValidationGames"], 1)

    def test_reused_historical_run_ids_are_distinguished_by_actor_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            value = builder.empty_evidence()
            for version in ("16.0", "16.1"):
                path = Path(directory) / (version + ".db")
                db = create_database(path)
                db.execute("ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB")
                add_game(db, "historically-reused-id", 0, left="13.0", right=version)
                db.close()
                builder.import_database(value, path)
            self.assertEqual(len(value["games"]), 2)
            self.assertEqual(set(value["updatesByModel"]), {"schell_table-peg_table-13.0"})
            self.assertEqual(sum(value["updatesByModel"]["schell_table-peg_table-13.0"]["dealer"][builder.ZERO].values()), 2)


if __name__ == "__main__":
    unittest.main()
