import hashlib
import json
from pathlib import Path
import struct
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import build_model283_opening_assets as build
import archive_model283_opening_assets as archiver
import receive_model283_opening as receive
from benchmark_confidence_stop import winner

POLICY = 'a' * 64
REL = 'cut11/pone0/dealer0-lead3.bin'


def shard(depth=2):
    body = b'opaque-native-verified-body'
    h = json.dumps(dict(format=4, policy=POLICY, cut=11, scores=[0, 0], lead=3,
                        dealerPlays=depth, rows=2, sha256=hashlib.sha256(body).hexdigest())).encode()
    return struct.pack('<I', len(h)) + h + body


class AssetPipelineTests(unittest.TestCase):
    def config(self, root):
        assets = root / 'assets'; assets.mkdir()
        binary = root / 'binary'; binary.write_bytes(b'unchanged builder')
        ranking = root / 'ranking.csv'; ranking.write_text('pone,dealer\n15,11\n')
        return dict(run=str(root/'run'), archive=str(root/'staging'), policy=POLICY,
                    binary=str(binary), assets=str(assets), ranking=str(ranking), maxWorkers=2,
                    maxChunks=3, frozen=dict(binary=build.sha(binary), ranking=build.sha(ranking), policy=POLICY, assets={}))

    def fake_build(self, config, index, coord):
        path = Path(config['run']) / 'pending' / str(index); path.mkdir(parents=True, exist_ok=True)
        value = dict(index=index, relative=f'cut0/pone0/dealer0-lead{index}.bin', elapsed=1.0)
        for kind in ('full', 'production'):
            output = path/kind; output.write_bytes(f'{kind}:{index}'.encode())
            value[kind] = dict(path=str(output), sha256=build.sha(output), bytes=output.stat().st_size, policy=POLICY)
        return value

    def test_resume_preserves_receipts_and_fills_holes_with_incremental_totals(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); config = self.config(root)
            with patch.object(build, 'build', side_effect=self.fake_build), patch.object(build, 'memory_slots', return_value=2):
                build.run(config)
            with sqlite3.connect(root/'run/queue.db') as db:
                expected = dict(db.execute('SELECT id,receipt FROM completed WHERE id != 1'))
                db.execute('DELETE FROM completed WHERE id=1')
            config['maxChunks'] = 5
            with patch.object(build, 'build', side_effect=self.fake_build) as worker, patch.object(build, 'memory_slots', return_value=2):
                build.run(config)
            self.assertEqual(sorted(call.args[1] for call in worker.call_args_list), [1, 3, 4])
            with sqlite3.connect(root/'run/queue.db') as db:
                actual = dict(db.execute('SELECT id,receipt FROM completed'))
                totals = db.execute('SELECT SUM(full_bytes),SUM(shallow_bytes) FROM completed').fetchone()
            self.assertTrue(all(actual[i] == raw for i, raw in expected.items()))
            p = json.loads((root/'run/progress.json').read_text())
            self.assertEqual((p['completed'], p['total'], p['contiguousCompleted']), (5, 5, 5))
            self.assertEqual((p['fullBytes'], p['shallowBytes']), totals)
            self.assertEqual(p['published'], 0)
            self.assertEqual(p['scheduling'], 'normal')
            self.assertEqual(p['status'], 'complete')

    def test_storage_wait_preserves_work_and_resumes_when_space_returns(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); config = self.config(root)
            # Initial telemetry, then a low-disk iteration, then sufficient space.
            disks = iter([SimpleNamespace(free=50*1024**3), SimpleNamespace(free=1)])
            disk = lambda *_: next(disks, SimpleNamespace(free=50*1024**3))
            with patch.object(build.shutil, 'disk_usage', side_effect=disk), patch.object(build.time, 'sleep') as sleep, patch.object(build, 'build', side_effect=self.fake_build), patch.object(build, 'memory_slots', return_value=2):
                build.run(config)
            sleep.assert_called()
            self.assertEqual(json.loads((root/'run/complete.json').read_text())['completed'], 3)

    def test_foreground_archive_releases_only_after_durable_verified_copy(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); config = self.config(root)
            with patch.object(build, 'build', side_effect=self.fake_build), patch.object(build, 'memory_slots', return_value=2): build.run(config)
            target = root/'external'
            with patch.object(archiver, 'sync_directory', side_effect=OSError('directory flush failed')):
                with self.assertRaises(OSError): archiver.archive(config, target, release=True)
            self.assertTrue((root/'staging'/POLICY/'full/cut0/pone0/dealer0-lead0.bin').is_file())
            first = archiver.archive(config, target, release=True)
            self.assertEqual(first['completed'], 3)
            self.assertGreater(first['releasedBytes'], 0)
            self.assertTrue(Path(first['checkpoint']).is_file())
            self.assertEqual(list((root/'staging'/POLICY).glob('*/*/*.bin')), [])
            again = archiver.archive(config, target, release=True)
            self.assertEqual(again['releasedBytes'], 0)
            # New work is preserved if an archive conflict blocks the next snapshot.
            config['maxChunks'] = 4
            with patch.object(build, 'build', side_effect=self.fake_build), patch.object(build, 'memory_slots', return_value=2): build.run(config)
            next((target/POLICY/'full').rglob('*.bin')).write_bytes(b'corrupt')
            with self.assertRaises(ValueError): archiver.archive(config, target, release=True)
            self.assertTrue((root/'staging'/POLICY/'full/cut0/pone0/dealer0-lead3.bin').is_file())

    def test_canonical_domain_prioritizes_first_hands_and_excludes_only_impossible_jack_boards(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'ranking.csv'; path.write_text('pone,dealer\n15,11\n0,0\n')
            rows = list(build.coordinates(path))
            self.assertEqual(len(rows), 13*121*121-121*2)
            self.assertEqual(len(rows), len(set(rows)))
            self.assertEqual(rows[:13], [(c, 0, 2 if c == 10 else 0) for c in range(13)])
            self.assertEqual(rows[13:26], [(c, 15, 11) for c in range(13)])
            self.assertFalse(any(c == 10 and d < 2 for c, p, d in rows))

    def test_receiver_rejects_deep_wrong_context_and_corruption(self):
        receive.inspect_shard(shard(), POLICY, REL)
        for data, policy, relative in [(shard(4), POLICY, REL), (shard(), 'b'*64, REL),
                (shard() + b'x', POLICY, REL), (shard(), POLICY, '../outside.bin')]:
            with self.assertRaises(ValueError): receive.inspect_shard(data, policy, relative)

    def test_receiver_refuses_root_filesystem_and_publishes_immutable_chunk(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); data = shard(); digest = hashlib.sha256(data).hexdigest()
            with self.assertRaises(ValueError): receive.receive(root, POLICY, REL, digest, data)
            with patch.object(receive.os.path, 'ismount', return_value=True):
                result = receive.receive(root, POLICY, REL, digest, data)
                target = Path(result['path']); self.assertEqual(target.read_bytes(), data)
                receive.receive(root, POLICY, REL, digest, data)
                target.write_bytes(b'bad')
                with self.assertRaises(ValueError): receive.receive(root, POLICY, REL, digest, data)

    def test_archive_is_verified_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d)/'source'; dest = Path(d)/'archive'/'chunk'
            src.write_bytes(b'full evidence'); digest = build.sha(src)
            build.archive_file(src, dest, digest); build.archive_file(src, dest, digest)
            self.assertEqual(dest.read_bytes(), src.read_bytes())
            dest.write_bytes(b'changed')
            with self.assertRaises(ValueError): build.archive_file(src, dest, digest)

    def test_sequential_stopping_requires_integrity_order_and_strict_boundary(self):
        report = dict(integrity='passed', orderedPairs=100, latest=dict(pairs=100, anytime95=[.51, .55]))
        self.assertEqual(winner(report), 'candidate')
        report['latest']['anytime95'] = [.45, .49]; self.assertEqual(winner(report), 'opponent')
        report['latest']['anytime95'] = [.5, .55]; self.assertIsNone(winner(report))
        report['latest']['pairs'] = 99
        with self.assertRaises(ValueError): winner(report)
        report['integrity'] = 'failed'; self.assertIsNone(winner(report))


if __name__ == '__main__': unittest.main()
