import copy
import tempfile
import unittest
from pathlib import Path
import forecast292 as f
from forecast import key, packed_scoring, scoring_inputs

class ScoringForecast(unittest.TestCase):
    def fixture(self, start=None, complete=True, points=None):
        start=start or [20,30];points=points or [4,2]
        c=dict(model='29.2',sourceRoot='frozen',sourceGame='train:1:1',hand=1,actor=0,
            own=[0,2,4,16,18,30],start=start,dealer=0)
        discard=[0,18]
        r=dict(discard=discard,postCutStart=start,pegEnd=[a+b for a,b in zip(start,points)],pegComplete=complete,
            scoring=dict(context=key(c['own'],discard,[0,0],True),prior=[[2,2,.5],[6,4,.5]]))
        return c,r

    def test_scoring_distribution_moves_before_any_wp_is_needed(self):
        data=f.empty();worlds={};c,r=self.fixture()
        f.add(data,c,r,worlds);f.finish(data,worlds)
        bins=next(iter(data['rows'].values()))
        self.assertAlmostEqual(sum(p for _,_,p in bins),1)
        self.assertAlmostEqual(next(p for a,b,p in bins if (a,b)==(4,2)),1/33)
        self.assertEqual(data['stats']['completeSamples'],1)
        self.assertEqual(data['stats']['regions'],[1,1])
        c['start']=[25,35];r['postCutStart']=[25,35];r['pegEnd']=[29,37]
        f.add(data,c,r,{});f.finish(data,{})
        self.assertEqual(len(data['rows']),1) # Another score pair, same region.
        c['own']=[0,2,5,16,18,30];r['scoring']['context']=key(c['own'],r['discard'],[0,0],True)
        f.add(data,c,r,{});f.finish(data,{})
        self.assertEqual(len(data['contexts']),2) # Similar hands never pool.

    def test_censored_scores_are_bounds_not_completed_totals(self):
        bins,n,c,u=f.posterior([[2,2,.5],[6,4,.5]],[(0,3,1,1)])
        self.assertEqual((n,c,u),(0,1,0))
        self.assertNotIn((3,1),[(a,b) for a,b,_ in bins])
        self.assertAlmostEqual(next(p for a,b,p in bins if a==6),17/33)
        bins,n,c,u=f.posterior([[2,2,1.]],[(0,8,1,1)])
        self.assertEqual((n,c,u),(0,0,1))
        self.assertEqual(bins,[[2,2,1.]])

    def test_repartition_reassigns_source_boards_without_transposing_points(self):
        data=f.empty();c,r=self.fixture();f.add(data,c,r,{})
        c['start']=[90,30];r['postCutStart']=[90,30];r['pegEnd']=[96,34]
        f.add(data,c,r,{})
        data['regions'][0]=dict(axis=0,cut=59,left={},right={})
        f.finish(data,{})
        self.assertEqual(len(data['rows']),2)
        self.assertEqual(sum(data['contexts'][r['scoring']['context']]['cells'].values()),2)

    def test_boundary_learning_requires_fresh_heldout_evidence(self):
        data=f.empty();worlds={}
        # Enough independent complete worlds, with a deliberately simple signal.
        for i in range(3000):
            x=10 if i%2 else 100
            worlds[(f'train:{i}',1,0)]=dict(scores=[x,50],role=0,values=[[0 if x==10 else 8,0]],complete=True)
        f.finish(data,worlds)
        self.assertIn('axis',data['regions'][0])
        self.assertEqual(data['stats']['acceptedBoundaryUpdates'],1)
        previous=copy.deepcopy(data['regions']);f.finish(data,{})
        self.assertEqual(previous,data['regions'])

    def test_invalid_markers_rejected_and_storage_round_trips(self):
        data=f.empty();c,r=self.fixture();r['pegComplete']=False
        with self.assertRaises(ValueError):f.add(data,c,r,{})
        r['pegComplete']=True;f.add(data,c,r,{});f.finish(data,{})
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/f.FILE;f.write(path,data);self.assertEqual(f.read(path),data)
        value=dict(model='29.2',scoringInputs={'a':r['scoring']})
        self.assertEqual(scoring_inputs(packed_scoring(value)),value['scoringInputs'])
        outcome=dict(model='29.2',outcomes=[dict(key='a',scoring=r['scoring'])])
        packed=packed_scoring(outcome)
        self.assertNotIn('scoring',packed['outcomes'][0]);self.assertEqual(scoring_inputs(packed)['a'],r['scoring'])

if __name__=='__main__':unittest.main()
