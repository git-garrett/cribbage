import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import prepare


class HalfSourceTest(unittest.TestCase):
    def test_native_half_source_and_frozen_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'source'
            prepare.generate(out)
            for path in out.rglob('*.rs'):
                if path.name == 'fp16.rs' or 'vendor' in path.parts:
                    continue
                self.assertNotRegex(path.read_text(), r'\bf(?:32|64)\b|\d_?f(?:32|64)\b', str(path))
            self.assertIn('std::mem::size_of::<f16>() * 8', (out / 'bin/decision-worker.rs').read_text())
            self.assertIn('ratio(*weight as u128 * 16, scale as u128)', (out / 'model91.rs').read_text())
            self.assertIn('ratio(row.moments.my_weighted_points as u128, total_weight)', (out / 'model.rs').read_text())
            self.assertIn('!expected.is_finite()', (out / 'model203_discards.rs').read_text())
            self.assertNotIn('4096.0 * f16::EPSILON', (out / 'model283_counting.rs').read_text())
            hashes = json.loads((out / 'precision-manifest.json').read_text())
            for name, expected in hashes.items():
                self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), expected, name)


if __name__ == '__main__':
    unittest.main()
