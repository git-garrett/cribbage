import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location(
    'production_build', Path(__file__).with_name('build_production_release.py'))
PRODUCTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCTION)
COMMIT = 'a' * 40


class ProductionBuildTests(unittest.TestCase):
    def fixture(self, root):
        binary = root / 'rust/target/release/cribbage-api'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'api')
        record = dict(status='complete', gitCommit=COMMIT, flags=[], models=['ace'],
                      apiTestsPassed=True, profileSha256='profile',
                      binaries={'cribbage-api': PRODUCTION.digest(binary)},
                      results={f'ace/{s}': dict(bitExact=True, cases=1)
                               for s in ['train', 'validate']})
        PRODUCTION.save(root / 'pgo-build.json', record)
        return record

    def test_validated_binary_is_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            self.assertEqual(PRODUCTION.verify(root, COMMIT)['gitCommit'], COMMIT)

    def test_wrong_release_or_unchecked_build_is_rejected(self):
        for field, value in [('gitCommit', 'b' * 40), ('flags', ['-Ctarget-cpu=native']),
                             ('apiTestsPassed', False), ('models', ['other'])]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                record = self.fixture(root)
                record[field] = value
                PRODUCTION.save(root / 'pgo-build.json', record)
                with self.assertRaisesRegex(ValueError, 'receipt'):
                    PRODUCTION.verify(root, COMMIT)

    def test_tampered_binary_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self.fixture(root)
            (root / 'rust/target/release/cribbage-api').write_bytes(b'other')
            with self.assertRaisesRegex(ValueError, 'binary'):
                PRODUCTION.verify(root, COMMIT)

    def test_missing_parity_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            record = self.fixture(root)
            del record['results']['ace/validate']
            PRODUCTION.save(root / 'pgo-build.json', record)
            with self.assertRaisesRegex(ValueError, 'parity'):
                PRODUCTION.verify(root, COMMIT)

    def test_insufficient_disk_space_does_not_start_build(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(PRODUCTION.sys, 'platform', 'linux'), \
                    patch.object(PRODUCTION.shutil, 'disk_usage') as usage, \
                    patch.object(PRODUCTION, 'build') as build:
                usage.return_value.free = 1
                with self.assertRaisesRegex(ValueError, 'free'):
                    PRODUCTION.build_release(Path(d), Path(d) / 'target', COMMIT)
                build.assert_not_called()


if __name__ == '__main__':
    unittest.main()
