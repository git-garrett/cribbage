import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark_workbench import job_entry, job_status, register
from benchmark_workbench_training import build_training_report


class TrainingWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spec = self.root / 'workbench.json'
        self.save('workbench.json', dict(jobId='training-test', jobRoot=str(self.root / 'job'),
            trainingStudy=dict(root=str(self.root), target=2, maxEpochs=32,
                stages=['fit', 'evaluate', 'sync'], architectures=[dict(hidden=[64, 64], parameters=91418)])))
        self.entry = job_entry(self.spec)
        self.trial = 'broad-64x64-n100-s1'
        self.history = [dict(epoch=1, validation={'28.3': dict(agreement=.7, crossEntropy=.5, decisions=30)})]
        self.row = dict(status='complete', id=self.trial, mode='broad', hidden=[64, 64], parameters=91418,
            positions=100, seed=1, chosenEpoch=1, lastEpoch=1, seconds=10,
            validation={'28.3': dict(agreement=.7, crossEntropy=.5)}, history=self.history)
        self.status = dict(state='running', stages=[dict(name='fit', state='running')])

    def save(self, name, value):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value)); return path

    def test_registration_observes_existing_supervisor_without_mutation(self):
        self.save('job/status.json', self.status)
        before = self.spec.read_bytes()
        entry = register(self.spec, self.root / 'ui')
        self.assertEqual(entry['kind'], 'training')
        self.assertEqual(job_status(entry), self.status)
        self.assertEqual(self.spec.read_bytes(), before)

    def test_current_epoch_curves_without_datasets_or_databases(self):
        self.save('training-progress.json', dict(trial=self.trial, epoch=1, bestEpoch=1, updatedAt=1000, natural283=dict(agreement=.7)))
        self.save(f'students/{self.trial}/checkpoint.json', dict(epoch=1, bestEpoch=1, history=self.history + [dict(self.history[0], epoch=2)]))
        with patch('sqlite3.connect', side_effect=AssertionError('No database access')):
            result = build_training_report(self.entry, self.status, now=1100)
        self.assertEqual(result['completed'], 0)
        self.assertEqual(result['current']['epoch'], 1)
        self.assertEqual(result['current']['parameters'], 91418)
        self.assertEqual(result['current']['history'][0]['agreement'], .7)
        self.assertEqual(len(result['current']['history']), 1)
        self.assertFalse(result['testAvailable'])
        self.assertFalse(result['playingStrengthMeasured'])

    def test_selection_by_loss_not_agreement_and_no_invented_test(self):
        self.save(f'students/{self.trial}/result.json', self.row)
        other = dict(self.row, id='broad-64x64-n100-s2', seed=2, validation={'28.3': dict(agreement=.8, crossEntropy=.6)})
        self.save(f"students/{other['id']}/result.json", other)
        result = build_training_report(self.entry, self.status)
        self.assertEqual(result['completed'], 2)
        self.assertEqual(result['preferred'], self.trial)
        self.assertFalse(result['selectionFrozen'])
        self.assertEqual(result['trials'][0]['test'], {})

    def test_finished_fits_are_not_overall_completion_and_test_preserves_selection(self):
        self.save('fit.json', dict(trials=[self.row], preferredByValidation=self.trial))
        self.save('training-progress.json', dict(trial=self.trial, epoch=1, updatedAt=1))
        self.save('results.json', dict(status='complete', trials=[dict(id=self.trial, test={'28.3': dict(agreement=.69)}, natural283Agreement95=[.65,.73])]))
        status = dict(state='running', stages=[dict(name='fit', state='complete'), dict(name='sync', state='running')])
        result = build_training_report(self.entry, status)
        self.assertIsNone(result['current']); self.assertEqual(result['state'], 'running')
        self.assertEqual(result['archive'], 'pending'); self.assertTrue(result['testAvailable'])
        self.assertEqual(result['preferred'], self.trial); self.assertEqual(result['trials'][0]['test95'], [.65,.73])
        self.assertEqual(result['trials'][0]['history'][0]['epoch'], 1)

    def test_all_curricula_and_stale_active_snapshot(self):
        for mode in ['broad', 'target-only', 'fine-tuned']:
            trial = f'{mode}-64x64-n100-s1'
            self.save('training-progress.json', dict(trial=trial, updatedAt=1))
            result = build_training_report(self.entry, self.status, now=1000)
            self.assertEqual(result['current']['mode'], mode)
            self.assertTrue(result['warnings'])

    def test_prepared_and_wrong_target(self):
        result = build_training_report(self.entry, {})
        self.assertEqual(result['state'], 'prepared'); self.assertEqual(result['completed'], 0)
        self.save('fit-progress.json', dict(target=999))
        with self.assertRaises(ValueError): build_training_report(self.entry, self.status)


if __name__ == '__main__': unittest.main()
