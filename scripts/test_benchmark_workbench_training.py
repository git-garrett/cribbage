import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from benchmark_workbench import job_entry, job_status, register
from benchmark_workbench_training import build_training_report


class TrainingWorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.spec = self.root / 'workbench.json'
        self.save('workbench.json', dict(jobId='training-test', jobRoot=str(self.root / 'job'),
            trainingStudy=dict(root=str(self.root), target=2, maxEpochs=32,
                stages=['fit', 'evaluate', 'sync'], architectures=[dict(hidden=[64, 64], parameters=91418)])))
        self.entry = job_entry(self.spec)
        self.trial = 'broad-64x64-n100-s1'
        self.history = [dict(epoch=1, validation={'28.3': dict(agreement=.7, crossEntropy=.5, decisions=30)})]
        self.row = dict(status='complete', id=self.trial, mode='broad', hidden=[64, 64], parameters=91418,
            positions=100, seed=1, chosenEpoch=1, lastEpoch=1, seconds=10,
            validation={'28.3': dict(agreement=.7, crossEntropy=.5)}, history=self.history)
        self.status = dict(state='running', stages=[dict(name='fit', state='running')])

    def save(self, name, value):
        path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value)); return path

    def test_registration_observes_existing_supervisor_without_mutation(self):
        self.save('job/status.json', self.status)
        before = self.spec.read_bytes()
        entry = register(self.spec, self.root / 'ui')
        self.assertEqual(entry['kind'], 'training')
        self.assertEqual(job_status(entry), self.status)
        self.assertEqual(self.spec.read_bytes(), before)

    def test_current_epoch_curves_without_datasets_or_databases(self):
        self.save('training-progress.json', dict(trial=self.trial, epoch=1, bestEpoch=1, updatedAt=1000, natural283=dict(agreement=.7)))
        self.save(f'students/{self.trial}/checkpoint.json', dict(epoch=1, bestEpoch=1, history=self.history + [dict(self.history[0], epoch=2)]))
        with patch('sqlite3.connect', side_effect=AssertionError('No database access')):
            result = build_training_report(self.entry, self.status, now=1100)
        self.assertEqual(result['completed'], 0)
        self.assertEqual(result['current']['epoch'], 1)
        self.assertEqual(result['current']['parameters'], 91418)
        self.assertEqual(result['current']['history'][0]['agreement'], .7)
        self.assertEqual(len(result['current']['history']), 1)
        self.assertFalse(result['testAvailable'])
        self.assertFalse(result['playingStrengthMeasured'])

    def test_selection_by_loss_not_agreement_and_no_invented_test(self):
        self.save(f'students/{self.trial}/result.json', self.row)
        other = dict(self.row, id='broad-64x64-n100-s2', seed=2, validation={'28.3': dict(agreement=.8, crossEntropy=.6)})
        self.save(f"students/{other['id']}/result.json", other)
        result = build_training_report(self.entry, self.status)
        self.assertEqual(result['completed'], 2)
        self.assertEqual(result['preferred'], self.trial)
        self.assertFalse(result['selectionFrozen'])
        self.assertEqual(result['trials'][0]['test'], {})

    def test_finished_fits_are_not_overall_completion_and_test_preserves_selection(self):
        self.save('fit.json', dict(trials=[self.row], preferredByValidation=self.trial))
        self.save('training-progress.json', dict(trial=self.trial, epoch=1, updatedAt=1))
        self.save('results.json', dict(status='complete', trials=[dict(id=self.trial, test={'28.3': dict(agreement=.69)}, natural283Agreement95=[.65,.73])]))
        status = dict(state='running', stages=[dict(name='fit', state='complete'), dict(name='sync', state='running')])
        result = build_training_report(self.entry, status)
        self.assertIsNone(result['current']); self.assertEqual(result['state'], 'running')
        self.assertEqual(result['archive'], 'pending'); self.assertTrue(result['testAvailable'])
        self.assertEqual(result['preferred'], self.trial); self.assertEqual(result['trials'][0]['test95'], [.65,.73])
        self.assertEqual(result['trials'][0]['history'][0]['epoch'], 1)

    def test_all_curricula_and_stale_active_snapshot(self):
        for mode in ['broad', 'target-only', 'fine-tuned']:
            trial = f'{mode}-64x64-n100-s1'
            self.save('training-progress.json', dict(trial=trial, updatedAt=1))
            result = build_training_report(self.entry, self.status, now=1000)
            self.assertEqual(result['current']['mode'], mode)
            self.assertTrue(result['warnings'])

    def test_prepared_and_wrong_target(self):
        result = build_training_report(self.entry, {})
        self.assertEqual(result['state'], 'prepared'); self.assertEqual(result['completed'], 0)
        self.save('fit-progress.json', dict(target=999))
        with self.assertRaises(ValueError): build_training_report(self.entry, self.status)

    def test_outcome_learning_reports_games_not_imitation_accuracy(self):
        self.save('workbench.json',dict(jobId='training-test',jobRoot=str(self.root/'job'),
                  trainingStudy=dict(root=str(self.root),target=1024,mode='wins')))
        self.save('config.json',dict(rounds=2,workers=2,models=[dict(parameters=378522),dict(parameters=1433882)]))
        self.save('rounds/00.json',dict(round=1,rollout=dict(games=512,paired=dict(winRate=.51),
                  gamesPerSecond=3,meanCpuCores=1.5,outcomes=[dict(private='not exposed')]),
                  learning=[dict(seconds=10,positions=9000),dict(seconds=20,positions=9000)]))
        self.save('progress.json',dict(phase='self-play',gamesCompleted=768))
        self.save('rounds/eval-01-0.json',dict(round=1,candidate='small',opponent='initial',
                  paired=dict(winRate=.5,paired95=[.48,.52]),outcomes=[dict(private='not exposed')]))
        with patch('sqlite3.connect', side_effect=AssertionError('No database access')):
            result=build_training_report(self.entry,dict(state='running',stages=[dict(name='train',state='running')]))
        self.assertEqual(result['mode'],'wins');self.assertEqual(result['completed'],768)
        self.assertEqual(result['roundsCompleted'],1);self.assertEqual(result['history'][0]['learningSeconds'],30)
        self.assertNotIn('outcomes',result['evaluations'][0]);self.assertNotIn('trials',result)
        self.assertEqual(result['archive'],'pending')

    def test_role_study_distinguishes_table_rounds_and_local_game_progress(self):
        self.save('workbench.json',dict(jobId='training-test',jobRoot=str(self.root/'job'),trainingStudy=dict(
            root=str(self.root),target=3200000,mode='roles',stages=['cycle-01','sync'],stageKinds={'cycle-01':'train'})))
        self.save('config.json',dict(mode='alternating',maxRounds=32,gamesPerRound=100000,
            sizes=[dict(name='379k',parameters=[1,1,2,2],totalParameters=6)]))
        self.save('summary.json',dict(games=100000,rolloutSeconds=100,updateSeconds=100,completedRounds=1))
        self.save('progress.json',dict(phase='self-play',round=2,size='379k',gamesCompleted=5000,gamesPlanned=100000,seconds=10,updatedAt=1000))
        status=dict(state='running',stages=[dict(name='cycle-01',state='running')])
        report=build_training_report(self.entry,status,now=1001)
        self.assertTrue(report['roleStudy']);self.assertEqual(report['completed'],105000)
        self.assertEqual(report['gamePace']['current']['gamesPerSecond'],500)
        self.assertEqual(report['gamePace']['training']['gamesPerSecond'],500)
        self.assertIn('WP table',report['activity']['label'])
        self.assertIn('weights do not change',report['activity']['detail'])
        self.save('progress.json',dict(phase='evaluation',round=2,size='379k',gamesCompleted=5000,gamesPlanned=20000,seconds=10,updatedAt=1000))
        report=build_training_report(self.entry,status,now=1001)
        self.assertEqual(report['completed'],100000);self.assertEqual(report['activity']['kind'],'Assessing strength')

    def test_large_continuation_labels_evaluation_and_waiting_correctly(self):
        settings=dict(root=str(self.root),target=1048576,mode='wins',familywiseComparisons=8,
            stages=['await-pilot','eval-0','train-8','eval-8','sync'],
            stageKinds={'await-pilot':'await-fit','eval-0':'evaluate','train-8':'train','eval-8':'evaluate'},
            stageLabels={'await-pilot':'Wait for the pilot','eval-8':'Assess round 8 · 200,000 games'})
        self.save('workbench.json',dict(jobId='training-test',jobRoot=str(self.root/'job'),trainingStudy=settings))
        self.save('config.json',dict(rounds=32,workers=1,workerLimit=12,gamesPerRound=32768))
        self.save('progress.json',dict(phase='evaluation',gamesCompleted=8192,gamesPlanned=100000,model='small',round=8))
        result=build_training_report(self.entry,dict(state='running',stages=[dict(name='eval-8',state='running')]))
        self.assertEqual(result['completed'],0);self.assertEqual(result['activity']['completed'],8192)
        self.assertEqual(result['activity']['target'],100000);self.assertIn('Assess round 8',result['activity']['label'])
        self.assertEqual(result['familywiseComparisons'],8);self.assertEqual(result['workerLimit'],12)
        result=build_training_report(self.entry,dict(state='running',stages=[dict(name='await-pilot',state='running')]))
        self.assertEqual(result['activity']['kind'],'Waiting');self.assertIsNone(result['activity']['completed'])
        self.assertIn('No CPU worker',result['activity']['detail'])



class DiscardWorkbenchTests(unittest.TestCase):
    def test_current_discard_fit_has_no_pegging_or_test_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            def save(name,value):
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value))
            save('workbench.json',dict(jobId='discard-test',jobRoot=str(root/'job'),trainingStudy=dict(root=str(root),mode='discard',target=4,stages=['data','train','test'])))
            save('config.json',dict(discardModels=[dict(name='small',hidden=[512,384],parameters=387230)],fitSeed=1,fitEpochs=16))
            save('progress.json',dict(phase='fit discard',model='small',cohort='broad',decisionsPlanned=1000,epoch=2,updatedAt=1000))
            save('data.json',dict(decisions=1200,originalDealSeeds=100,splitCounts=[1000,100,100],models={'9.0':[900,90,90],'28.3':[100,10,10]}))
            save('students/small-broad/checkpoint.json',dict(bestEpoch=0,seconds=3,history=[dict(epoch=1,validation={'28.3':dict(agreement=.8,crossEntropy=.5,decisions=10),'28.3.fast':dict(agreement=.7,crossEntropy=.7,decisions=2)})]))
            with patch('sqlite3.connect',side_effect=AssertionError('No DB reads')):
                r=build_training_report(job_entry(root/'workbench.json'),dict(state='running',stages=[dict(name='train',state='running')]),now=1100)
            self.assertEqual(r['mode'],'discard');self.assertEqual(r['current']['parameters'],387230)
            self.assertEqual(r['current']['history'][0]['crossEntropy'],.6)
            self.assertEqual(r['data']['teachers']['9.0'],1080);self.assertFalse(r['testAvailable'])
            self.assertFalse(r['playingStrengthMeasured'])



class GamePaceTests(unittest.TestCase):
    def test_training_includes_updates_and_weights_by_total_time(self):
        from benchmark_workbench_training import game_pace
        rounds=[dict(rollout=dict(games=100,seconds=10),learning=[dict(seconds=30)]),
                dict(rollout=dict(games=300,seconds=90),learning=[dict(seconds=70)])]
        pace=game_pace(rounds,{}, {},{}, {},1000)
        self.assertEqual(pace['rollout']['gamesPerSecond'],4)
        self.assertEqual(pace['training']['gamesPerSecond'],2)
        self.assertEqual(pace['training']['gamesPerHour'],7200)
        self.assertEqual(pace['training']['games'],400)

    def test_live_round_subtracts_prior_rounds_from_cumulative_count(self):
        from benchmark_workbench_training import game_pace
        progress=dict(phase='self-play',round=3,gamesCompleted=2250,seconds=10,updatedAt=1000)
        state=dict(state='running',stages=[dict(name='train-8',state='running')])
        pace=game_pace([],progress,dict(gamesPerRound=1000),state,dict(stageKinds={'train-8':'train'}),1001)
        self.assertEqual(pace['current']['gamesPerSecond'],25)
        self.assertEqual(pace['current']['games'],250)

    def test_stale_wrong_phase_and_learning_are_not_current_game_pace(self):
        from benchmark_workbench_training import game_pace
        progress=dict(phase='evaluation',gamesCompleted=100,seconds=10,updatedAt=1000)
        state=dict(state='running',stages=[dict(name='evaluate',state='running')])
        self.assertEqual(game_pace([],progress,{},state,{},1001)['current']['gamesPerSecond'],10)
        self.assertIsNone(game_pace([],progress,{},state,{},1200)['current'])
        self.assertIsNone(game_pace([],progress,{},dict(state='stopped',stages=state['stages']),{},1001)['current'])
        progress['phase']='learning'
        self.assertIsNone(game_pace([],progress,{},state,{},1001)['current'])

    def test_unmeasured_or_missing_timing_does_not_invent_speed(self):
        from benchmark_workbench_training import game_pace
        self.assertIsNone(game_pace([],{}, {},{}, {},1000)['training'])
        missing=[dict(rollout=dict(games=100),learning=[dict(seconds=20)])]
        self.assertIsNone(game_pace(missing,{}, {},{}, {},1000)['training'])


class WholeStudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.fit=self.root/'fit';self.play=self.root/'play'
        self.flow=dict(workflow=dict(fitRoot=str(self.fit),playRoot=str(self.play),fitId='discard-fit',playId='dual-games'))
    def save(self,root,name,value):
        p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value))
    def test_finished_fitting_is_not_finished_study(self):
        from benchmark_workbench_training import workflow_summary
        self.save(self.fit,'job/status.json',dict(state='complete',stages=[dict(name=n,state='complete') for n in ['data','train','test','verify','report','sync']]))
        self.save(self.play,'job/status.json',dict(state='running',stages=[dict(name=n,state='complete') for n in ['await-fit','speed','train','evaluate']]+[dict(name='quality',state='running')]))
        with patch('sqlite3.connect',side_effect=AssertionError('Metadata only')):r=workflow_summary(self.flow)
        self.assertEqual(r['state'],'running');self.assertEqual(r['completed'],5);self.assertEqual(r['total'],7)
        self.assertEqual(r['label'],'Now · Test discard against Ace');self.assertEqual(r['next'],'Verify and archive results')
        self.assertEqual(r['steps'][-1]['state'],'pending')
    def test_upstream_failure_does_not_look_like_active_games(self):
        from benchmark_workbench_training import workflow_summary
        self.save(self.fit,'job/status.json',dict(state='failed',stages=[dict(name='train',state='failed')]))
        self.save(self.play,'job/status.json',dict(state='running',stages=[dict(name='await-fit',state='running')]))
        r=workflow_summary(self.flow);self.assertEqual(r['state'],'blocked');self.assertEqual(r['steps'][2]['state'],'waiting')
    def test_completion_requires_archive(self):
        from benchmark_workbench_training import workflow_summary
        self.save(self.fit,'job/status.json',dict(state='complete',stages=[dict(name=n,state='complete') for n in ['data','train','test','verify','report','sync']]))
        stages=[dict(name=n,state='complete') for n in ['await-fit','speed','train','evaluate','quality','verify','report']]
        self.save(self.play,'job/status.json',dict(state='running',stages=stages+[dict(name='sync',state='running')]))
        self.assertEqual(workflow_summary(self.flow)['state'],'running')
        self.save(self.play,'job/status.json',dict(state='complete',stages=stages+[dict(name='sync',state='complete')]))
        self.assertEqual(workflow_summary(self.flow)['state'],'complete')
    def test_activity_counts_current_evaluation_not_completed_training(self):
        from benchmark_workbench_training import activity
        report=dict(mode='wins',stage='quality',_root=str(self.play),completed=16384,target=16384)
        self.save(self.play,'progress.json',dict(phase='discard strength',gamesCompleted=1024,gamesPlanned=10000,model='small'))
        r=activity(report,dict(state='running'));self.assertEqual(r['kind'],'Playing games');self.assertEqual(r['completed'],1024)
        self.assertEqual(r['target'],10000);self.assertIn('Weights stay fixed',r['detail'])
        self.save(self.play,'progress.json',dict(phase='self-play',gamesCompleted=16384,gamesPlanned=16384))
        self.assertIsNone(activity(report,dict(state='running'))['completed'])

    def test_role_archive_stage_hides_stale_evaluation(self):
        from benchmark_workbench_training import activity
        report=dict(mode='wins',roleStudy=True,learningMode='alternating',stage='checkpoint-01',
            stageKinds={'checkpoint-01':'sync'},customStageLabels={'checkpoint-01':'Archive cycle 1'},
            _root=str(self.play),objective='Alternating WP')
        self.save(self.play,'progress.json',dict(phase='evaluation',round=2,size='379k',gamesCompleted=20000,gamesPlanned=20000))
        row=activity(report,dict(state='running'))
        self.assertEqual(row['kind'],'Archiving');self.assertEqual(row['label'],'Archive cycle 1')
        self.assertIsNone(row['completed']);self.assertIsNone(row['target']);self.assertEqual(row['context'],'')

    def test_custom_continuation_workflow_waits_and_requires_final_archive(self):
        from benchmark_workbench_training import workflow_summary
        flow=dict(workflow=dict(title='Large study',roots=dict(scale=str(self.play)),ids=dict(scale='large'),
            steps=[dict(job='scale',stages=[n],label=n,description=n) for n in ['await-pilot','eval-0','train-8','sync']]))
        self.save(self.play,'job/status.json',dict(state='running',stages=[dict(name='await-pilot',state='running')]))
        r=workflow_summary(flow);self.assertEqual(r['title'],'Large study');self.assertEqual(r['steps'][0]['state'],'waiting')
        self.assertEqual(r['total'],4);self.assertEqual(r['completed'],0)

if __name__ == '__main__': unittest.main()
