from collections import Counter
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model284_score_segments as s


class SegmentationTests(unittest.TestCase):
    def test_break_is_last_early_score_and_role_pooling_preserves_counts(self):
        bins = {}
        for score,n in [(99,5),(110,7),(111,11),(120,13)]:
            rows=s.empty()
            for kind in s.KINDS:
                rows[kind][('dealer','context')]['truth']=n
                rows[kind][('pone','context')]['truth']=2*n
            bins[str(score)]=rows
        before=copy.deepcopy(bins)
        self.assertEqual(s.aggregate(bins,high=110)['hold'][('dealer','context')]['truth'],12)
        self.assertEqual(s.aggregate(bins,low=111)['hold'][('dealer','context')]['truth'],24)
        pooled=s.pooled_roles(s.aggregate(bins))
        self.assertEqual(pooled['hold'][('dealer','context')]['truth'],108)
        self.assertEqual(pooled['hold'][('pone','context')]['truth'],108)
        self.assertEqual(before,bins)
        self.assertEqual(s.fold('paired-seed',123),s.fold('paired-seed',123))
        self.assertEqual({s.fold(str(i),123) for i in range(50)},{'smoothing','selection'})

    def test_prediction_routes_by_subject_role_and_hand_start_score(self):
        keep='0000004000000';other='0000000400000';prefix='0000000000000'
        d1='0200000000000';d2='0020000000000'
        early={kind:{} for kind in s.KINDS};late={kind:{} for kind in s.KINDS}
        for role in s.b.ROLES:
            early['hold'][(role,prefix)]={keep:.2,other:.8}
            late['hold'][(role,prefix)]={keep:.8,other:.2}
            early['discards'][(role,keep)]={d1:.3,d2:.7}
            late['discards'][(role,keep)]={d1:.7,d2:.3}
        profiles={r:dict(early=early,late=late,lastEarlyScore=110 if r=='dealer' else 119) for r in s.b.ROLES}
        cases=[dict(role=role,actorStartScore=score,ownSix='4000020000000',cutRank=1,keep=keep,discard=d1,
                    hold=[dict(prefix=prefix,remaining=keep)]*2) for role,score in
               [('dealer',110),('dealer',111),('pone',111),('pone',120)]]
        values=s.predict(cases,profiles)
        for i,(case,use_late) in enumerate(zip(cases,[False,True,False,True])):
            model=late if use_late else early
            role=case['role']
            hp=s.b.conditioned_hold(model['hold'][(role,prefix)],prefix,case['ownSix'],1)[keep]
            dp=s.b.conditioned_discard(model['discards'][(role,keep)],keep,case['ownSix'],1)[d1]
            self.assertAlmostEqual(values[i,6],-.5*(np.log(hp)+np.log(dp)))

    def test_selection_is_role_specific_and_never_reads_confirmation_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);prepared=root/'output/prepared';prepared.mkdir(parents=True)
            cases=[dict(seed=seed,role=role,actorStartScore=110) for seed in ['a','b'] for role in s.b.ROLES]
            s.write_gz(prepared/'selection.json.gz',cases)
            case_sha=s.h.file_digest(prepared/'selection.json.gz')
            s.b.write_json(prepared/'summary.json',dict(files={'selection.json.gz':case_sha}))
            s.b.write_json(root/'protocol.json',dict(seed='123'))
            for cut in s.BREAKS:
                folder=root/'output/fits'/str(cut);folder.mkdir(parents=True)
                table=np.zeros((4,7))
                table[:,:2]=[[i%2,110] for i in range(4)]
                table[:,6]=[0. if cut==(105 if i%2==0 else 115) else 1. for i in range(4)]
                np.savez_compressed(folder/'selection.npz',values=table)
                s.b.write_json(folder/'metadata.json',dict(selectionSha256=s.h.file_digest(folder/'selection.npz'),selectionCasesSha256=case_sha))
            s.select(root)
            result=json.loads((root/'output/selection.json').read_bytes())
            self.assertEqual(result['best'],dict(dealer=105,pone=115,common=105))
            (prepared/'confirmation.json.gz').write_bytes(b'not even a readable confirmation file')
            s.select(root)
            self.assertEqual(json.loads((root/'output/selection.json').read_bytes()),result)

    def test_no_split_wins_exact_selection_and_bootstrap_ties(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);prepared=root/'output/prepared';prepared.mkdir(parents=True)
            cases=[dict(seed='a',role=role,actorStartScore=110) for role in s.b.ROLES]
            s.write_gz(prepared/'selection.json.gz',cases)
            case_sha=s.h.file_digest(prepared/'selection.json.gz')
            s.b.write_json(prepared/'summary.json',dict(files={'selection.json.gz':case_sha}))
            s.b.write_json(root/'protocol.json',dict(seed='123'))
            for cut in s.BREAKS:
                folder=root/'output/fits'/str(cut);folder.mkdir(parents=True)
                table=np.zeros((2,7));table[:,:2]=[[0,110],[1,110]];table[:,6]=1
                np.savez_compressed(folder/'selection.npz',values=table)
                s.b.write_json(folder/'metadata.json',dict(selectionSha256=s.h.file_digest(folder/'selection.npz'),selectionCasesSha256=case_sha))
            s.select(root)
            result=json.loads((root/'output/selection.json').read_bytes())
            self.assertEqual(result['best'],dict(dealer=120,pone=120,common=120))
            for value in result['uncertainty'].values():
                self.assertEqual(value['exploratoryIntervals'][-1]['bootstrapBestFraction'],1.)


if __name__=='__main__': unittest.main()
