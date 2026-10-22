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
import forecast291
import resources
from cycle import assessment, validate, collect, collect_training_batch, batch_training_mode, maybe_assess, cache_stats, unconsumed_records
from forecast import ordinary_cohorts, rejected_requests, training_mode, terminal_hand_scores, key

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
    def test_291_archive_preserves_reference_and_handover_receipts(self):
        import stage
        with tempfile.TemporaryDirectory() as tmp:
            runtime=Path(tmp)/'runtime';archive=Path(tmp)/'archive'
            config=dict(model='29.1',repo=str(runtime/'frozen'),output=str(runtime/'output'),
                        archive=str(archive),binary=str(runtime/'bin/model29-worker'))
            files,directories=stage.archive_inputs(config)
            for name in files:
                path=runtime/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(name)
            for name in directories:
                path=runtime/name;path.mkdir(parents=True,exist_ok=True);(path/'fixture').write_text(name)
            binary=Path(config['binary']);binary.parent.mkdir();binary.write_bytes(b'worker')
            with patch('stage.verify_source'):
                stage.run('sync',config);stage.run('verify-sync',config)
                self.assertEqual((archive/'reference/fixture').read_text(),'reference')
                self.assertTrue((archive/'handoff.json').exists())
                (archive/'reference/fixture').write_text('changed')
                with self.assertRaisesRegex(ValueError,'archive differs'):stage.run('verify-sync',config)

    def test_handover_publication_resumes_after_old_initial_is_renamed(self):
        from transition291 import install_initial
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'parent';assets=source/learning.ASSETS;assets.mkdir(parents=True)
            for name in (*learning.FILES.values(),'model1323-corrections.bin'):
                (assets/name).write_bytes(b'fixture')
            learning.seal(source,8,None,{},dict(binarySha256='old'))
            policy=dict(binarySha256='new');target=root/'initial'
            learning.inherit(source,target,dict(binarySha256='preflight'))
            # Simulate interruption after the complete replacement was staged
            # and the preflight target preserved, but before final publication.
            learning.inherit(source,root/'handoff-initial',policy)
            target.rename(root/'preflight-initial')
            install_initial(source,target,policy)
            before=learning.sha(target/learning.ASSETS/'model29-generation.json')
            install_initial(source,target,policy)
            self.assertEqual(before,learning.sha(target/learning.ASSETS/'model29-generation.json'))
            self.assertTrue((root/'preflight-initial').exists())
            self.assertFalse((root/'handoff-initial').exists())
            self.assertEqual(learning.verify(target)['parent'],learning.sha(assets/'model29-generation.json'))

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

    def test_training_toggle_defaults_on_and_false_has_no_rollouts(self):
        self.assertTrue(training_mode({}))
        self.assertFalse(training_mode({'trainingMode':False}))
        for value in ('false',0,1,None):
            with self.assertRaisesRegex(ValueError,'boolean'):
                training_mode({'trainingMode':value})
        records=[('train:0:0',game())]
        for enabled in (True,False):
            config=dict(trainingMode=enabled,phases=['wp','forecast'])
            with patch('cycle.collect',return_value=records) as collector, patch('cycle.batch_training_mode',return_value=enabled),patch('cycle.checkpoint'):
                collect_training_batch(None,config,'immutable-root',[('train:0:0',{})],'out')
                self.assertEqual(collector.call_count,2)
                extra=collector.call_args_list[1].args[3]
                self.assertEqual(len(extra),2 if enabled else 0)
                self.assertEqual(collector.call_args_list[1].args[2],'immutable-root')
        self.assertEqual(rejected_requests(records,{'trainingMode':False}),[])

    def test_speed_toggle_changes_next_batch_but_not_resumed_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            control=Path(tmp)/'mode.json';db=sqlite3.connect(':memory:')
            config=dict(trainingControl=str(control))
            learning.atomic(control,dict(trainingMode=True))
            self.assertTrue(batch_training_mode(db,config,0))
            learning.atomic(control,dict(trainingMode=False))
            self.assertTrue(batch_training_mode(db,config,0))
            self.assertFalse(batch_training_mode(db,config,1))
            db.close()

    def test_forecast_uses_actual_deal_both_roles_and_stable_identities(self):
        requests=rejected_requests([('train:3:7',game())],{})
        self.assertEqual([i for i,_ in requests],['forecast:3:7:1:0','forecast:3:7:1:1'])
        left,right=[r for _,r in requests]
        self.assertEqual(left['own'],list(range(6)))
        self.assertEqual(left['opponent'],list(range(13,19)))
        self.assertEqual(left['selectedDiscard'],[4,5]);self.assertEqual(left['cut'],50)
        self.assertEqual((left['dealer'],right['dealer']),(0,1))
        self.assertEqual(right['opponent'],list(range(6)))
        self.assertEqual([c['outcomes'][0]['scores'] for c in ordinary_cohorts('train:3:7',game())],[[121,100],[100,121]])
        for identity,g in [('eval:0:0',game()),('train:0:0',dict(game(),candidateSide=0)),('train:0:0',dict(game(),trajectory=True))]:
            with self.assertRaisesRegex(ValueError,'ordinary training'):
                list(ordinary_cohorts(identity,g))

    def test_observed_forecast_keeps_first_winner_and_counting_order(self):
        h=game()['hands'][0];h['end']=[None,None]
        self.assertEqual(terminal_hand_scores(h),[121,100])
        h['handPoints']=[29,29]
        self.assertEqual(terminal_hand_scores(h),[90,121])
        h['plays']=[];h['start']=[120,100];h['cut']=10
        self.assertEqual(terminal_hand_scores(h),[121,100])
        h['cut']=11;h['plays']=[dict(action=0,scores=[120,121])]
        self.assertEqual(terminal_hand_scores(h),[120,121])
        h['plays']=[]
        with self.assertRaisesRegex(ValueError,'incomplete'):
            terminal_hand_scores(h)

    def test_canonical_forecast_key_matches_native_format(self):
        self.assertEqual(key([0,2,4,16,18,30],[0,18],[20,30],True),
                         '1:20:30:[0, 2, 4, 16, 18, 30]:[0, 18]')
        self.assertEqual(key([0,2,4,16,18,30],[0,18],[20,30],True),
                         key([13,15,17,3,5,43],[13,5],[20,30],True))

    def test_ordinary_only_forecasts_learn_and_same_world_cannot_double_count(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'base';assets=base/learning.ASSETS;assets.mkdir(parents=True)
            for name in learning.FILES.values():shutil.copyfile(REPO/learning.ASSETS/name,assets/name)
            (assets/'model1323-corrections.bin').write_bytes(b'frozen fixture')
            learning.seal(base,0,None,{},dict(peggingPolicy='28.3-f64-test'))
            cohort=list(ordinary_cohorts('train:0:0',game()))[0]
            duplicate=cohort['outcomes'][0]['key']
            alternatives=dict(cohort,evidenceKind='rejected',outcomes=[dict(key=duplicate,scores=[100,121])]+
                [dict(key=f'alternative-{i}',scores=[121,100]) for i in range(13)])
            target=Path(tmp)/'candidate'
            result=learning.update(base,target,'forecast',[('forecast:0:0:1:0',alternatives),('train:0:0',game())],1000,REPO)
            self.assertEqual(result['ordinaryHands'],2);self.assertEqual(result['rejectedDiscardRollouts'],14)
            table=json.loads((target/learning.ASSETS/learning.FORECAST).read_text())
            self.assertEqual(table['rows'][duplicate],[[121,100]])
            ordinary=Path(tmp)/'ordinary'
            result=learning.update(base,ordinary,'forecast',[('train:0:0',game())],1000,REPO)
            self.assertEqual(result['ordinaryHands'],2);self.assertEqual(result['rejectedDiscardRollouts'],0)
            with self.assertRaisesRegex(ValueError,'no new'):
                learning.update(ordinary,Path(tmp)/'repeat','forecast',[('train:0:0',game())],1000,REPO)

    def test_291_fits_actual_board_residuals_without_sharing_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source';assets=source/learning.ASSETS;assets.mkdir(parents=True)
            for name in learning.FILES.values():shutil.copyfile(REPO/learning.ASSETS/name,assets/name)
            (assets/'model1323-corrections.bin').write_bytes(b'fixture')
            learning.seal(source,12,None,{},dict(binarySha256='old'))
            target=Path(tmp)/'initial'
            learning.inherit(source,target,dict(binarySha256='new'))
            self.assertEqual(learning.verify(target)['model'],'29.1')
            g=game();g['model']='29.1';g['sourceRoot']=str(target);g['forecastInputs']={}
            for actor in (0,1):
                six=g['hands'][0]['dealt'][actor];discard=[4+13*actor,5+13*actor]
                exact=key(six,discard,[90,90],actor==0)
                g['forecastInputs'][exact]=dict(context=key(six,discard,[0,0],actor==0),
                    baseline=.5,features=[1.,.5,.5,0.],styles=[0.,1.,0.])
            child=Path(tmp)/'updated'
            result=learning.update(target,child,'forecast',[('train:0:0',g)],1000,REPO)
            self.assertEqual(result['changed'],[forecast291.FILE])
            data=json.loads((child/learning.ASSETS/forecast291.FILE).read_text())
            mine=data['rows'][key(list(range(6)),[4,5],[0,0],True)]
            self.assertEqual(mine['n'],[0.,1.,0.])
            self.assertGreater(mine['coefficients'][1][0],0.)
            self.assertEqual(mine['coefficients'][0],[0.]*4)
            self.assertNotIn(key([0,1,2,3,4,6],[4,6],[0,0],True),data['rows'])
            boards={}
            self.assertEqual(forecast291.next_wp(target,[121,120],0,boards),1.)
            self.assertEqual(forecast291.next_wp(target,[120,121],0,boards),0.)
            # Counting roles reverse at the next hand, independent of perspective.
            a=forecast291.next_wp(target,[55,65],0,boards)
            b=forecast291.next_wp(target,[65,55],1,boards)
            self.assertAlmostEqual(a,1.-b)

    def test_resume_counts_only_completed_full_games_for_cache_age(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp);db=sqlite3.connect(':memory:')
            db.execute('create table results(id text primary key, request text, root text, result text)')
            request=dict(kind='game',seed=1);result=dict(seconds=1,cache=dict(hits=3))
            db.execute('insert into results values(?,?,?,?)',('train:0:0',json.dumps(request),'root',json.dumps(result)))
            db.execute('insert into results values(?,?,?,?)',('forecast:1:0','{}','root',json.dumps(result)))
            config=dict(output=str(out),workers=2,binary='not called',cacheClockBase=90000)
            with patch('cycle.Worker',side_effect=AssertionError('completed work must not replay')):
                collect(db,config,'root',[('train:0:0',request)],out)
            self.assertEqual(json.loads((out/'cache-clock.json').read_text())['completedGames'],90001)
            progress=json.loads((out/'progress.json').read_text())
            self.assertEqual(progress['completedGames'],1)
            self.assertEqual(progress['cacheClockGames'],90001)
            self.assertEqual(json.loads((out/'cache-progress.json').read_text())['hits'],6)
            with self.assertRaisesRegex(ValueError,'resumed request'):
                collect(db,config,'root',[('train:0:0',dict(kind='game',seed=2))],out)

    def test_original_state_panel_runs_once_after_exactly_five_thousand_training_games(self):
        with tempfile.TemporaryDirectory() as tmp:
            config=dict(output=tmp,trainingGames=200,evaluationEveryGames=5000,evaluationPairs=500,evaluationSeed=900000)
            def collected(db,cfg,current,requests,directory,baseline):
                self.assertEqual(current,Path('candidate'));self.assertEqual(baseline,Path('original'))
                self.assertEqual(len(requests),1000)
                self.assertEqual(len({r['seed'] for _,r in requests}),500)
                self.assertTrue(all(r['cache'] and r['scores']==[0,0] for _,r in requests))
                return [(i,dict(seed=r['seed'],candidateSide=r['candidateSide'],winner=0)) for i,r in requests]
            with patch('cycle.checkpoint'),patch('cycle.verify',return_value=dict(generation=29)),patch('cycle.collect',side_effect=collected) as collector:
                maybe_assess(None,config,Path('candidate'),Path('original'),27,learning.PHASES)
                collector.assert_not_called()
                maybe_assess(None,config,Path('candidate'),Path('original'),28,learning.PHASES)
                maybe_assess(None,config,Path('candidate'),Path('original'),28,learning.PHASES)
                self.assertEqual(collector.call_count,1)
            receipt=json.loads((Path(tmp)/'assessments/000005000.json').read_text())
            self.assertEqual(receipt['games'],1000);self.assertEqual(receipt['assessment']['pairs'],500)

    def test_continuous_updates_skip_consumed_payloads_and_cache_stats_resume_transactionally(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);assets=root/learning.ASSETS;assets.mkdir(parents=True)
            learning.atomic(assets/'model29-state.json',dict(wp=dict(applied=['train:0:0'])))
            db=sqlite3.connect(':memory:')
            db.execute('create table results(id text primary key,request text,root text,result text)')
            db.execute('insert into results values(?,?,?,?)',('train:0:0','{}','root',json.dumps(dict(cache=dict(hits=3)))))
            self.assertEqual(cache_stats(db)['hits'],3);db.commit()
            # Already aggregated/consumed historical payload must not be decoded again.
            db.execute("update results set result='intentionally undecodable' where id='train:0:0'")
            db.execute('insert into results values(?,?,?,?)',('train:1:0','{}','root',json.dumps(dict(cache=dict(hits=2)))))
            self.assertEqual(cache_stats(db)['hits'],5)
            self.assertEqual([i for i,_ in unconsumed_records(db,root,'wp')],['train:1:0'])
            db.rollback()
            self.assertEqual(cache_stats(db)['hits'],3)
            db.close()

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
