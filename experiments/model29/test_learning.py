import json
import math
import shutil
import struct
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path
from unittest.mock import patch
import learning
from cycle import assessment, validate

REPO = Path(__file__).resolve().parents[2]


def game():
    plays = []; count = 0; scores = [90,90]
    for rank in range(4):
        for actor in range(2):
            before = count; count += rank+1
            points = 2*actor; scores[actor] += points
            plays.append(dict(actor=actor,action=0,card=rank+13*actor,
                              before=before,after=count,points=points,scores=scores.copy()))
    return dict(model='29.0',seed=123,firstDealer=0,start=[90,90],scores=[121,100],
                winner=0,trajectory=False,candidateSide=None,hands=[dict(number=1,
                dealer=0,start=[90,90],end=[121,100],cut=50,
                dealt=[list(range(6)),list(range(13,19))],keeps=[list(range(4)),list(range(13,17))],
                handPoints=[20,2],cribPoints=11,plays=plays)])


class LearningTests(unittest.TestCase):
    def test_replay_matches_every_direct_start_with_role_changes(self):
        events = [(0,40),(1,50),(0,40),(1,50),(0,50),(1,50)]
        markers = [(0,0,0),(1,1,0),(2,2,0),(4,0,1),(5,2,1)]
        expected = defaultdict(lambda:[0.,0])
        for left in range(121):
            for right in range(121):
                scores = [left,right]; visits = []
                for offset,(actor,points) in enumerate(events):
                    for at,phase,dealer in markers:
                        if at == offset:
                            visits.append((phase,scores[dealer],scores[1-dealer],dealer))
                    scores[actor] += points
                    if scores[actor] >= 121:
                        for phase,d,p,dealer in visits:
                            row = expected[phase,d,p]; row[0] += int(dealer==actor); row[1] += 1
                        break
                else:
                    self.fail('unresolved fixture')
        with patch.object(learning,'series',return_value=(events,markers)):
            actual = learning.board_observations(dict(trajectory=True))
        self.assertEqual(dict(actual),dict(expected))

    def test_replay_rejects_censored_trajectory(self):
        with patch.object(learning,'series',return_value=([(0,121)],[(0,0,0)])):
            with self.assertRaisesRegex(ValueError,'incomplete'):
                learning.board_observations(dict(trajectory=True))

    def test_go_awards_are_recorded_for_the_scoring_actor(self):
        g = game(); h = g['hands'][0]
        h['plays'] = [dict(action=1,actor=0,card=None,points=0,before=30,after=30,scores=[90,91])]
        events,_ = learning.series(g)
        self.assertEqual(events,[(1,1)])

    def test_synthetic_post_terminal_moves_are_not_behavioral_evidence(self):
        g = game(); h = g['hands'][0]; h['start'] = [120,90]; h['cut'] = 10
        natural = list(learning.natural_hands(g))
        self.assertEqual(natural[0]['plays'],[])
        g['candidateSide'] = 0
        with self.assertRaisesRegex(ValueError,'attributable'):
            learning.observations([g])

    def test_updates_are_isolated_deduplicated_and_tamper_evident(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)/'base'; assets = base/learning.ASSETS; assets.mkdir(parents=True)
            for name in learning.FILES.values():
                shutil.copyfile(REPO/learning.ASSETS/name,assets/name)
            (assets/'model1323-corrections.bin').write_bytes(b'frozen fixture')
            learning.seal(base,0,None,{},dict(peggingPolicy='28.3-f64-test'))
            original = learning.verify(base)
            for phase in learning.PHASES:
                target = Path(tmp)/phase
                result = learning.update(base,target,phase,[('game-1',game())],1000,REPO)
                self.assertEqual(result['changed'],[learning.FILES[phase]])
                self.assertEqual(learning.verify(base),original)
                with self.assertRaisesRegex(ValueError,'no new'):
                    learning.update(target,Path(tmp)/(phase+'-duplicate'),phase,[('game-1',game())],1000,REPO)
                path = target/learning.ASSETS/learning.FILES[phase]
                path.write_bytes(b'corrupted')
                with self.assertRaisesRegex(ValueError,'changed'):
                    learning.verify(target)

    def test_replay_effective_count_is_seed_cluster_not_cell_visit(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = REPO/learning.ASSETS/learning.FILES['wp']; target = Path(tmp)/'board.bin'; state = {}
            g = dict(seed=12,trajectory=True)
            with patch.object(learning,'board_observations',return_value={(0,10,20):(900,1000)}):
                result = learning.update_board(source,target,[g,g],1000,state)
            self.assertEqual(state,{'0,10,20':1})
            self.assertEqual(result['seedClusters'],1)
            old = struct.unpack_from('<d',source.read_bytes(),16+8*(10*121+20))[0]
            new = struct.unpack_from('<d',target.read_bytes(),16+8*(10*121+20))[0]
            self.assertAlmostEqual(new,(old*1000+.9)/1001)

    def test_small_pilot_cannot_claim_strength(self):
        games = [dict(seed=10,candidateSide=s,winner=s) for s in (0,1)]
        self.assertEqual(assessment(games,.01)['status'],'inconclusive')
        with self.assertRaisesRegex(ValueError,'duplicate'):
            assessment([games[0],games[0]],.01)
        with self.assertRaisesRegex(ValueError,'incomplete'):
            assessment(games[:1],.01)

    def test_training_and_evaluation_seeds_must_be_disjoint(self):
        config = dict(rounds=1,trainingGames=2,evaluationPairs=1,workers=1,
                      seed=100,evaluationSeed=100,phases=['wp'])
        with self.assertRaisesRegex(ValueError,'overlapping'):
            validate(config)
        config['evaluationSeed'] = 500
        validate(config)


if __name__ == '__main__':
    unittest.main()
