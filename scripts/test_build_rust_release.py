import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('release_build', Path(__file__).with_name('build_rust_release.py'))
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ReleaseBuildTests(unittest.TestCase):
    def options(self, root, **overrides):
        values = dict(kind='benchmark', root=root, model_root=None, corpus=None,
                      target_dir=root/'target', target=None, model=['example'],
                      offline=True, no_pgo=False)
        values.update(overrides)
        return argparse.Namespace(**values)

    def exercise(self, root, *, platform='darwin', mismatch=False, changed=False,
                 kind='benchmark', **options):
        calls = []
        def fake_run(args, **kwargs):
            args = [str(x) for x in args]
            calls.append((args, kwargs))
            if args == ['rustc', '-vV']:
                return subprocess.CompletedProcess(args, 0, stdout='rustc test\nhost: aarch64-apple-darwin\n')
            if args[0] == 'cargo':
                target = Path(kwargs['env']['CARGO_TARGET_DIR'])
                output = target/'aarch64-apple-darwin/release' if '--target' in args else target/'release'
                output.mkdir(parents=True, exist_ok=True)
                for name in ['cribbage-runner', 'cribbage-decision-worker', 'cribbage-api',
                             'cribbage-shadow-engine', 'pgo-workload']:
                    (output/name).write_text(target.name)
            elif args[0] == 'merger':
                Path(args[-1]).write_text('fresh profile')
            else:
                self.assertEqual(Path(args[0]).name, 'pgo-workload')
                is_optimized = '/optimized/' in args[0]
                values = [{'id': args[-2], 'value': int(mismatch and is_optimized)}]
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps(dict(model=args[-3], values=values, seconds=1)))
            return subprocess.CompletedProcess(args, 0)
        stamps = [{'source': 'one'}, {'source': 'two' if changed else 'one'}]
        with patch.object(BUILD, 'run', side_effect=fake_run), patch.object(BUILD, 'profile_tool', return_value='merger'), patch.object(BUILD, 'inputs', side_effect=stamps), patch.object(BUILD.sys, 'platform', platform), patch.dict(BUILD.os.environ, {}, clear=True):
            BUILD.build(self.options(root, kind=kind, **options))
        return calls

    def test_mac_profiles_checks_then_publishes(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d);calls = self.exercise(p)
            self.assertEqual((p/'target/release/cribbage-runner').read_text(), 'optimized')
            builds = [kw['env']['CARGO_ENCODED_RUSTFLAGS'] for args, kw in calls if args[0]=='cargo']
            self.assertEqual(len(builds), 3)
            self.assertIn('profile-generate=', builds[1]);self.assertIn('profile-use=', builds[2])
            self.assertNotIn('target-cpu', ''.join(builds))
            record=json.loads((p/'target/pgo/benchmark/latest.json').read_text())
            self.assertEqual(record['status'], 'complete')
            self.assertTrue(all(v['bitExact'] for v in record['results'].values()))
            for args, _ in calls:
                if Path(args[0]).name == 'pgo-workload':self.assertEqual(args[-1], 'play')

    def test_api_training_includes_reviews(self):
        with tempfile.TemporaryDirectory() as d:
            calls=self.exercise(Path(d),kind='api')
            self.assertTrue(all(args[-1]=='reviews' for args,_ in calls if Path(args[0]).name=='pgo-workload'))

    def test_each_build_uses_a_new_profile_path(self):
        with tempfile.TemporaryDirectory() as d:
            profiles = []
            for _ in range(2):
                calls = self.exercise(Path(d))
                profiles.extend(kw['env']['CARGO_ENCODED_RUSTFLAGS']
                                for args, kw in calls if args[0] == 'cargo'
                                and 'profile-use=' in kw['env']['CARGO_ENCODED_RUSTFLAGS'])
            self.assertEqual(len(set(profiles)), 2)

    def test_shadow_updates_legacy_executable_after_validation(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            self.exercise(p, kind='shadow')
            self.assertEqual((p/'rust/cribbage-shadow-engine/cribbage-shadow-engine').read_text(),
                             'optimized')

    def test_parity_failure_preserves_old_binary(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);old=p/'target/release/cribbage-runner';old.parent.mkdir(parents=True);old.write_text('old')
            with self.assertRaisesRegex(ValueError, 'parity failed'):self.exercise(p,mismatch=True)
            self.assertEqual(old.read_text(),'old')
            self.assertFalse((p/'target/pgo/benchmark/latest.json').exists())

    def test_source_change_prevents_publication(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with self.assertRaisesRegex(ValueError, 'changed during'):self.exercise(p,changed=True)
            self.assertFalse((p/'target/release/cribbage-runner').exists())

    def test_linux_keeps_standard_build(self):
        with tempfile.TemporaryDirectory() as d:
            calls=self.exercise(Path(d),platform='linux')
            self.assertEqual(len([a for a,_ in calls if a[0]=='cargo']),1)
            self.assertFalse(any(Path(a[0]).name=='pgo-workload' for a,_ in calls))

    def test_cross_build_keeps_explicit_target_and_skips_pgo(self):
        with tempfile.TemporaryDirectory() as d:
            calls = self.exercise(Path(d), target='x86_64-unknown-linux-gnu')
            builds = [a for a, _ in calls if a[0] == 'cargo']
            self.assertEqual(len(builds), 1)
            self.assertEqual(builds[0][-2:], ['--target', 'x86_64-unknown-linux-gnu'])
            self.assertFalse(any(Path(a[0]).name == 'pgo-workload' for a, _ in calls))

    def test_explicit_no_pgo_uses_one_standard_mac_build(self):
        with tempfile.TemporaryDirectory() as d:
            calls = self.exercise(Path(d), no_pgo=True)
            builds = [kw for a, kw in calls if a[0] == 'cargo']
            self.assertEqual(len(builds), 1)
            self.assertNotIn('CARGO_ENCODED_RUSTFLAGS', builds[0]['env'])

    def test_failed_staging_does_not_replace_any_binary(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);out=p/'release';out.mkdir();(out/'a').write_text('old');source=p/'new';source.write_text('new')
            with self.assertRaises(FileNotFoundError):BUILD.publish({'a':source,'b':p/'missing'},out)
            self.assertEqual((out/'a').read_text(),'old')

    def test_external_profile_flags_are_rejected(self):
        for env in [{'RUSTFLAGS':'-Cprofile-use=old'}, {'CARGO_ENCODED_RUSTFLAGS':'-C\x1fprofile-generate=old'}]:
            with self.assertRaisesRegex(ValueError,'owned'):BUILD.rustflags(env)

    def test_encoded_flags_take_precedence(self):
        self.assertEqual(BUILD.rustflags({'CARGO_ENCODED_RUSTFLAGS':'-C\x1ftarget-feature=+a', 'RUSTFLAGS':'ignored'}),['-C','target-feature=+a'])

    def test_empty_encoded_flags_still_override_rustflags(self):
        self.assertEqual(BUILD.rustflags({
            'CARGO_ENCODED_RUSTFLAGS': '',
            'RUSTFLAGS': '-Ctarget-cpu=native',
        }), [])


if __name__ == '__main__':
    unittest.main()
