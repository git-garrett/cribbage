import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scripts.prepare_model284_corrections import apportion, fnv, prepare, ROOT, SCALE


class PreparationTests(unittest.TestCase):
    def test_normalization_retains_positive_rare_support_and_exact_equal_mass(self):
        weights = apportion({'common': 0.99999999, 'rare': 0.00000001})
        self.assertEqual(sum(weights.values()), SCALE)
        self.assertGreater(weights['rare'], 0)
        self.assertEqual(weights, apportion({'common': 99999999, 'rare': 1}))
        with self.assertRaises(ValueError):
            apportion({'common': 1, 'unrepresentable': 1e-30})

    def test_checksums_use_the_builders_fnv_convention(self):
        self.assertEqual(fnv(b''), 'cbf29ce484222325')
        self.assertEqual(fnv(b'hello'), 'a430d84680aabd0b')

    def test_decline_gate_rejects_weak_policies_and_unregistered_sources(self):
        from build_model203_decline_factors import bootstrap, empty_counts, validate, LEGACY
        for model, source in [('13.22', 'unknown'), ('9.0', 'unknown'), ('13.1', 'unknown')]:
            value = bootstrap(LEGACY, [])
            actor = 'schell_table-peg_table-' + model
            value['countsByModel'] = {actor: empty_counts()}
            value['sources'] = [{'sha256': source, 'countsByModel': value['countsByModel']}]
            with self.assertRaises(ValueError):
                validate(value, LEGACY)

    def test_retained_input_preparation_reproduces_pinned_inputs(self):
        import json
        pinned = json.loads((ROOT / 'rust/cribbage-shadow-engine/assets/model284-correction-inputs.json').read_bytes())
        with tempfile.TemporaryDirectory() as folder:
            report = prepare(ROOT, Path(folder))
        for field in ['inputChecksums', 'inputs', 'evidenceSha256', 'qualifiedDeclineFactors']:
            self.assertEqual(report[field], pinned[field])
        self.assertEqual(report['positiveDiscardCellsPerRole'], 165295)
        self.assertLess(report['maximumQuantizationError'], 1e-12)
