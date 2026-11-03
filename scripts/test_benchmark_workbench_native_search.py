import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from benchmark_workbench import job_entry, build_training_report, register
from benchmark_workbench_native_search import route_training_report


class NativeSearchWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = dict(model=32, widths=[1024, 512], rate=.0003, seed=1,
                           mixtures=8, auxiliary=1)
        self.spec = self.save('workbench.json', dict(jobId='native-model-32',
            jobRoot=str(self.root/'campaign-supervisor'),
            trainingStudy=dict(mode='native-search', model=32, target=24,
                               root=str(self.root/'train-32-seed-1'), campaignRoot=str(self.root))))
        self.entry = job_entry(self.spec)
        self.save('campaign-config.json', dict(gamesPerPhase=10, gameBatch=8))
        self.status = dict(state='running', stages=[dict(name='train-32-1-8', state='running')])

    def save(self, path, data):
        p = self.root/path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data))
        return p

    def round(self, folder, rid, seconds, win=.6):
        return self.save(f'{folder}/round-{rid:06d}/report.json', dict(status='complete',
            round=rid, seconds=seconds, evaluation=dict(status='complete', winRate=win,
            paired95=[win-.02, win+.02], pairs=500)))

    def test_continuations_include_inherited_time_without_merging_seeds(self):
        self.save('winner-32.json', dict(winner=dict(config=self.config, seconds=3600)))
        self.save('live-32-0/result.json', dict(config=self.config))
        self.round('live-32-0', 1, 3600, .61)
        self.round('train-32-seed-1', 2, 1800, .62)
        self.save('confirm-32.json', dict(config=dict(self.config, seed=2), seconds=7200))
        self.round('confirm-32', 1, 7200, .55)
        self.round('train-32-seed-2', 2, 3600, .56)
        report = build_training_report(self.entry, self.status)
        self.assertEqual([p['hours'] for p in report['seeds'][0]['history']], [1, 1.5])
        self.assertEqual([p['hours'] for p in report['seeds'][1]['history']], [2, 3])
        self.assertEqual(report['seeds'][1]['initializationSeed'], 2)
        self.assertEqual(report['seeds'][0]['history'][1]['phase'], 'Continued training')
        self.assertEqual(report['seeds'][1]['history'][0]['phase'], 'Independent confirmation')

    def test_registration_is_read_only_and_models_have_separate_visibility(self):
        before = self.spec.read_bytes()
        one = register(self.spec, self.root/'ui')
        cfg = json.loads(before)
        cfg['jobId'] = 'native-model-33'
        cfg['trainingStudy'].update(model=33, root=str(self.root/'train-33-seed-1'))
        two = register(self.save('model33.json', cfg), self.root/'ui')
        self.assertNotEqual(one['root'], two['root'])
        self.assertEqual(self.spec.read_bytes(), before)

    def test_active_phase_and_throughput_from_small_receipts(self):
        self.round('train-32-seed-1', 1, 10)
        self.save('train-32-seed-1/round-000001/allocation.json', dict(seconds=10))
        for phase, offset in [('explore', 0), ('explore', 8), ('greedy', 0)]:
            self.save(f'train-32-seed-1/round-000002/{phase}-{offset:06d}/complete.json', {})
        report = build_training_report(self.entry, self.status)
        self.assertEqual(report['pace']['gamesPerSecond'], 2)
        self.assertEqual(report['activity']['gamesCompleted'], 18)
        self.assertEqual(report['activity']['gamesPlanned'], 20)
        self.save('train-32-seed-1/current.json', dict(committedRound=2))
        report = build_training_report(self.entry, self.status)
        self.assertIn('evaluating', report['activity']['label'])
        self.status['stages'][-1]['name'] = 'train-33-1-8'
        self.assertIn('Waiting', build_training_report(self.entry, self.status)['activity']['label'])

    def test_validation_best_checkpoint_survives_partial_history_line(self):
        self.save('winner-32.json', dict(winner=dict(config=self.config)))
        self.save('search-32/trial-00/config.json', self.config)
        self.save('search-32/trial-00/best-validation.json', dict(seconds=30, metric=2.5))
        self.save('search-32/trial-00/current.json', dict(earlyStopped=True))
        p = self.root/'search-32/trial-00/validation-history.jsonl'
        p.write_text('{"seconds":30,"metric":2.5}\n{"seconds":60,"metric":2.7}\n{"seconds":')
        t = build_training_report(self.entry, self.status)['trials'][0]
        self.assertEqual(len(t['history']), 2)
        self.assertEqual(t['bestLoss'], 2.5)
        self.assertTrue(t['earlyStopped'])
        self.assertTrue(t['selected'])
        archived = self.root/'archive/trial-00/validation-history.jsonl'
        archived.parent.mkdir(parents=True)
        p.rename(archived)
        self.save('search-32/cold-archive.json', dict(archive=str(self.root/'archive')))
        self.assertEqual(build_training_report(self.entry, self.status)['trials'][0]['history'], t['history'])

    def test_missing_results_are_empty_and_existing_modes_delegate(self):
        report = build_training_report(self.entry, self.status)
        self.assertIsNone(report['pace'])
        self.assertEqual(report['seeds'][0]['history'], [])
        self.save('workbench.json', dict(trainingStudy=dict(mode='existing')))
        previous = Mock(return_value={'legacy': True})
        self.assertEqual(route_training_report(previous)(self.entry, self.status), {'legacy': True})
        previous.assert_called_once()


if __name__ == '__main__':
    unittest.main()
