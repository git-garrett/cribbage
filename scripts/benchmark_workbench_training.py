"""Read saved training receipts, never datasets, weights or worker databases."""
from pathlib import Path
import math
import re
import time

from benchmark_workbench_assets import read_json


def curve(rows):
    return [dict(epoch=r['epoch'], seconds=r.get('seconds'),
                 **r.get('validation', {}).get('28.3', {})) for r in rows]


def trial_summary(row):
    keys = ('id', 'mode', 'positions', 'hidden', 'seed', 'parameters',
            'chosenEpoch', 'lastEpoch', 'seconds')
    return {**{k: row.get(k) for k in keys},
            'validation': row.get('validation', {}).get('28.3', {}),
            'history': curve(row.get('history', []))}


def game_rate(games, seconds):
    if not all(isinstance(v,(int,float)) and math.isfinite(v) and v>0 for v in (games,seconds)):
        return None
    return dict(games=games,seconds=seconds,gamesPerSecond=games/seconds,gamesPerHour=games/seconds*3600)


def game_pace(rounds, progress, cfg, status, settings, now):
    """Count complete games, with update time separate from game generation."""
    games=sum(r['rollout']['games'] for r in rounds)
    play_seconds=[r['rollout'].get('seconds') for r in rounds]
    update_seconds=[v.get('seconds') for r in rounds for v in r['learning']]
    valid=lambda values:all(isinstance(v,(int,float)) and math.isfinite(v) and v>=0 for v in values)
    play=sum(play_seconds) if valid(play_seconds) else None
    learn=sum(update_seconds) if valid(update_seconds) else None
    result=dict(rollout=game_rate(games,play),training=game_rate(games,play+learn) if play is not None and learn is not None else None,
        current=None,currentLabel='Waiting for game measurements',completedRounds=len(rounds))
    stage=next((s['name'] for s in status.get('stages',[]) if s.get('state')=='running'),'')
    stage=settings.get('stageKinds',{}).get(stage,stage)
    phase=progress.get('phase')
    phases={'train':['self-play'],'evaluate':['evaluation'],'quality':['discard strength'],'speed':['speed']}
    if status.get('state')!='running' or phase not in phases.get(stage,[]):return result
    updated=progress.get('updatedAt')
    if not isinstance(updated,(int,float)) or not 0<=now-updated<90:
        result['currentLabel']='Waiting for a fresh game checkpoint';return result
    n=progress.get('gamesCompleted',0)
    if phase=='self-play':
        # Training progress is cumulative; elapsed seconds cover only this round.
        n-=max(0,progress.get('round',1)-1)*cfg.get('gamesPerRound',0)
    result['current']=game_rate(n,progress.get('seconds'))
    result['currentLabel']='Current round average' if phase=='self-play' else 'Current comparison average'
    return result


def _training_report(entry, status, now=None):
    now = time.time() if now is None else now
    settings = read_json(Path(entry['spec']), {})['trainingStudy']
    if settings.get('mode') == 'roles':
        return build_role_report(entry, status, settings, now)
    if settings.get('mode') == 'discard':
        return build_discard_report(entry, status, settings, now)
    if settings.get('mode') == 'wins':
        return build_win_report(entry, status, settings, now)
    root = Path(entry['root'])
    data = read_json(root / 'data.json', {})
    fits = read_json(root / 'fit-progress.json', {})
    active = read_json(root / 'training-progress.json', {})
    completed_fits = read_json(root / 'fit.json', {})
    # Test results are produced only after validation has frozen model selection.
    results = read_json(root / 'results.json', {})
    trials = [trial_summary(r) for r in completed_fits.get('trials', [])]
    if not trials:
        trials = [trial_summary(r) for p in sorted((root / 'students').glob('*/result.json'))
                  if (r := read_json(p, {})).get('status') == 'complete']
    tests = {r['id']: r for r in results.get('trials', [])}
    for trial in trials:
        test = tests.get(trial['id'], {})
        trial['test'] = test.get('test', {}).get('28.3', {})
        trial['test95'] = test.get('natural283Agreement95')
    trials.sort(key=lambda r: (r['parameters'], r['mode'], r['positions'], r['seed']))
    target = settings['target']
    if fits.get('target', target) != target or len(trials) > target:
        raise ValueError('Training snapshot belongs to a different study target')
    preferred = completed_fits.get('preferredByValidation')
    if not preferred and trials:
        preferred = min(trials, key=lambda r: r['validation'].get('crossEntropy', float('inf')))['id']
    stage_states = {s['name']: s for s in status.get('stages', [])}
    stages = [dict(name=name, state=stage_states.get(name, {}).get('state', 'pending'))
              for name in settings.get('stages', [])]
    stage = next((s['name'] for s in stages if s['state'] in ('running', 'failed')), '')
    state = status.get('state', 'prepared')
    # The final progress receipt still names the last fit during later stages.
    current = None
    trial_id = active.get('trial', '')
    match = re.fullmatch(r'(broad|target-only|fine-tuned)-(\d+)x(\d+)-n(\d+)-s(\d+)', trial_id)
    if stage == 'fit' and state == 'running' and match and trial_id not in {r['id'] for r in trials}:
        checkpoint = read_json(root / 'students' / trial_id / 'checkpoint.json', {})
        hidden = [int(match[2]), int(match[3])]
        parameters = next((a['parameters'] for a in settings.get('architectures', [])
                           if a['hidden'] == hidden), None)
        current = dict(id=trial_id, mode=match[1], hidden=hidden, positions=int(match[4]),
                       parameters=parameters, epoch=active.get('epoch'), bestEpoch=active.get('bestEpoch'),
                       updatedAt=active.get('updatedAt'), seconds=active.get('seconds'),
                       gpuPeakBytes=active.get('gpuPeakBytes'), validation=active.get('natural283', {}),
                       history=curve([r for r in checkpoint.get('history', [])
                                      if r['epoch'] <= (active.get('epoch') or 0)]))
    warnings = []
    if current and now - (current['updatedAt'] or 0) > settings.get('staleAfterSeconds', 600):
        warnings.append('No new epoch receipt in over ten minutes. Showing the last saved training metrics.')
    speed = read_json(root / 'speed.json', {})
    return dict(id=entry['id'], kind='training', title=entry['title'], state=state,
                asOf=now, target=target, completed=len(trials), current=current,
                maxEpochs=settings.get('maxEpochs'), precision=settings.get('precision', 'FP32'),
                stages=stages, stage=stage, trials=trials, preferred=preferred,
                selectionFrozen=bool(completed_fits.get('preferredByValidation')),
                testAvailable=results.get('status') == 'complete',
                data={k: data.get(k) for k in ('decisions', 'games', 'splits', 'teachers')},
                speed=speed, frontier=read_json(root / 'frontier.json', {}),
                verification=read_json(root / 'verification.json', {}).get('status', 'pending'),
                archive=read_json(root / 'sync-receipt.json', {}).get('status', 'pending'),
                playingStrengthMeasured=False, fullGameThroughputMeasured=False, warnings=warnings)


def build_win_report(entry, status, settings, now):
    root = Path(entry['root'])
    cfg = read_json(root / 'config.json', {})
    progress = read_json(root / 'progress.json', {})
    rounds = [read_json(p, {}) for p in sorted((root / 'rounds').glob('[0-9][0-9].json'))]
    history = [dict(round=r['round'], games=r['rollout']['games'],
                    winRate=r['rollout']['paired']['winRate'],
                    gamesPerSecond=r['rollout']['gamesPerSecond'],
                    cpuCores=r['rollout']['meanCpuCores'],
                    learningSeconds=sum(v['seconds'] for v in r['learning']),
                    positions=[v['positions'] for v in r['learning']]) for r in rounds]
    speeds = [read_json(p, {}) for p in sorted((root / 'speed').glob('*.json'))]
    speed_keys = ('case', 'games', 'gamesPerSecond', 'meanCpuCores', 'stageSeconds', 'submissionThrottleSeconds')
    evaluations = [read_json(p, {}) for p in sorted((root / 'rounds').glob('eval-*.json'))]
    evaluation_keys = ('round', 'candidate', 'opponent', 'paired', 'gamesPerSecond')
    completed = sum(r['games'] for r in history)
    if progress.get('phase') == 'self-play':
        completed = max(completed, progress.get('gamesCompleted', 0))
    elif progress.get('phase') == 'learning':
        completed = max(completed, progress.get('round', 0) * cfg.get('gamesPerRound', 0))
    stage = next((s['name'] for s in status.get('stages', []) if s.get('state') in ('running', 'failed')), '')
    reserved = read_json(Path('/private/tmp/model30-reserved-cpus.json'), {})
    workers = reserved.get('allocations', {}).get(entry['id'], 0)
    return dict(id=entry['id'], kind='training', mode='wins', title=entry['title'],
                state=status.get('state', 'prepared'), asOf=now, stage=stage,
                target=settings['target'], completed=completed, rounds=cfg.get('rounds'),
                roundsCompleted=len(history), models=cfg.get('models', []), discardModels=cfg.get('discardModels', []), progress=progress,
                history=history, workers=workers, workerLimit=cfg.get('workerLimit',cfg.get('workers')),
                gamePace=game_pace(rounds,progress,cfg,status,settings,now),
                stages=[dict(name=name,state=next((s.get('state','pending') for s in status.get('stages',[]) if s['name']==name),'pending')) for name in settings.get('stages',[s['name'] for s in status.get('stages',[])])], objective=cfg.get('objective'),
                speed=[{k:r.get(k) for k in speed_keys} for r in speeds],
                evaluations=[{k:r.get(k) for k in evaluation_keys} for r in evaluations],
                quality=[{k:r.get(k) for k in ('candidate','opponent','paired','pegging','gamesPerSecond')} for r in (read_json(root/'quality.json',{}).get('cases') or [read_json(p,{}) for p in sorted(root.glob('quality-[0-9].json'))])],
                gpuDutyLimit=cfg.get('gpuDutyLimit'), warnings=[],
                stageKinds=settings.get('stageKinds', {}), customStageLabels=settings.get('stageLabels', {}),
                familywiseComparisons=settings.get('familywiseComparisons'),
                archive=read_json(root / 'sync-receipt.json', {}).get('status', 'pending'))


def build_role_report(entry, status, settings, now):
    root=Path(entry['root']);cfg=read_json(root/'config.json',{});summary=read_json(root/'summary.json',{})
    progress=read_json(root/'progress.json',{});phase=progress.get('phase');fresh=0<=now-progress.get('updatedAt',0)<90
    stage=next((s['name'] for s in status.get('stages',[]) if s.get('state') in ('running','failed')),'')
    computing=settings.get('stageKinds',{}).get(stage,stage)=='train' and status.get('state')=='running'
    playing=fresh and computing and phase in ('self-play','evaluation')
    saved=next((s.get('completedRounds',0) for s in summary.get('sizes',[]) if s['name']==progress.get('size')),0)
    unfinished=progress.get('round',0)>saved
    completed=summary.get('games',0)
    if fresh and computing and unfinished and phase=='self-play':completed+=progress.get('gamesCompleted',0)
    if fresh and computing and unfinished and phase in ('learning','table update'):completed+=cfg.get('gamesPerRound',0)
    games=summary.get('games',0);play=summary.get('rolloutSeconds',0);update=summary.get('updateSeconds',0)
    stage=next((s['name'] for s in status.get('stages',[]) if s.get('state') in ('running','failed')),'')
    workers=read_json(Path('/private/tmp/model30-reserved-cpus.json'),{}).get('allocations',{}).get(entry['id'],0)
    sizes=summary.get('sizes',cfg.get('sizes',[]));comparisons=len(cfg.get('sizes',[]))*(cfg.get('maxRounds',0)//2+1)
    return dict(id=entry['id'],kind='training',mode='wins',roleStudy=True,learningMode=cfg.get('mode'),title=entry['title'],
        state=status.get('state','prepared'),asOf=now,stage=stage,target=settings['target'],completed=completed,
        rounds=cfg.get('maxRounds',0)*len(cfg.get('sizes',[])),roundsCompleted=summary.get('completedRounds',0),
        sizes=sizes,models=[dict(name=s['name'],parameters=s.get('totalParameters',0)) for s in sizes],discardModels=[],
        progress=progress,history=[],speed=[],quality=[],evaluations=summary.get('evaluations',[]),
        workers=workers,workerLimit=1,gpuDutyLimit=None,gpuShareDescription=cfg.get('gpuShareDescription'),
        gamePace=dict(rollout=game_rate(games,play),training=game_rate(games,play+update),
            current=game_rate(progress.get('gamesCompleted'),progress.get('seconds')) if playing else None,
            currentLabel='Current assessment average' if phase=='evaluation' else 'Current round average'),
        objective=('Odd rounds learn from a frozen next-hand WP table. Even rounds freeze all four networks and update the table from actual game winners.' if cfg.get('mode')=='alternating' else 'Four independent role networks learn from ultimate game wins in every round.'),
        stages=[dict(name=n,state=next((s.get('state','pending') for s in status.get('stages',[]) if s['name']==n),'pending')) for n in settings['stages']],
        stageKinds=settings.get('stageKinds',{}),customStageLabels=settings.get('stageLabels',{}),
        familywiseComparisons=comparisons,warnings=[],archive=read_json(root/'sync-receipt.json',{}).get('status','pending'))


def build_discard_report(entry, status, settings, now):
    root=Path(entry['root']);cfg=read_json(root/'config.json',{});data=read_json(root/'data.json',{})
    active=read_json(root/'progress.json',{});sealed=read_json(root/'heldout.json',{})
    tests={r['name']:r['test'] for r in sealed.get('results',[])}
    def target(values):
        rows=[values[k] for k in ('28.3','28.3.fast') if k in values]
        if not rows:return values.get('all',{})
        return dict(agreement=sum(r['agreement'] for r in rows)/len(rows),
                    crossEntropy=sum(r['crossEntropy'] for r in rows)/len(rows),decisions=sum(r['decisions'] for r in rows))
    def curve(rows):return [dict(epoch=r['epoch'],seconds=r.get('seconds'),**target(r.get('validation',{}))) for r in rows]
    trials=[]
    for p in sorted((root/'students').glob('*/result.json')):
        r=read_json(p,{});spec=next(m for m in cfg['discardModels'] if m['name']==r['name'])
        trials.append(dict(id=p.parent.name,mode=r['phase'],positions=r['trainingDecisions'],hidden=spec['hidden'],seed=cfg['fitSeed'],
             parameters=r['parameters'],chosenEpoch=r['bestEpoch'],lastEpoch=r['epochs'],seconds=r['seconds'],
             validation=target(r['validation']),history=curve(r['history']),test=target(tests.get(r['name'],{})) if r['phase']=='modern' else {}))
    states={s['name']:s for s in status.get('stages',[])}
    stage=next((s['name'] for s in status.get('stages',[]) if s.get('state') in ('running','failed')),'')
    current=None
    if active.get('phase')=='fit discard' and status.get('state')=='running':
        name=active['model']+'-'+active['cohort'];cp=read_json(root/'students'/name/'checkpoint.json',{})
        spec=next(m for m in cfg['discardModels'] if m['name']==active['model'])
        current=dict(id=name,mode=active['cohort'],positions=active['decisionsPlanned'],hidden=spec['hidden'],parameters=spec['parameters'],
             epoch=active['epoch'],bestEpoch=cp.get('bestEpoch',-1)+1,updatedAt=active['updatedAt'],seconds=cp.get('seconds'),
             history=curve(cp.get('history',[])),validation=target(active.get('lastValidation') or {}))
        if name in {r['id'] for r in trials}:current=None
    preferred=min(trials,key=lambda r:r['validation'].get('crossEntropy',float('inf')))['id'] if trials else None
    counts=data.get('splitCounts',[0,0,0])
    return dict(id=entry['id'],kind='training',mode='discard',title=entry['title'],state=status.get('state','prepared'),
        asOf=now,target=4,completed=len(trials),current=current,maxEpochs=active.get('epochs',cfg.get('fitEpochs')),precision='FP32',
        stages=[dict(name=n,state=states.get(n,{}).get('state','pending')) for n in settings.get('stages',[])],stage=stage,
        trials=trials,preferred=preferred,selectionFrozen=len(trials)==4,testAvailable=sealed.get('status')=='complete',
        data=dict(decisions=data.get('decisions'),games=data.get('originalDealSeeds'),splits=dict(zip(['train','validation','test'],counts)),
                  teachers={k:sum(v) for k,v in data.get('models',{}).items()}),speed={},frontier={},
        verification=read_json(root/'verification.json',{}).get('status','pending'),archive=read_json(root/'sync-receipt.json',{}).get('status','pending'),
        playingStrengthMeasured=False,fullGameThroughputMeasured=False,warnings=[])


STAGE_LABELS = {
    'data': 'Prepare recorded decisions', 'fit': 'Fit models to saved choices',
    'train': 'Train models', 'test': 'Test on unseen decisions',
    'await-fit': 'Wait for trained discards', 'speed': 'Measure full-game speed',
    'evaluate': 'Evaluate against starting models', 'quality': 'Compare discards against Ace',
    'verify': 'Verify results', 'report': 'Write final report', 'sync': 'Archive to TerraMaster',
}


def activity(report, status):
    """Describe the current operation, never substitute total training for it."""
    mode=report.get('mode');wins=mode=='wins';raw_stage=report.get('stage','')
    stage=report.get('stageKinds',{}).get(raw_stage,raw_stage)
    state=status.get('state','prepared');root=Path(report['_root'])
    progress=read_json(root/'progress.json',{})
    if report.get('roleStudy'):
        phase=progress.get('phase','preparing');r=progress.get('round');size=progress.get('size','')
        table=report.get('learningMode')=='alternating' and isinstance(r,int) and r%2==0 and phase!='evaluation'
        labels=dict(report.get('customStageLabels',{}))
        kind={'self-play':'Playing games','learning':'Updating four role networks','table update':'Updating WP table','evaluation':'Assessing strength','complete':'Finished'}.get(phase,'Preparing')
        detail=('Frozen-policy games gather actual winners for the next WP table; network weights do not change.' if table else 'Frozen paired holdout games against this size’s starting player; no learning.' if phase=='evaluation' else report['objective'])
        label=(f'Round {r} · '+('WP table' if table else 'assessment' if phase=='evaluation' else 'policy learning')) if r is not None else labels.get(raw_stage,'Preparing four-role study')
        if state in ('failed','stopped','interrupted'):kind='Needs attention';label=state.capitalize()+': '+label
        elif state=='complete':kind='Finished';label='Verified and archived';detail='Per-size results state whether stability was measured or the round limit was reached.'
        elif stage in ('verify','report','sync'):
            kind='Archiving' if stage=='sync' else 'Checking results';label=labels.get(raw_stage,raw_stage)
            detail='Copy committed checkpoints and game records to TerraMaster, verify them, then release older temporary files.' if stage=='sync' else 'Verify and summarize the committed study results.'
        active=stage=='train' and state=='running'
        return dict(label=label,kind=kind,detail=detail,completed=progress.get('gamesCompleted') if active and phase in ('self-play','evaluation') else None,
            target=progress.get('gamesPlanned') if active else None,unit='full games in this round',context=(size+(' · '+progress['network'] if progress.get('network') else '')) if active else '',stageLabels=labels,state=state)
    phases={'speed':['speed'],'train':['self-play','learning'],'evaluate':['evaluation'],'quality':['discard strength']}
    live=progress if progress.get('phase') in phases.get(stage,[]) else {}
    labels=dict(STAGE_LABELS,train='Learn from game wins' if wins else 'Fit discard models' if mode=='discard' else 'Fit models to saved choices')
    label=labels.get(stage,stage.replace('-',' ') or 'Preparing')
    labels.update(report.get('customStageLabels',{}))
    label=labels.get(raw_stage,label)
    kind='Playing games' if wins and stage in ('speed','evaluate','quality','train') else 'Learning from saved decisions'
    details={
        'data':'Collect qualified Ace decisions and keep training, validation and test games separate.',
        'train':('Play full games with both models frozen, then update between rounds using wins and losses.' if wins else 'Learn recorded card choices. This stage does not play new games.'),
        'fit':'Learn recorded card choices. This stage does not play new games.',
        'test':'Measure choice agreement on decisions withheld from fitting. This is not a win-rate test.',
        'await-fit':'Game play starts automatically after discard fitting, checks and archive finish.',
        'speed':'Play full games with fixed weights to compare CPU/GPU throughput and batch sizes.',
        'evaluate':'Play the updated model against its frozen starting model. These games do not update weights.',
        'quality':'Compare learned discard with native Ace discard; both players use identical frozen neural pegging. Weights stay fixed.',
        'verify':'Check saved games, seed separation and model files before accepting the results.',
        'report':'Assemble the verified results into the final report.',
        'sync':'Copy results to TerraMaster and verify the saved copy.',
    }
    detail=details.get(stage,'Waiting for the next stage.')
    if wins and stage=='train' and live.get('phase')=='learning':kind='Updating model weights';label='Learning from the completed round'
    elif stage=='await-fit':kind='Waiting';label='Waiting for discard training'
    elif stage in ('test','verify','report','sync'):kind='Checking results' if stage!='sync' else 'Archiving'
    if raw_stage=='await-pilot':
        kind='Waiting';label=labels.get(raw_stage,'Waiting for the pilot')
        detail='Starts automatically after the current pilot finishes its checks and TerraMaster archive. No CPU worker is reserved while waiting.'
    n=live.get('gamesCompleted');target=live.get('gamesPlanned');unit='games in this comparison'
    context=live.get('case') or ((live.get('model','').capitalize()+' model').strip() if live.get('model') else '')
    if wins and stage=='train':n=report['completed'];target=report['target'];unit='training games'
    if not wins and report.get('current'):
        cur=report['current'];n=cur.get('epoch');target=report.get('maxEpochs');unit='training passes (maximum)'
        context=(f"{cur['parameters']:,} parameters" if cur.get('parameters') is not None else "Model fit")+" · "+('all qualified Ace data' if cur.get('mode')=='broad' else 'modern Ace fine-tuning' if cur.get('mode')=='modern' else cur.get('mode',''))
    if state=='complete':
        kind='Finished';label='Game study complete' if wins else 'Discard fitting complete' if mode=='discard' else 'Fitting study complete'
        detail='All stages in this block are complete and archived.'
        n=target=None;context=''
    elif state in ('failed','stopped','interrupted'):
        kind='Needs attention' if state=='failed' else 'Stopped';label=kind+': '+label;n=target=None;context=''
        detail='This block will not advance until it is resumed. Saved results are retained.'
    return dict(label=label,kind=kind,detail=detail,completed=n,target=target,unit=unit,context=context,
                stageLabels=labels,state=state)


def workflow_summary(settings):
    """Join the two explicitly linked jobs using only saved status receipts."""
    flow=settings.get('workflow')
    if not flow:return None
    roots={k:Path(v) for k,v in flow['roots'].items()} if 'roots' in flow else {k:Path(flow[k+'Root']) for k in ('fit','play')}
    statuses={k:read_json(r/'job/status.json',{}) for k,r in roots.items()}
    stages={k:{s['name']:s.get('state','pending') for s in v.get('stages',[])} for k,v in statuses.items()}
    descriptions=[(s['job'],s['stages'],s['label'],s['description'],flow['ids'][s['job']]) for s in flow['steps']] if 'steps' in flow else [
        ('fit',['data','train'],'Fit discard models','Learn from saved Ace choices; no new games.',flow['fitId']),
        ('fit',['test','verify','report','sync'],'Check and save the models','Test on unseen decisions and archive the trained weights.',flow['fitId']),
        ('play',['await-fit','speed'],'Measure game speed','Play fixed models through CPU/GPU batch tests.',flow['playId']),
        ('play',['train'],'Learn by self-play','Play full games, then update discard and pegging from wins.',flow['playId']),
        ('play',['evaluate'],'Test improvement','Play against each model’s frozen starting version.',flow['playId']),
        ('play',['quality'],'Test discard against Ace','Same neural pegging on both sides; only discard differs.',flow['playId']),
        ('play',['verify','report','sync'],'Verify and archive results','Check all results, write the report and verify the TerraMaster copy.',flow['playId']),
    ]
    steps=[]
    for job,names,label,detail,ident in descriptions:
        values=[stages[job].get(n,'pending') for n in names]
        done=all(v=='complete' for v in values)
        state='complete' if done else 'failed' if 'failed' in values else 'running' if 'running' in values else 'pending'
        job_state=statuses[job].get('state')
        if not done and state=='running' and job_state in ('stopped','interrupted'):state='stopped'
        # Await-fit is a live supervisor, but the game-speed step is still waiting.
        if job=='play' and names[0]=='await-fit' and stages[job].get('await-fit')=='running':state='waiting'
        if names[0]=='await-pilot' and stages[job].get('await-pilot')=='running':state='waiting'
        if state=='pending' and job_state=='failed':state='blocked'
        steps.append(dict(label=label,description=detail,state=state,jobId=ident))
    complete=all(s['state']=='complete' for s in steps)
    problem=next((s for s in steps if s['state'] in ('failed','stopped')),None)
    active=problem or next((s for s in steps if s['state']=='running'),None) or next((s for s in steps if s['state']!='complete'),None)
    label='Study complete' if complete else ('Needs attention · ' if problem else 'Now · ')+(active['label'] if active else 'Preparing')
    after=steps[steps.index(active)+1:] if active else []
    next_step=next((s['label'] for s in after if s['state']!='complete'),None)
    return dict(title=flow.get('title','Discard + pegging · whole study'),label=label,state='complete' if complete else 'blocked' if problem else 'running',
                completed=sum(s['state']=='complete' for s in steps),total=len(steps),steps=steps,next=next_step,
                note='All fitting, game tests, verification and archiving are complete.' if complete else
                     'A completed fit or training round is one part of this study. The study finishes after the last archive check.')


def build_training_report(entry, status, now=None):
    report=_training_report(entry,status,now)
    settings=read_json(Path(entry['spec']),{})['trainingStudy']
    report['_root']=entry['root'];report['activity']=activity(report,status);del report['_root']
    report['workflow']=workflow_summary(settings)
    return report
