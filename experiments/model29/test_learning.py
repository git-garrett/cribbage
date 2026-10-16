import json
import math
import shutil
import struct
import tempfile
import sqlite3
import unittest
from collections import defaultdict
from pathlib import Path
from unittest.mock import Mock, patch
import learning
import resources
from cycle import assessment, validate, collect

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
    def test_only_actual_start_of_hand_boards_learn(self):
        events = [(0,20),(1,15),(1,40),(0,40)]
        markers = [(0,0,0),(1,1,0),(2,0,1),(3,2,1)]
        with patch.object(learning,'series',return_value=(events,markers)):
            actual=learning.board_observations(dict(trajectory=False,winner=0,start=[40,50]))
        self.assertEqual(dict(actual),{(0,40,50):[1.,1],(0,65,60):[0.,1]})
        with self.assertRaisesRegex(ValueError,'transposed'):
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
            for phase in learning.FILES:
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
            g = dict(seed=12,trajectory=False)
            with patch.object(learning,'board_observations',return_value={(0,10,20):(900,1000)}):
                result = learning.update_board(source,target,[g,g],1000,state)
            self.assertEqual(state,{'0,10,20':1})
            self.assertEqual(result['seedClusters'],1)
            old = struct.unpack_from('<d',source.read_bytes(),16+8*(10*121+20))[0]
            new = struct.unpack_from('<d',target.read_bytes(),16+8*(10*121+20))[0]
            self.assertAlmostEqual(new,(old*1000+.9)/1001)
            self.assertEqual(source.read_bytes()[16+121*121*8:],target.read_bytes()[16+121*121*8:])

    def test_small_pilot_cannot_claim_strength(self):
        games = [dict(seed=10,candidateSide=s,winner=s) for s in (0,1)]
        self.assertEqual(assessment(games,.01)['status'],'inconclusive')
        with self.assertRaisesRegex(ValueError,'duplicate'):
            assessment([games[0],games[0]],.01)
        with self.assertRaisesRegex(ValueError,'incomplete'):
            assessment(games[:1],.01)

    def test_forecast_update_preserves_terminal_outcomes_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'base';assets=base/learning.ASSETS;assets.mkdir(parents=True)
            for name in learning.FILES.values():shutil.copyfile(REPO/learning.ASSETS/name,assets/name)
            (assets/'model1323-corrections.bin').write_bytes(b'frozen fixture')
            learning.seal(base,0,None,{},dict(peggingPolicy='28.3-f64-test'))
            row=dict(model='29.0',outcomes=[dict(key=f'keep-{i}',scores=[121,120]) for i in range(15)])
            target=Path(tmp)/'candidate'
            result=learning.update(base,target,'forecast',[('forecast:1',row)],1000,REPO)
            self.assertEqual(result['changed'],[learning.FORECAST])
            table=json.loads((target/learning.ASSETS/learning.FORECAST).read_text())
            self.assertEqual(table['rows']['keep-0'],[[121,120]])
            with self.assertRaisesRegex(ValueError,'no new'):
                learning.update(target,Path(tmp)/'repeat','forecast',[('forecast:1',row)],1000,REPO)

    def test_resume_counts_only_completed_full_games_for_cache_age(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);db=sqlite3.connect(':memory:')
            db.execute('create table results(id text primary key, request text, root text, result text)')
            request=dict(kind='game',seed=1);result=dict(seconds=1,cache=dict(hits=3))
            db.execute('insert into results values(?,?,?,?)',('train:0:0',json.dumps(request),'root',json.dumps(result)))
            db.execute('insert into results values(?,?,?,?)',('forecast:1:0','{}','root',json.dumps(result)))
            config=dict(output=str(out),workers=2,binary='not called')
            with patch('cycle.Worker',side_effect=AssertionError('completed work must not replay')):
                collect(db,config,'root',[('train:0:0',request)],out)
            self.assertEqual(json.loads((out/'cache-clock.json').read_text())['completedGames'],1)
            self.assertEqual(json.loads((out/'cache-progress.json').read_text())['hits'],6)
            with self.assertRaisesRegex(ValueError,'resumed request'):
                collect(db,config,'root',[('train:0:0',dict(kind='game',seed=2))],out)

    def test_training_and_evaluation_seeds_must_be_disjoint(self):
        config = dict(rounds=1,trainingGames=2,evaluationPairs=1,workers=1,
                      seed=100,evaluationSeed=100,phases=['wp'])
        with self.assertRaisesRegex(ValueError,'overlapping'):
            validate(config)
        config['evaluationSeed'] = 500
        validate(config)

    def test_resumed_training_rejects_changed_external_extractor(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'frozen'; helper = root/'scripts/extractor.py'
            helper.parent.mkdir(parents=True); helper.write_text('original')
            source = Path(tmp)/'source-manifest.json'
            learning.atomic(source,dict(files={'scripts/extractor.py':learning.sha(helper)}))
            config = dict(repo=str(root),sourceManifestSha256=learning.sha(source))
            learning.verify_source(config)
            helper.write_text('changed')
            with self.assertRaisesRegex(ValueError,'frozen source changed'):
                learning.verify_source(config)

    def test_only_locked_same_owner_can_reclaim_crashed_cpu_allocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'reservation.json'
            with patch.object(resources,'RESERVATION',path):
                resources.allocation('run',2)
                with self.assertRaisesRegex(ValueError,'ownership'):
                    resources.allocation('run',2)
                resources.allocation('run',2,reclaim=True)
                self.assertEqual(json.loads(path.read_text())['workers'],2)
                resources.allocation('run',2,release=True)
                self.assertEqual(json.loads(path.read_text())['workers'],0)

    def test_crashed_parent_does_not_leave_native_workers_running(self):
        child = Mock(pid=123); child.poll.return_value = 1
        with patch.object(resources.os,'killpg',side_effect=[None,ProcessLookupError]) as kill:
            resources.terminate_group(child)
        self.assertEqual(kill.call_args_list[0].args,(123,resources.signal.SIGTERM))
        child.wait.assert_called_once_with(timeout=10)


if __name__ == '__main__':
    unittest.main()
