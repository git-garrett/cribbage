import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import prepare
from run import missing_ranges


class ExperimentTest(unittest.TestCase):
    def test_resume_preserves_out_of_order_commits(self):
        self.assertEqual(missing_ranges([0, 2, 3, 6], 8), [[1, 2], [4, 6], [7, 8]])
        self.assertEqual(missing_ranges(range(8), 8), [])

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
