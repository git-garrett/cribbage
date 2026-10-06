import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import prepare


class MixedSourceTest(unittest.TestCase):
    def test_half_assets_with_single_precision_policy_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'source'
            prepare.generate(out)
            for path in out.rglob('*.rs'):
                if path.name in ('fp16.rs', 'lib.rs'):
                    continue
                self.assertNotRegex(path.read_text(), r'\bf16\b|\d_?f16\b', str(path))
                self.assertNotRegex(path.read_text(), r'\bf64\b|\d_?f64\b', str(path))
            worker = (out / 'bin/decision-worker.rs').read_text()
            self.assertIn('std::mem::size_of::<f32>() * 8', worker)
            self.assertIn('response["assetBits"] = json!(16)', worker)
            self.assertIn('*weight as f32', (out / 'model91.rs').read_text())
            self.assertIn('row.moments.my_weighted_points as f32 / total_weight', (out / 'model.rs').read_text())
            self.assertIn('4096.0 * f32::EPSILON', (out / 'model283_counting.rs').read_text())
            self.assertIn('points / total * 100_000.0', (out / 'model203_crib.rs').read_text())
            self.assertIn('crate::fp16::decode_le(bytes)', (out / 'fp32.rs').read_text())
            self.assertIn('.as_f64().map(crate::fp16::round64)', (out / 'model203_discards.rs').read_text())
            self.assertNotIn('[patch.crates-io]', (out / 'Cargo.toml').read_text())
            hashes = json.loads((out / 'precision-manifest.json').read_text())
            for name, expected in hashes.items():
                self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), expected, name)


if __name__ == '__main__':
    unittest.main()
