import copy
import unittest
from benchmark_comparison_telemetry import telemetry_report
from benchmark_workbench_comparisons import hand_scores


def fixture():
    def play(actor, action, card, after, points, scores, legal, micros, ev=None, wp=None):
        return dict(actor=actor,action=action,card=card,before=0,after=after,points=points,scores=scores,
                    legalCount=legal,micros=micros,ev=ev,wp=wp,evKind='future_net')
    # A completed hand with a forced opening, Go/reset and final last card.
    rows = [play(1,0,0,1,0,[100,100],1,None),
            play(0,0,9,30,0,[100,100],2,2000,2,.8),
            play(1,1,None,30,0,[101,100],0,None),
            play(None,2,None,0,0,[101,100],None,None),
            play(1,0,1,2,0,[101,101],2,4000,1,.3)]
    hands = [dict(number=1,start=[100,100],end=[None,None],dealer=0,cut=2,keeps=[[0]*4,[1]*4],
                  handPoints=[3,2],cribPoints=1,plays=[]),
             dict(number=2,start=[105,103],end=[105,121],dealer=1,cut=2,keeps=[[0]*4,[1]*4],
                  handPoints=[0,18],cribPoints=0,plays=[])]
    discards = []; plays = []
    for h in hands:
        for actor in (0,1):
            discards.append(dict(hand=h['number'],actor=actor,role='dealer' if actor==h['dealer'] else 'pone',
                model='schell_table-peg_table-'+('29.0' if actor==0 else '28.3'),micros=1000,ev=3,wp=.75 if actor==0 else .25))
    for i,p in enumerate(rows):
        h=hands[0]; h['plays'].append({k:p[k] for k in ('actor','action','card','before','after','points','scores')})
        p.update(hand=1,sequence=i,role=None if p['actor'] is None else 'dealer' if p['actor']==0 else 'pone',
                 model=None if p['actor'] is None else 'schell_table-peg_table-'+('29.0' if p['actor']==0 else '28.3'))
        plays.append(p)
    return dict(candidateSide=0,winner=1,hands=hands,benchmark=dict(schemaVersion=1,discards=discards,plays=plays))


class TelemetryTests(unittest.TestCase):
    def test_forced_opening_go_totals_calibration_and_final_hand_exclusion(self):
        r=telemetry_report([fixture()],hand_scores)
        row=lambda field,kind,model: next(v for v in r[field]['rows'] if v['kind']==kind and v['model']==model)
        self.assertEqual(r['telemetry']['status'],'complete')
        self.assertEqual(r['evCalibration']['excluded']['discardFinalHand'],2)
        self.assertEqual(row('evCalibration','discard_total','current')['avgRealized'],4)
        self.assertEqual(row('evCalibration','peg_future','current')['avgRealized'],0)
        self.assertEqual(row('evCalibration','peg_future','original')['avgRealized'],1)
        self.assertEqual(row('timing','peg_hand','original')['avgMs'],4)
        self.assertFalse(any(v['kind']=='peg_opening' and v['model']=='original' for v in r['timing']['rows']))
        self.assertAlmostEqual(row('winProbabilityCalibration','pegging','current')['brier'],.64)
        self.assertAlmostEqual(row('winProbabilityCalibration','discard','original')['brier'],.5625)
        self.assertTrue(r['winProbabilityCalibration']['buckets'])

    def test_missing_nonforced_timing_excludes_hand_total(self):
        g=fixture();g['benchmark']['plays'][1]['micros']=None
        r=telemetry_report([g],hand_scores)
        self.assertFalse(any(v['kind']=='peg_hand' and v['model']=='current' for v in r['timing']['rows']))

    def test_partial_legacy_coverage_and_actor_integrity(self):
        g=fixture();old=copy.deepcopy(g);del old['benchmark']
        r=telemetry_report([g,old],hand_scores)
        self.assertEqual(r['telemetry']['status'],'partial')
        self.assertEqual(r['telemetry']['recordedGames'],1)
        g['benchmark']['plays'][0]['role']='dealer'
        with self.assertRaisesRegex(ValueError,'model or role'):telemetry_report([g],hand_scores)

    def test_missing_event_is_rejected(self):
        g=fixture();g['benchmark']['plays'].pop()
        with self.assertRaisesRegex(ValueError,'Missing'):telemetry_report([g],hand_scores)


if __name__=='__main__':unittest.main()
