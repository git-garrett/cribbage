import copy
import gzip
import json
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model203_crib as builder
from test_build_model20_discard_evidence import create_database
from test_build_model203_hold import add_game


class CribTests(unittest.TestCase):
    def test_physical_prior_has_complete_support_and_yields_to_observations(self):
        empty = builder.probabilities({}, 100)
        pair, distinct = '2000000000000', '1100000000000'
        self.assertEqual(len(empty), 91)
        self.assertAlmostEqual(sum(empty.values()), 1)
        self.assertAlmostEqual(empty[pair], 6/1326)
        self.assertAlmostEqual(empty[distinct], 16/1326)
        small = builder.probabilities({pair: 10}, 100)
        large = builder.probabilities({pair: 10000}, 100)
        self.assertTrue(all(v > 0 for v in large.values()))
        self.assertGreater(large[pair], small[pair])
        self.assertLess(large[distinct], small[distinct])

    def test_baseline_counts_are_recovered_once_with_correct_actor_role(self):
        value = builder.bootstrap()
        self.assertEqual(sum(value['baselineCounts']['pone'].values()), 358676)
        self.assertEqual(value['baselineCounts']['pone']['0000200000000'], 67)
        self.assertEqual(sum(value['baselineCounts']['dealer'].values()), 358676)
        builder.validate(value)
        for engine in ('15.2', '16.3', '20.3-alias'):
            bad = copy.deepcopy(value)
            bad['countsByModel']['schell_table-peg_table-' + engine] = {}
            with self.assertRaisesRegex(ValueError, 'ineligible'):
                builder.validate(bad)
        bad = copy.deepcopy(value)
        bad['baselineCounts']['dealer']['2000000000000'] += 1
        with self.assertRaisesRegex(ValueError, 'historical evidence changed'):
            builder.validate(bad)

    def test_import_is_incremental_actor_specific_and_preserves_reservations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'games.db'
            db = create_database(path)
            add_game(db, 'good', 0, left='9.11', right='20.2')
            add_game(db, 'mixed', 1, left='13.23', right='15.2')
            add_game(db, 'excluded', 2, left='16.1', right='15.2')
            add_game(db, 'partial', 3, complete=False)
            add_game(db, 'reserved', 4)
            add_game(db, 'old', 5)
            db.execute("UPDATE compact_games SET ended_at='2026-06-14T00:00:00Z' WHERE game_id='old'")
            db.commit();db.close()
            value = builder.bootstrap();value['reservedValidationSeeds'] = ['4']
            builder.import_database(value, path)
            self.assertEqual(len(value['games']), 2)
            stats = value['sources'][-1]['statistics']
            self.assertEqual(stats['discardsAdded'], 3)
            self.assertEqual(stats['reservedValidationGames'], 1)
            self.assertEqual(stats['historicalOverlapSkipped'], 1)
            self.assertTrue(all(builder.eligible(m) for m in value['countsByModel']))
            before = copy.deepcopy(value)
            builder.import_database(value, path)
            self.assertEqual(value, before)
            db = sqlite3.connect(path)
            add_game(db, 'replay', 6, left='9.11', right='20.2', seed=0)
            db.close()
            builder.import_database(value, path)
            self.assertEqual(len(value['games']), 2)
            self.assertEqual(value['sources'][-1]['statistics']['duplicateGames'], 3)
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET final_right_score=99 WHERE game_id='good'")
            db.commit();db.close()
            with self.assertRaisesRegex(ValueError, 'conflicting completed game'):
                builder.import_database(value, path)

    def test_invalid_cards_do_not_become_observations(self):
        hand = {'dealer': 0, 'left_dealt': bytes([0,4,8,12,16,20]), 'left_keep': bytes([0,4,8,12])}
        self.assertEqual(builder.actor_discard(hand, 0), ('dealer', '0000110000000'))
        for keep in (bytes([0,0,8,12]), bytes([0,4,8,51]), bytes([0,4,8])):
            hand['left_keep'] = keep
            with self.assertRaises(ValueError):builder.actor_discard(hand, 0)

    def test_installed_asset_is_reproducible_and_evidence_remains_raw(self):
        value = json.loads(gzip.decompress(builder.EVIDENCE.read_bytes()))
        builder.validate(value)
        calibration = json.loads(builder.CALIBRATION.read_bytes())
        packed, metadata = builder.pack(value, calibration)
        self.assertEqual(packed, builder.OUTPUT.read_bytes())
        self.assertEqual(packed[:8], b'M203CR01')
        self.assertEqual(struct.unpack_from('<4I', packed, 8), (1,2,91,13))
        self.assertEqual(sum(metadata['observationsByRole'].values()),
                         717352 + sum(metadata['observationsByModel'].values()))
        self.assertEqual(len(value['reservedValidationSeeds']), 1000)
        reserved = set(value['reservedValidationSeeds'])
        self.assertTrue(all(str(g['seed']) not in reserved for s in value['sources'] for g in s['includedGames']))
        self.assertEqual(sum(score == 255 for score in builder.score_cube()), 13)


if __name__ == '__main__':unittest.main()
