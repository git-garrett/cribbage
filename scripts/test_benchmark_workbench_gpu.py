import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from benchmark_workbench import job_entry
from benchmark_workbench_gpu import build_gpu_report


class GpuWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.spec=self.root/'job.json';self.spec.write_text(json.dumps(dict(jobId='gpu-test',gpuBuild=dict(root=str(self.root),target=100,policy='30.0',title='GPU assets'))))
        self.entry=job_entry(self.spec)
        self.progress=dict(target=100,completed=20,updatedAt=1000,ratePerSecond=4,remainingSeconds=20,workers=4,workerLimit=4)
        (self.root/'progress.json').write_text(json.dumps(self.progress))

    def test_fresh_gpu_tab_without_reading_result_database(self):
        with patch('sqlite3.connect',side_effect=AssertionError('UI must not query worker data')):
            result=build_gpu_report(self.entry,dict(state='running'),now=1010)
        self.assertEqual(result['kind'],'gpu');self.assertEqual(result['remainingSeconds'],20)

    def test_prepared_build_keeps_scope_visible_before_launch(self):
        (self.root/'progress.json').unlink()
        result=build_gpu_report(self.entry,{},now=1010)
        self.assertEqual(result['state'],'prepared');self.assertEqual(result['completed'],0)
        self.assertEqual(result['target'],100);self.assertNotIn('waiting',result)

    def test_priority_pass_does_not_invent_overall_eta(self):
        self.progress['remainingSeconds']=None
        (self.root/'progress.json').write_text(json.dumps(self.progress))
        result=build_gpu_report(self.entry,dict(state='running'),now=1010)
        self.assertEqual(result['ratePerSecond'],4);self.assertIsNone(result['remainingSeconds'])

    def test_stale_stopped_and_failed_have_no_eta_or_rate(self):
        for state,now in [('running',1200),('stopped',1010),('failed',1010)]:
            result=build_gpu_report(self.entry,dict(state=state),now=now)
            self.assertIsNone(result['remainingSeconds']);self.assertIsNone(result['ratePerSecond'])

    def test_computation_completion_is_separate_from_archive(self):
        self.progress['completed']=100;(self.root/'progress.json').write_text(json.dumps(self.progress))
        result=build_gpu_report(self.entry,dict(state='running',stages=[dict(name='sync',state='running')]),now=2000)
        self.assertEqual(result['state'],'archiving');self.assertEqual(result['archive'],'pending')

    def test_wrong_target_and_nonfinite_rate_rejected(self):
        for key,value in [('target',101),('ratePerSecond',float('nan'))]:
            p=dict(self.progress);p[key]=value;(self.root/'progress.json').write_text(json.dumps(p))
            with self.assertRaises(ValueError):build_gpu_report(self.entry,dict(state='running'),now=1010)


if __name__=='__main__':unittest.main()
