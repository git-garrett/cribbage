"""Handoff, recovery, storage and resource tests without a GPU dependency."""
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import hybrid as h
import selfplay as sp
import install as deployment

HERE = Path(__file__).resolve().parent


class HybridTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = {str(n): dict(round=7, cursors=[10, 11, 12, 13]) for n in [31, 32]}

    def test_recovery_keeps_model_and_sequences_then_alternates(self):
        first = h.begin(self.root, self.state)
        self.assertEqual(first, h.begin(self.root, self.state))
        self.assertEqual(first['model'], 31)
        h.save(Path(first['folder']) / 'receipt.json', dict(status='complete', identity=first, cursors=first['cursors']))
        h.finish(self.root, first)
        second = h.begin(self.root, self.state)
        self.assertEqual((second['model'], second['sequence']), (32, 1))
        h.save(Path(second['folder']) / 'receipt.json', dict(status='complete', identity=second, cursors=[0] * 4))
        with self.assertRaises(AssertionError):
            h.finish(self.root, second)
        self.assertEqual(h.pending(self.root), second)

    def test_latest_selfplay_is_visible_to_ace_and_checkpoint_readers(self):
        old = self.root / 'old'
        h.save(self.root / 'model32/model32-round-7.json', dict(checkpoint=str(old)))
        self.assertEqual(h.latest32(self.root, 7), old)
        new = self.root / 'selfplay'
        h.publish32(self.root, 7, new, 'self-play')
        self.assertEqual(h.latest32(self.root, 7), new)
        with self.assertRaises(AssertionError):
            h.latest32(self.root, 8)
        h.publish32(self.root, 8, self.root / 'ace', 'ace')
        self.assertEqual(h.latest32(self.root, 8), self.root / 'ace')

    def test_cpu_budget_adapts_to_hardware_pressure_swap_and_heat(self):
        def sample(at=0, pressure=1, swap=0, thermal=0):
            return dict(time=at, pressure=pressure, Swapouts=swap, thermal=thermal)
        self.assertEqual(h.worker_limit([sample()], 12), 11)
        self.assertEqual(h.worker_limit([sample()], 24), 23)
        self.assertEqual(h.worker_limit([sample()], 2), 1)
        self.assertEqual(h.worker_limit([sample(pressure=2)], 12), 4)
        self.assertEqual(h.worker_limit([sample(), sample(10, swap=65 * 2**20)], 12), 2)
        self.assertEqual(h.worker_limit([sample(pressure=4)], 12), 0)
        self.assertEqual(h.worker_limit([sample(thermal=2)], 12), 0)
        self.assertEqual(h.worker_limit([sample(pressure=2), sample(10)], 12), 4)

    def test_native_cpu_limit_negotiation_handles_old_and_new_binaries(self):
        def backend(limit):
            def call(value):
                self.assertEqual(value['ids'], [])
                if value['workers'] > limit:
                    raise RuntimeError({'error': 'invalid teacher workers', 'ok': False})
                return {'labels': []}
            return call
        self.assertEqual(h.native_worker_limit(backend(8), 11), 8)
        self.assertEqual(h.native_worker_limit(backend(12), 11), 11)
        with self.assertRaisesRegex(RuntimeError, 'worker exited'):
            h.native_worker_limit(lambda _: (_ for _ in ()).throw(RuntimeError('native worker exited')), 11)

    def test_failed_training_restart_still_resumes_collector(self):
        jobs = [dict(name='gpu', flag='STOP-TRAIN', receipt='gpu-stopped.json'),
                dict(name='ace', flag='STOP-COLLECT', receipt='collector-stopped.json')]
        for job in jobs:
            h.save(self.root / (job['name'] + '.json'), dict(jobId=job['name'], jobRoot=str(self.root / job['name'])))
            (self.root / job['flag']).touch()
        with patch.object(deployment, 'SETUP', self.root), patch.object(deployment.shutil, 'copy2'), \
             patch.object(deployment.subprocess, 'run', side_effect=[RuntimeError('launchd failed'), None]) as restart:
            with self.assertRaises(RuntimeError):
                deployment.restart_jobs(self.root, self.root / 'runner.py', jobs)
        self.assertEqual(restart.call_count, 2)
        self.assertFalse((self.root / 'STOP-TRAIN').exists())
        self.assertFalse((self.root / 'STOP-COLLECT').exists())
        self.assertEqual(h.read(self.root / 'restart-errors.json')['errors'][0]['job'], 'gpu')

    def test_atomic_worker_claim_uses_latest_other_jobs_and_releases_only_ours(self):
        ledger = self.root / 'cpus.json'
        h.save(ledger, dict(workers=9, allocations={'other': 9}))
        with h.reserve_workers(ledger, 'ace', 11, 12) as workers:
            self.assertEqual(workers, 2)
            data = h.read(ledger)
            self.assertEqual(data['workers'], 11)
            data['allocations']['gpu'] = 1
            data['workers'] = 12
            h.save(ledger, data)
        self.assertEqual(h.read(ledger)['allocations'], {'other': 9, 'gpu': 1})
        self.assertEqual(h.read(ledger)['workers'], 10)
        h.save(ledger, dict(workers=2, allocations={'user-workday-headroom': 1, 'gpu': 1}))
        with h.reserve_workers(ledger, 'ace', 11, 12) as workers:
            self.assertEqual(workers, 10, 'Do not double-reserve foreground headroom')
        h.save(ledger, dict(workers=11, allocations={'other': 11}))
        with h.reserve_workers(ledger, 'ace', 11, 12) as workers:
            self.assertEqual(workers, 0)
        h.save(ledger, dict(workers=1, allocations={'ace-0': 1}))
        with self.assertRaises(AssertionError):
            with h.reserve_workers(ledger, 'ace', 11, 12):
                self.fail('duplicate ownership must fail')
        self.assertEqual(h.read(ledger)['allocations'], {'ace-0': 1})

    def test_archive_verification_and_restart_after_output_move(self):
        active = h.begin(self.root, self.state)
        work = Path(active['folder']);work.mkdir(parents=True)
        output = work / 'round-1';output.mkdir()
        (output / 'weights.npz').write_bytes(b'new weights')
        h.save(output / 'ace-teacher-state.json', dict(cursor=active['cursors']))
        h.save(self.root / 'config.json', dict(archive=str(self.root / 'archive')))
        (self.root / 'model31/data').mkdir(parents=True)
        (work / 'trace.bin').write_bytes(b'complete games')
        old_working = self.root / 'model31/data/checkpoint-previous-ace'
        old_working.mkdir()
        (old_working / 'old.npz').write_bytes(b'old working state')
        anchor = self.root / 'model31/data/round-7-checkpoint'
        anchor.mkdir()
        manifest = dict(identity=active, settings=dict(gamesPerPhase=4), source=str(old_working))
        h.save(work / 'trained.json', dict(output=str(output), files=sp.files(output)))
        dest = sp.archive(self.root, work, manifest)
        self.assertTrue((dest / 'trace.bin').exists())
        self.assertFalse((dest / 'round-1').exists())
        target = self.root / 'model31/data/selfplay-00000001'
        output.rename(target)  # crash after moving weights, before pointer
        result = sp.publish(self.root, work, manifest, target)
        self.assertEqual(h.read(self.root / 'model31/data/current.json')['folder'], target.name)
        sp.cleanup(work, result)
        self.assertFalse(old_working.exists())
        self.assertTrue(anchor.exists())
        with patch.object(sp, 'prepare', side_effect=AssertionError('must not relearn')):
            self.assertEqual(sp.run(self.root), result)
        h.finish(self.root, active)

    def test_reserved_seed_pool_slices_do_not_overlap_or_change_on_restart(self):
        runtimes = self.root / 'runtimes'
        root = runtimes / 'training'
        h.save(root / 'checkpoint-config.json', dict(runtimes=str(runtimes), python='python', repo='repo', historicalSeeds='seeds'))
        size = 2 * 32 * 4096
        reservation = dict(selfplay=[1_000_000, 1_000_000 + size - 1])
        with patch.object(sp.subprocess, 'check_output', return_value=json.dumps(reservation)) as allocate:
            first = sp.reserve(root, dict(model=31, sequence=1), 32)
            self.assertEqual(allocate.call_count, 1)
        h.save(runtimes / 'coordination/ordered-outcome-seed-reservations.json',
               [dict(root=first['reservation'], ranges=reservation)])
        with patch.object(sp.subprocess, 'check_output', side_effect=AssertionError('must reuse reservation')):
            repeated = sp.reserve(root, dict(model=31, sequence=1), 32)
            second = sp.reserve(root, dict(model=31, sequence=2), 32)
            last = sp.reserve(root, dict(model=31, sequence=4096), 32)
        self.assertEqual(first, repeated)
        self.assertEqual(first['selfplay'][1] + 1, second['selfplay'][0])
        self.assertEqual(last['selfplay'][1], reservation['selfplay'][1])
        self.assertLess(second['selfplay'][1], last['selfplay'][0])

    def test_coordinator_prefers_ace_then_alternates_selfplay(self):
        root = self.root
        for name in ['train.py', 'hybrid.py']:
            shutil.copy2(HERE / name, root / name)
        source = root / 'model31/source';source.mkdir(parents=True)
        (source / 'scaling_data.py').write_text('from hybrid import save\n')
        (root / 'checkpoints.py').write_text('def maybe_checkpoint(*args): pass\n')
        for model in [31, 32]:
            (root / f'model{model}/data').mkdir(parents=True, exist_ok=True)
            (root / f'model{model}/train.py').write_text('''import sys
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1]).parent))
from hybrid import read,save
r=Path(sys.argv[1]);n=int(sys.argv[2]);m=int(r.name[5:]);b=r.parent
with (b/'events.txt').open('a') as f:f.write('ace-'+str(m)+'\\n')
prefix='round-' if m==31 else 'model32-round-'
save(r/(prefix+str(n)+'.json'),dict(status='complete',cursors=[20]*4,checkpoint=str(r/'new')))
if m==31:save(r/'data/current.json',dict(round=n,folder='new'))
''')
        h.save(root / 'model31/data/current.json', dict(round=7, folder='old'))
        h.save(root / 'gpu-state.json', self.state)
        h.save(root / 'config.json', dict(start32=7, teacherIdentity='teacher', trainingBatch=dict(labelsPerRole=2, minimumLabels=2), selfPlay=dict(enabled=True)))
        teacher = root / 'teacher';teacher.mkdir()
        with sqlite3.connect(teacher / 'labels.sqlite') as db:
            db.execute('CREATE TABLE labels(role INTEGER, split INTEGER, payload TEXT)')
            for i in range(16):
                db.execute('INSERT INTO labels VALUES(0,0,?)', (json.dumps(dict(split=0, teacherIdentity='teacher', action=1, legal=[1, 2])),))
        (root / 'selfplay.py').write_text('''from pathlib import Path
import sys
from hybrid import pending,save
r=Path(sys.argv[1]);active=pending(r)
with (r/'events.txt').open('a') as f:f.write('selfplay-'+str(active['model'])+'\\n')
save(Path(active['folder'])/'receipt.json',dict(status='complete',identity=active,cursors=active['cursors']))
if active['model']==32:(r/'STOP-TRAIN').touch()
''')
        subprocess.run([sys.executable, str(root / 'train.py')], check=True, timeout=10, capture_output=True, text=True)
        self.assertEqual((root / 'events.txt').read_text().splitlines(), ['ace-32', 'ace-31', 'selfplay-31', 'selfplay-32'])
        self.assertEqual(h.read(root / 'gpu-state.json')['31']['round'], 8)
        self.assertIsNone(h.pending(root))


if __name__ == '__main__':
    unittest.main()
