import copy
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model203_suit_evidence as builder
from test_build_model20_discard_evidence import create_database, add_game

ASSETS = Path(__file__).resolve().parents[1] / 'rust/cribbage-shadow-engine/assets'


class SuitEvidenceTests(unittest.TestCase):
    def test_incremental_import_is_deduplicated_and_excludes_defunct_actors_and_old_games(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'games.db'
            db = create_database(path)
            add_game(db, 'accepted', 0)
            add_game(db, 'partial', 1, complete=False)
            add_game(db, 'excluded', 2, left='15.2', right='16.1')
            add_game(db, 'mixed', 3, left='13.23', right='15.1')
            add_game(db, 'old', 4, ended=builder.CUTOFF)
            db.close()
            value = builder.empty(ASSETS / 'model20-opponent-discards.bin')
            baseline = copy.deepcopy(value['baseline'])
            builder.ingest(value, path)
            self.assertEqual(len(value['games']), 2)
            self.assertEqual(sum(builder.counts(value, p)[:,:,0].sum() for p in ('train','tune','test')), 3)
            all_counts = sum(builder.counts(value, p) for p in ('train','tune','test'))
            # Compact card IDs are rank-major: right player's two discards
            # (36,40) share suit zero; left player's (16,17) have equal ranks.
            self.assertEqual(int(all_counts[0,:,1].sum()), 0)
            self.assertEqual(int(all_counts[1,:,1].sum()), 1)
            self.assertEqual([g['gameIndex'] for g in value['sources'][0]['includedGames']], [0,3])
            for game in value['sources'][0]['includedGames']:
                self.assertEqual(game['partition'], builder.split(game['seed']))
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET winner=0,final_left_score=121 WHERE game_id='partial'")
            add_game(db, 'replay', 5, seed=0)
            db.close()
            builder.ingest(value, path)
            self.assertEqual(len(value['games']), 3)
            self.assertEqual(value['sources'][-1]['statistics']['duplicateGames'], 3)
            unchanged = copy.deepcopy(value)
            builder.ingest(value, path)
            self.assertEqual(value, unchanged)
            self.assertEqual(value['baseline'], baseline)
            db = sqlite3.connect(path)
            db.execute("UPDATE compact_games SET final_right_score=89 WHERE game_id='accepted'")
            db.commit(); db.close()
            with self.assertRaisesRegex(ValueError, 'conflicting completed game'):
                builder.ingest(value, path)

    def test_beta_prior_preserves_structural_zeros_and_smooths_empty_and_zero_rows(self):
        n = np.zeros((91,2), dtype=np.int64)
        distinct = np.flatnonzero(builder.DISTINCT)
        n[distinct[0]] = [10,0]
        n[distinct[1]] = [100,30]
        p, mean = builder.rates(n, 5.)
        self.assertAlmostEqual(mean,31/114)
        self.assertAlmostEqual(p[distinct[0]],5*mean/15)
        self.assertAlmostEqual(p[distinct[2]],mean)
        self.assertTrue(np.all(p[builder.DISTINCT] > 0))
        self.assertTrue(np.all(p[~builder.DISTINCT] == 0))
        self.assertEqual(n[distinct[0]].tolist(),[10,0])

    def test_rejects_ineligible_or_impossible_retained_evidence(self):
        value = builder.empty(ASSETS / 'model20-opponent-discards.bin')
        value['counts']['train'] = {'schell_table-peg_table-15.2':np.zeros((2,91,2),dtype=np.int64).tolist()}
        with self.assertRaisesRegex(ValueError, 'ineligible inherited actor'):
            builder.validate(value)
        value['counts'] = {}
        value['baseline']['counts'][0][0] = [10,1] # KK cannot share a suit.
        with self.assertRaisesRegex(ValueError, 'invalid suit observation counts'):
            builder.validate(value)

    def test_repacking_suits_preserves_rank_probabilities_bit_for_bit(self):
        metadata, suits, ranks = builder.read_asset(ASSETS / 'model203-opponent-discards.bin')
        probabilities = np.frombuffer(ranks,dtype='<f8').reshape(2,1820,91)
        metadata['schemaVersion'] = 2
        packed = builder.pack(probabilities,suits,metadata)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'asset.bin'; path.write_bytes(packed)
            _, _, actual = builder.read_asset(path)
            self.assertEqual(actual,ranks)


if __name__ == '__main__': unittest.main()
