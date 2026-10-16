import json
from pathlib import Path
import random
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from benchmark_workbench_comparisons import ASSETS
from benchmark_workbench_evolution import (
    _evolution_report, checkpoint_evidence, evolving_bounds, evolution_report)


class EvolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'assessments').mkdir()
        self.original = self.root/'original'
        self.manifest(self.original, 0)
        with sqlite3.connect(self.root/'evidence.db') as db:
            db.execute('create table results(id text primary key,request text,root text,result text)')
        checkpoint_evidence.cache_clear(); _evolution_report.cache_clear()

    def manifest(self, root, generation):
        (root/ASSETS).mkdir(parents=True, exist_ok=True)
        (root/ASSETS/'model29-generation.json').write_text(json.dumps(
            dict(generation=generation, policy=dict(sourceRevision='test',binarySha256='binary'))))

    def panel(self, epoch, outcomes=None, seed=None, original=None):
        checkpoint = 5000*epoch; candidate = self.root/f'candidate-{epoch}'
        self.manifest(candidate, epoch*30-1)
        receipt = dict(status='complete', trainingGames=checkpoint, root=str(candidate),
                       baseline=str(original or self.original), games=1000, assessment=dict(pairs=500))
        (self.root/'assessments'/f'{checkpoint:09d}.json').write_text(json.dumps(receipt))
        outcomes = outcomes or [2]*40+[1]*435+[0]*25
        with sqlite3.connect(self.root/'evidence.db') as db:
            for index, wins in enumerate(outcomes):
                for side in (0, 1):
                    winner = side if wins == 2 or (wins == 1 and side == 0) else 1-side
                    g = dict(model='29.0', seed=(epoch*10000 if seed is None else seed)+index,
                             firstDealer=index%2, candidateSide=side, trajectory=False,
                             start=[0,0], scores=[121,80] if winner == 0 else [80,121],
                             winner=winner, seconds=1, hands='Do not decode scoring or decision arrays')
                    request = dict(kind='game',seed=g['seed'],firstDealer=g['firstDealer'],
                                   candidateSide=side,scores=[0,0])
                    db.execute('insert into results values(?,?,?,?)',
                        (f'eval:checkpoint:{checkpoint}:{index}:{side}',json.dumps(request),str(candidate),json.dumps(g)))

    def test_accumulates_fresh_pairs_across_changed_states_without_reset_or_extra_games(self):
        self.panel(1)
        first = evolution_report(self.root)
        self.assertEqual(first['latest']['winRate'], .515)
        self.panel(2, [2]*100+[1]*375+[0]*25)
        result = evolution_report(self.root)
        self.assertEqual(result['latest']['winRate'], .545)
        self.assertEqual(result['latest']['games'], 2000)
        self.assertEqual(result['latest']['pairs'], 1000)
        self.assertEqual(result['integrity']['uniqueSeeds'], 1000)
        self.assertEqual(result['history'][0], first['latest'])
        self.assertEqual(result['latest']['confidence95'], evolving_bounds([50,810,140]))
        with patch('sqlite3.connect',side_effect=AssertionError('Repeated view must not read games')):
            self.assertEqual(evolution_report(self.root), result)
        with sqlite3.connect(self.root/'evidence.db') as db:
            self.assertEqual(db.execute('select count(*) from results').fetchone()[0], 2000)

    def test_no_completed_panel_is_pending_without_database_read(self):
        with patch('sqlite3.connect',side_effect=AssertionError('No games to read')):
            result = evolution_report(self.root)
        self.assertEqual(result['status'], 'pending'); self.assertIsNone(result['latest'])

    def test_no_silent_skipping_reuse_or_partial_pairs(self):
        self.panel(1); self.panel(2,seed=10000)
        with self.assertRaisesRegex(ValueError,'Repeated evaluation seeds'): evolution_report(self.root)
        (self.root/'assessments/000005000.json').unlink()
        with self.assertRaisesRegex(ValueError,'Missing or out-of-order'): evolution_report(self.root)

    def test_changed_original_and_incomplete_orientation_fail_closed(self):
        self.panel(1)
        different = self.root/'changed-original'; self.manifest(different, 1)
        self.panel(2,original=different)
        with self.assertRaisesRegex(ValueError,'Original opponent changed'): evolution_report(self.root)
        (self.root/'assessments/000010000.json').unlink()
        with sqlite3.connect(self.root/'evidence.db') as db:
            db.execute("delete from results where id='eval:checkpoint:5000:499:1'")
        checkpoint_evidence.cache_clear()
        with self.assertRaisesRegex(ValueError,'Missing comparison game indexes'): evolution_report(self.root)

    def test_pending_next_checkpoint_does_not_enter_the_cumulative_sample(self):
        self.panel(1); self.panel(2)
        (self.root/'assessments/000010000.json').unlink()
        result = evolution_report(self.root)
        self.assertEqual(result['latest']['games'], 1000)

    def test_all_receipts_count_beyond_the_workbench_rolling_history(self):
        for epoch in range(1,63):
            (self.root/'assessments'/f'{epoch*5000:09d}.json').write_text('{}')
        def evidence(root, checkpoint, text):
            return dict(seeds=list(range(checkpoint,checkpoint+500)), counts=[25,435,40],
                        generation=checkpoint, originalSnapshot='original')
        with patch('benchmark_workbench_evolution.checkpoint_evidence',side_effect=evidence):
            result = evolution_report(self.root)
        self.assertEqual(result['latest']['games'], 62000)
        self.assertEqual(result['latest']['checkpoints'], 62)

    def test_reciprocal_deal_mismatch_is_rejected(self):
        self.panel(1)
        with sqlite3.connect(self.root/'evidence.db') as db:
            for column in ('request','result'):
                db.execute(f"update results set {column}=json_set({column},'$.seed',999) where id='eval:checkpoint:5000:0:1'")
        with self.assertRaisesRegex(ValueError,'Reciprocal seed'): evolution_report(self.root)


class EvolvingBoundsTests(unittest.TestCase):
    def test_changing_performance_can_reverse_an_earlier_superiority_result(self):
        self.assertGreater(evolving_bounds([0,0,500])[0], .5)
        self.assertLess(evolving_bounds([1000,0,500])[1], .5)
        self.assertEqual(evolving_bounds([0,0,0]), [0,1])

    def test_pairs_and_repeated_evidence_control_precision(self):
        lo, hi = evolving_bounds([25,435,40])
        self.assertAlmostEqual((lo+hi)/2, .515)
        self.assertGreater(hi-lo, .10)
        self.assertLess(evolving_bounds([250,4350,400])[1]-.515, hi-.515)
        self.assertLess(evolving_bounds([0,500,0])[0], .5)
        self.assertGreater(evolving_bounds([0,500,0])[1], .5)
        with self.assertRaises(ValueError): evolving_bounds([-1,500,1])

    def test_seeded_changing_mean_paths_respect_sequential_coverage(self):
        # Independent check of changing-target / repeated-look behavior, not a
        # proof of coverage (the cited theorem supplies that). Draw one bounded
        # pair observation at a time, with abrupt changes and adaptive means.
        rng = random.Random(7931); failures = 0
        for path in range(200):
            counts = [0,0,0]; expected = 0.; crossed = False
            for n in range(1,2001):
                p = (.7 if n <= 1000 else .3) if path%2 else (.6 if counts[2] <= counts[0] else .4)
                expected += p
                counts[2 if rng.random() < p else 0] += 1
                if n%25 == 0:
                    low,high = evolving_bounds(counts)
                    crossed |= not low <= expected/n <= high
            failures += crossed
        self.assertLessEqual(failures, 10)


if __name__ == '__main__': unittest.main()
