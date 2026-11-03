import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from benchmark_workbench_comparisons import ASSETS, _completed_report, comparison_report, hand_scores, samples


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        _completed_report.cache_clear()

    def hand(self, **changes):
        return dict(dict(start=[100,100],end=[101,121],dealer=0,cut=2,keeps=[[0,1,2,3],[13,14,15,16]],
            handPoints=[0,10],cribPoints=0,plays=[dict(actor=0,action=0,points=1,scores=[101,100],after=3),
                dict(actor=1,action=0,points=12,scores=[101,112],after=6)]),**changes)

    def test_realized_counting_caps_winning_event_but_available_retains_it(self):
        real,available=hand_scores(self.hand())
        self.assertEqual(real[1]['Hand pone'],9)
        self.assertEqual(available[1]['Hand pone'],10)
        self.assertEqual(real[0]['Hand dealer'],0)

    def test_heels_and_go_are_credited_to_scoring_side(self):
        real,available=hand_scores(self.hand(start=[120,80],end=[121,80],cut=10,handPoints=[0,0],plays=[]))
        self.assertEqual(real[0]['Peg dealer'],1);self.assertEqual(available[0]['Peg dealer'],2)
        real,available=hand_scores(self.hand(start=[120,80],end=[121,80],handPoints=[0,0],
            plays=[dict(actor=1,action=1,points=0,scores=[121,80],after=30)]))
        self.assertEqual(real[0]['Peg dealer'],1);self.assertEqual(available[0]['Peg dealer'],1)
        self.assertEqual(real[1]['Peg pone'],0)

    def test_winning_pegging_event_is_not_truncated_in_available_scores(self):
        real,available=hand_scores(self.hand(start=[119,80],end=[121,80],handPoints=[0,0],
            plays=[dict(actor=0,action=0,points=6,scores=[121,80],after=15)]))
        self.assertEqual(real[0]['Peg dealer'],2);self.assertEqual(available[0]['Peg dealer'],6)

    def test_next_start_recovers_missing_nonterminal_end_without_inventing_scores(self):
        first=self.hand(start=[100,100],end=[None,None],handPoints=[3,2],cribPoints=1,
            plays=[dict(actor=0,action=0,points=1,scores=[101,100],after=3)])
        last=self.hand(start=[105,102],end=[105,121],handPoints=[0,19],plays=[])
        game=dict(start=[100,100],scores=[105,121],hands=[first,last])
        result=samples(game)
        self.assertEqual(result[0]['realized']['Hand dealer'],[3,0])
        self.assertEqual(result[1]['realized']['Hand pone'],[2,19])
        bad=copy.deepcopy(game);bad['hands'][1]['start'][0]+=1
        with self.assertRaisesRegex(ValueError,'endpoint'):samples(bad)

    def fixture(self,root):
        current=root/'candidate';original=root/'original'
        for path,generation in ((current,29),(original,0)):
            (path/ASSETS).mkdir(parents=True)
            (path/ASSETS/'model29-generation.json').write_text(json.dumps(dict(generation=generation,policy=dict(sourceRevision='test-source'))))
        (root/'assessments').mkdir()
        receipt=dict(status='complete',trainingGames=5000,root=str(current),baseline=str(original),games=4,
            assessment=dict(pairs=2,status='inconclusive',confidence95=[0,1]),seconds=4,policy='evaluations never learn')
        (root/'assessments/000005000.json').write_text(json.dumps(receipt))
        with sqlite3.connect(root/'evidence.db') as db:
            db.execute('create table results(id text primary key,request text,root text,result text)')
            for index in range(2):
                for side in (0,1):
                    # Isolate evidence selection/inference; event accounting is tested above.
                    winner=side if index==0 else 1-side
                    g=dict(model='29.0',seed=100+index,firstDealer=index,trajectory=False,start=[0,0],
                        candidateSide=side,winner=winner,scores=[121,80] if winner==0 else [80,121],seconds=1,hands=[])
                    req=dict(kind='game',seed=g['seed'],firstDealer=index,candidateSide=side,scores=[0,0])
                    db.execute('insert into results values(?,?,?,?)',(f'eval:checkpoint:5000:{index}:{side}',json.dumps(req),str(current),json.dumps(g)))
            db.execute("insert into results values('train:0:0','broken','unrelated','not JSON')")

    def test_full_report_reads_only_this_checkpoint_and_preserves_missing_telemetry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            sample_game=dict(start=[100,100],scores=[101,121],hands=[self.hand()])
            with patch('benchmark_workbench_comparisons.samples',return_value=samples(sample_game)):
                report=comparison_report(root,5000)
                with patch('sqlite3.connect',side_effect=AssertionError('completed report must be cached')):
                    self.assertEqual(comparison_report(root,5000),report)
            self.assertEqual(report['candidateWins'],2)
            self.assertEqual(report['pairedSeeds']['candidateSweeps'],1)
            self.assertEqual(report['pairedSeeds']['opponentSweeps'],1)
            self.assertEqual(report['integrity']['completePairs'],2)
            self.assertEqual(report['evCalibration']['status'],'not recorded')
            self.assertEqual(report['timing']['rows'],[])
            self.assertEqual(len(report['availableEventScoring']),5)
            with sqlite3.connect(root/'evidence.db') as db:
                db.execute("delete from results where id='eval:checkpoint:5000:1:1'")
            _completed_report.cache_clear()
            with patch('benchmark_workbench_comparisons.samples',return_value=samples(sample_game)):
                with self.assertRaisesRegex(ValueError,'Missing'):comparison_report(root,5000)

    def test_snapshot_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            with sqlite3.connect(root/'evidence.db') as db:
                db.execute("update results set root='wrong' where id='eval:checkpoint:5000:0:0'")
            with self.assertRaisesRegex(ValueError,'snapshot'):comparison_report(root,5000)


if __name__=='__main__':unittest.main()
