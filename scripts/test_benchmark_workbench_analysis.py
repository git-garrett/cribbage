import json
from pathlib import Path
import tempfile
import unittest
from benchmark_workbench import job_entry, register
from benchmark_workbench_analysis import build_analysis_report


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.spec = self.root/'job.json'
        self.spec.write_text(json.dumps(dict(jobId='heatmap-test', analysisJob=dict(root=str(self.root),target=100,title='Heatmaps'))))
        self.entry = register(self.spec, self.root/'runtime')
        self.progress = dict(status='running', target=100,completed=25,reused=10,workers=4,workerLimit=4,updatedAt=1000,remainingSeconds=900,groups=[])
        self.write()
    def write(self):
        (self.root/'progress.json').write_text(json.dumps(self.progress))
    def test_registration_and_live_estimate(self):
        self.assertEqual(self.entry['kind'],'analysis')
        r=build_analysis_report(self.entry,dict(state='running'),now=1030)
        self.assertEqual((r['completed'],r['remainingSeconds'],r['workers']),(25,900,4))
    def test_stale_and_failed_withhold_eta(self):
        r=build_analysis_report(self.entry,dict(state='running'),now=1200)
        self.assertEqual(r['state'],'stale'); self.assertIsNone(r['remainingSeconds'])
        r=build_analysis_report(self.entry,dict(state='failed'),now=1030)
        self.assertEqual(r['state'],'failed'); self.assertIsNone(r['remainingSeconds'])
    def test_compute_complete_is_still_reporting(self):
        self.progress.update(status='complete',completed=100);self.write()
        r=build_analysis_report(self.entry,dict(state='running',stages=[dict(name='render-pdf',state='running')]),now=1030)
        self.assertEqual((r['state'],r['stage']),('reporting','render-pdf'));self.assertIsNone(r['remainingSeconds'])
    def test_wrong_target_rejected(self):
        self.progress['target']=200;self.write()
        with self.assertRaises(ValueError):build_analysis_report(self.entry,dict(state='running'),now=1030)
    def test_partial_history_line_ignored(self):
        (self.root/'history.jsonl').write_text('{"updatedAt":1000,"completed":25}\n{"updatedAt":')
        r=build_analysis_report(self.entry,dict(state='running'),now=1030)
        self.assertEqual(len(r['history']),1)
    def test_invalid_target(self):
        self.spec.write_text(json.dumps(dict(jobId='heatmap-test',analysisJob=dict(root=str(self.root),target=True))))
        with self.assertRaises(ValueError):job_entry(self.spec)

if __name__=='__main__':unittest.main()
