import copy
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model203_opponent_discards as b
from test_build_model20_discard_evidence import create_database, add_game


class ConditionalDiscardTests(unittest.TestCase):
    def test_seed_holdouts_survive_incremental_import_and_excluded_opponents(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'games.db'
            db = create_database(path)
            for seed in range(30):
                add_game(db, str(seed), seed, left='20.2', right='15.2', seed=seed)
            add_game(db, 'unfinished', 100, complete=False)
            db.close()
            value = b.empty()
            b.ingest(value, path)
            self.assertEqual(len(value['games']), 30)
            self.assertEqual(sum(b.counts(value, s).sum() for s in ('train','tune','test')), 30)
            self.assertTrue(all(h[1] == 'schell_table-peg_table-20.2' and b.split(h[0]) != 'train' for h in value['heldout']))
            original = copy.deepcopy(value['counts'])
            db = sqlite3.connect(path)
            add_game(db, 'replay', 200, left='20.2', right='15.2', seed=0)
            db.close()
            b.ingest(value, path)
            self.assertEqual(value['counts'], original)
            self.assertEqual(value['sources'][-1]['statistics']['duplicateGames'], 31)
            self.assertEqual({g['partition'] for g in value['sources'][0]['includedGames']}, {'train','tune','test'})

    def test_inherited_actor_validation_and_unknown_aliases(self):
        for version in ('15.0','15.2','16.1','9.0-crib148','unknown'):
            engine = 'schell_table-peg_table-' + version
            self.assertFalse(b.eligible(engine))
            value = b.empty(); value['counts']['train'] = {engine: {}}
            with self.assertRaises(ValueError): b.validate(value)

    def test_dirichlet_rows_keep_all_physical_support_and_data_dominates(self):
        n = b.np.zeros((1820,91))
        i = b.KI['0000211000000']
        pair = b.DI['0000000000002']
        n[i, pair] = 1000
        p = b.probabilities(n, 10.)
        self.assertTrue(b.np.all(p[b.LEGAL] > 0))
        self.assertFalse(b.np.any(p[~b.LEGAL]))
        self.assertTrue(b.np.allclose(p.sum(axis=1),1.))
        self.assertGreater(p[i,pair], .99)
        n[i,pair] += 1000
        self.assertGreater(b.probabilities(n,10.)[i,pair],p[i,pair])

    def test_packer_rejects_recreated_empirical_zeros(self):
        n = b.np.ones((1820,91))*b.LEGAL
        p = b.np.array([b.probabilities(n,10.)]*2)
        self.assertTrue(b.pack(p,b'',{'schemaVersion': 1})[:8] == b.MAGIC)
        p[0,0,2] = 0
        with self.assertRaises(ValueError): b.pack(p,b'',{})


if __name__ == '__main__': unittest.main()
