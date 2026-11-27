from collections import Counter
import copy
import math
from pathlib import Path
import sys
import unittest

import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parent))
import model284_early_ablation as a


def training():
    return {(role,'4000000000000'):Counter({'0200000000000':100}) for role in a.b.ROLES}


class EarlyAblationTests(unittest.TestCase):
    def test_neutral_prior_is_physical_and_preserves_rare_legal_hands(self):
        q=a.neutral_hold('0000000000000')
        self.assertEqual(len(q),1820)
        self.assertAlmostEqual(q['4000000000000'],1/math.comb(52,4))
        self.assertAlmostEqual(q['1111000000000']/q['4000000000000'],256)
        q=a.neutral_hold('3000000000000')
        self.assertAlmostEqual(q['1000000000000'],1/49)
        self.assertAlmostEqual(q['0100000000000'],4/49)
        self.assertAlmostEqual(sum(q.values()),1.)

    def test_empirical_backoff_uses_only_supplied_arm_training(self):
        early=training()
        saved=copy.deepcopy(early)
        all_scores=copy.deepcopy(early)
        for row in all_scores.values(): row['0020000000000']=100
        q=a.discard_backoffs(early)
        pooled=a.discard_backoffs(all_scores)
        key=('dealer','4000000000000')
        self.assertGreater(q[key]['0200000000000'],pooled[key]['0200000000000'])
        self.assertGreater(q[key]['0020000000000'],0)
        self.assertEqual(early,saved)
        self.assertTrue(all(p>0 for row in q.values() for p in row.values()))

    def test_tuning_can_reject_misleading_training_evidence(self):
        key=('dealer','0000000000000')
        prior={key:{'4000000000000':.5,'0400000000000':.5}}
        train={key:Counter({'0400000000000':1000})}
        tune={key:Counter({'4000000000000':100})}
        p,audit=a.fit_group(prior,train,tune)
        self.assertIsNone(audit['selected']['strength'])
        self.assertEqual(p,prior)

    def test_vectorized_conditioning_matches_independent_scalar_path(self):
        own='4000020000000'
        cases=[dict(ownSix=own,cutRank=cut) for cut in (1,12)]
        for n in range(4):
            prefix='000000'+str(n)+'000000'
            q=a.neutral_hold(prefix)
            keys=sorted(q)
            weights=a.conditioned_batch(keys,prefix,cases,'hold')*np.array([q[k] for k in keys])
            weights/=weights.sum(axis=1,keepdims=True)
            for i,case in enumerate(cases):
                expected=a.b.conditioned_hold(q,prefix,own,case['cutRank'])
                np.testing.assert_allclose(weights[i],[expected.get(k,0.) for k in keys],rtol=0,atol=1e-12)
        keep='0000004000000'
        q=a.discard_backoffs(training())[('dealer',keep)]
        keys=sorted(q)
        weights=a.conditioned_batch(keys,keep,cases,'discards')*np.array([q[k] for k in keys])
        weights/=weights.sum(axis=1,keepdims=True)
        for i,case in enumerate(cases):
            expected=a.b.conditioned_discard(q,keep,own,case['cutRank'])
            np.testing.assert_allclose(weights[i],[expected.get(k,0.) for k in keys],rtol=0,atol=1e-12)
        with self.assertRaises(ValueError):
            a.conditioned_batch(keys,keep,[dict(ownSix='0000006000000',cutRank=1)],'discards')

    def test_identical_models_have_zero_paired_deltas_and_cluster_shared_seeds(self):
        role='dealer';prefix='0000000000000';keep='0000004000000'
        rows=dict(hold={(role,prefix):a.neutral_hold(prefix)},discards={(role,keep):a.discard_backoffs(training())[(role,keep)]})
        case=dict(seed='paired-seed',role=role,model='schell_table-peg_table-20.3',
                  actorStartScore=50,opponentStartScore=90,ownSix='4000020000000',cutRank=1,
                  keep=keep,discard='0200000000000',hold=[dict(prefix=prefix,remaining=keep)])
        other=dict(case,actorStartScore=105)
        report=a.assess([case,other],rows,rows,123)
        row=next(r for r in report if r['conditioning']=='conditioned' and r['kind']=='discards' and r['group']=='dealer')
        self.assertEqual(row['observations'],2)
        self.assertEqual(row['seedGroups'],1)
        self.assertEqual(row['nllDelta'],0)
        self.assertEqual(row['nllDelta95'],[0,0])
        self.assertEqual(row['brierDelta95'],[0,0])


if __name__=='__main__': unittest.main()
