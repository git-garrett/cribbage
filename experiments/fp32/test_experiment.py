import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import sqlite3
import prepare
import run
from run import missing_ranges


class ExperimentTest(unittest.TestCase):
    def test_resume_preserves_out_of_order_commits(self):
        self.assertEqual(missing_ranges([0, 2, 3, 6], 8), [[1, 2], [4, 6], [7, 8]])
        self.assertEqual(missing_ranges(range(8), 8), [])

    def test_report_uses_paired_game_timings_without_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            for orientation in range(2):
                folder = base / 'benchmark' / str(orientation)
                folder.mkdir(parents=True)
                with sqlite3.connect(folder / 'games.db') as db:
                    for table in ('compact_discards', 'compact_peg_plays'):
                        db.execute(f'CREATE TABLE {table}(player INTEGER, decision_elapsed_us INTEGER)')
                        db.executemany(f'INSERT INTO {table} VALUES (?,?)',
                                       [(1-orientation, 1000), (orientation, 2000)])
            rows = [[(0, 1, 1, 100, 121, 0), (1, 2, 0, 121, 110, 0)],
                    [(0, 1, 0, 121, 100, 0), (1, 2, 0, 121, 110, 0)]]
            with patch.object(run, 'BASE', base), patch.object(run, 'CONFIG', {'gamesPerOrientation': 2}), \
                    patch.object(run, 'validate_orientation', side_effect=rows):
                run.report()
            result = json.loads((base / 'report.json').read_text())
            self.assertEqual(result['f32WinRate'], .75)
            self.assertEqual(result['speed']['source'], 'live-games')
            overall = result['speed']['results']['overall']
            self.assertEqual(overall['f32']['decisions'], 4)
            self.assertEqual(overall['f32']['decisionMsPerGame'], 1)
            self.assertEqual(overall['perGameSpeedupF64OverF32'], 2)
            self.assertEqual(overall['perDecisionSpeedupF64OverF32'], 2)
            self.assertIn('FP64/FP32 2.000x', (base / 'report.txt').read_text())

    def test_fp16_timing_keys_and_configuration(self):
        with patch.object(run, 'CONFIG', {'candidateBits': 16}):
            self.assertEqual(run.candidate_bits(), 16)
        with patch.object(run, 'CONFIG', {'candidateBits': 8}):
            with self.assertRaises(ValueError): run.candidate_bits()
        timings = {f'f{bits}-{kind}': {'decisions': 10, 'wallUsIncludingIPC': bits * 1000}
                   for bits in (16,64) for kind in ('discard','peg')}
        result = run.live_speed(timings, 2, 16)
        self.assertEqual(result['results']['overall']['perGameSpeedupF64OverF16'], 4)
        self.assertNotIn('f32', result['results']['overall'])

    def test_mixed_worker_requires_both_precision_fields(self):
        worker = run.Worker.__new__(run.Worker)
        worker.precision = 32
        worker.process = Mock()
        config = {'candidateBits': 32, 'candidateAssetBits': 16}
        with patch.object(run, 'CONFIG', config):
            for response in ({'ok': True, 'arithmeticBits': 16, 'assetBits': 16},
                             {'ok': True, 'arithmeticBits': 32},
                             {'ok': True, 'arithmeticBits': 32, 'assetBits': 32}):
                worker.process.stdout.readline.return_value = json.dumps(response)
                with self.assertRaises(ValueError): worker.decide('{}')
            response = {'ok': True, 'arithmeticBits': 32, 'assetBits': 16}
            worker.process.stdout.readline.return_value = json.dumps(response)
            self.assertEqual(worker.decide('{}'), response)

    def test_generated_asset_reader_keeps_eight_byte_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'source'
            prepare.generate(out)
            self.assertIn('fn read_f64_le(bytes: &[u8], offset: usize) -> Result<f32', (out / 'artifacts.rs').read_text())
            self.assertIn('f64::from_le_bytes(bytes) as f32', (out / 'fp32.rs').read_text())
            manifest = json.loads((out / 'precision-manifest.json').read_text())
            for name, hashes in manifest.items():
                self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), hashes['generated'])
            for path in out.rglob('*.rs'):
                if path.name != 'fp32.rs':
                    self.assertNotRegex(path.read_text(), r'\bf64\b|\d_?f64\b')


if __name__ == '__main__':
    unittest.main()
