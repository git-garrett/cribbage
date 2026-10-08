"""Tab preferences must never modify a benchmark or resurrect an archived tab."""
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import benchmark_workbench as workbench


class VisibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.runtime = self.root / 'runtime'
        self.spec = self.root / 'spec.json'
        self.spec.write_text(json.dumps({'jobId': 'original', 'jobRoot': str(self.root),
                                        'benchmarkRoot': str(self.root / 'results')}))
        self.status = self.root / 'status.json'
        self.status.write_text(json.dumps({'state': 'running'}))
        self.entry = workbench.register(self.spec, self.runtime)

    def jobs(self):
        return workbench.list_jobs(self.runtime, self.root / 'unused')

    def post(self, value, **headers):
        body = json.dumps(value).encode()
        handler = object.__new__(workbench.Handler)
        handler.server = SimpleNamespace(runtime=self.runtime, allowed_hosts={'localhost:8766'})
        handler.path = '/api/job-visibility'
        handler.headers = {'Host': 'localhost:8766', 'Content-Type': 'application/json',
                           'X-Workbench-Request': '1', 'Content-Length': str(len(body)), **headers}
        handler.rfile = io.BytesIO(body)
        handler.respond = mock.Mock()
        with mock.patch.object(workbench, 'list_jobs', return_value=self.jobs()):
            handler.do_POST()
        return handler.respond.call_args.args

    def test_archive_persists_across_registration_resume_and_completion(self):
        original = self.spec.read_bytes(), self.status.read_bytes()
        self.assertFalse(self.jobs()[0]['archived'])
        self.assertEqual(self.post({'job': 'original', 'archived': True}),
                         ({'id': 'original', 'archived': True},))
        self.assertEqual(original, (self.spec.read_bytes(), self.status.read_bytes()))
        workbench.register(self.spec, self.runtime)
        self.assertTrue(self.jobs()[0]['archived'])
        resumed = self.root / 'resumed.json'
        resumed.write_text(json.dumps({'jobId': 'resumed', 'jobRoot': str(self.root),
                                      'benchmarkRoot': str(self.root / 'results')}))
        workbench.register(resumed, self.runtime)
        self.status.write_text(json.dumps({'state': 'complete', 'updatedAt': '2026-10-08'}))
        self.assertEqual(len(self.jobs()), 1)
        self.assertTrue(self.jobs()[0]['archived'])
        self.assertEqual(self.post({'job': 'resumed', 'archived': False})[0]['archived'], False)
        self.assertFalse(self.jobs()[0]['archived'])

    def test_separate_experiments_keep_independent_preferences(self):
        other = {**self.entry, 'root': str(self.root / 'other')}
        workbench.set_archived(self.entry, True, self.runtime)
        workbench.set_archived(other, False, self.runtime)
        self.assertTrue(self.jobs()[0]['archived'])
        self.assertFalse(workbench.read_json(workbench.visibility_path(other, self.runtime))['archived'])

    def test_experiment_identity_survives_changed_gpu_output_root(self):
        a = {**self.entry, 'experimentRoot': str(self.root / 'experiment')}
        b = {**a, 'id': 'successor', 'root': str(self.root / 'another-output')}
        workbench.set_archived(a, True, self.runtime)
        self.assertEqual(workbench.visibility_path(a, self.runtime), workbench.visibility_path(b, self.runtime))

    def test_invalid_and_cross_origin_requests_cannot_write(self):
        good = {'job': 'original', 'archived': True}
        for headers in ({'Host': 'evil.example'}, {'Content-Type': 'text/plain'}, {'X-Workbench-Request': ''}):
            self.assertEqual(self.post(good, **headers)[1], 403)
        for value in ([], {}, {**good, 'archived': 'false'}, {**good, 'job': []}):
            self.assertEqual(self.post(value)[1], 400)
        for size in ('0', '-1', '4097', 'bad'):
            self.assertEqual(self.post(good, **{'Content-Length': size})[1], 400)
        self.assertEqual(self.post({**good, 'job': '../unregistered'})[1], 404)
        self.assertFalse((self.runtime / 'visibility').exists())

    def test_write_failure_is_reported_and_old_preference_survives(self):
        workbench.set_archived(self.entry, True, self.runtime)
        with mock.patch.object(Path, 'replace', side_effect=OSError('read only')):
            self.assertEqual(self.post({'job': 'original', 'archived': False})[1], 500)
        self.assertTrue(self.jobs()[0]['archived'])
        self.assertEqual(len(list((self.runtime / 'visibility').iterdir())), 1)


if __name__ == '__main__':
    unittest.main()
