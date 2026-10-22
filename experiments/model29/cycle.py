#!/usr/bin/env python3
"""Resumable, bounded learning cycles. Launch through cribbage_job_queue.py."""
import argparse
import concurrent.futures
import json
import itertools
import math
import os
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path
from learning import ASSETS, PHASES, atomic, sha, update, verify, verify_source
from forecast import training_mode, rejected_requests


class Worker:
    def __init__(self, binary, root, reference=None):
        args = [binary, str(root)] + ([str(reference)] if reference else [])
        lease = os.environ.get('MODEL29_LEASE_FD')
        self.reference = reference
        self.policy_binary = sha(binary) if reference else None
        self.snapshots = [sha(Path(p)/ASSETS/'model29-generation.json') for p in (root,reference)] if reference else []
        self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True,pass_fds=(int(lease),) if lease else ())

    def call(self, request):
        self.process.stdin.write(json.dumps(request)+'\n'); self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('native worker exited before completing request')
        response = json.loads(line)
        if not response.get('ok'):
            raise RuntimeError(response.get('error','native worker failed'))
        result=response['result']
        if self.reference:
            if result.get('benchmark',{}).get('schemaVersion')!=1:raise ValueError('evaluation telemetry missing')
            result['benchmark'].update(recorderSha256=self.policy_binary,policyBinarySha256=self.policy_binary,snapshots=self.snapshots)
        return result

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate(); self.process.wait(timeout=10)
        self.process.stdout.close()


def assessment(games, margin, comparisons=1):
    by_seed = {}
    for game in games:
        seed, side = game['seed'], game['candidateSide']
        sides = by_seed.setdefault(seed,{})
        if side in sides or side not in (0,1):
            raise ValueError('duplicate or invalid paired orientation')
        sides[side] = int(game['winner'] == side)
    if not by_seed or any(set(sides) != {0,1} for sides in by_seed.values()):
        raise ValueError('incomplete paired evaluation')
    scores = [sum(s.values())/2 for s in by_seed.values()]
    mean = sum(scores)/len(scores)
    # Familywise Hoeffding bound, treating each seed pair as one independent unit.
    radius = math.sqrt(math.log(40*comparisons)/(2*len(scores)))
    low, high = max(0.,mean-radius), min(1.,mean+radius)
    return dict(pairs=len(scores), games=len(games), winRate=mean, confidence95=[low,high],
                status='passed' if low >= .5-margin else 'regressed' if high < .5-margin else 'inconclusive',
                noninferiorityMargin=margin, method='paired-seed Hoeffding, Bonferroni across planned gates')


def validate(config):
    for name, low, high in [('rounds',1,1000),('trainingGames',2,100000),('evaluationPairs',1,100000),('workers',1,12)]:
        if type(config.get(name)) is not int or not low <= config[name] <= high:
            raise ValueError('invalid '+name)
    phases = config.get('phases',list(PHASES))
    if not phases or any(p not in PHASES for p in phases):
        raise ValueError('invalid phases')
    if 'forecast' in phases and (phases.index('forecast')==0 or phases[phases.index('forecast')-1]=='forecast'):
        raise ValueError('forecast requires a preceding ordinary-game phase')
    training_mode(config)
    if config.get('continuous') and config.get('evaluationEveryGames') != config['rounds']*sum(p!='forecast' for p in phases)*config['trainingGames']:
        raise ValueError('one seed block must cover exactly one evaluation interval')
    for name in ('seed','evaluationSeed'):
        if type(config.get(name)) is not int or not 0 <= config[name] <= 0xffffffff:
            raise ValueError('invalid '+name)
    n = config['rounds']*len(phases); stride = 100000
    span=config['trainingGames']
    a = (config['seed'], config['seed']+(n-1)*stride+span-1)
    b = (config['evaluationSeed'], config['evaluationSeed']+(n-1)*stride+2*config['evaluationPairs']-1)
    if max(a[1],b[1]) > 0xffffffff or max(a[0],b[0]) <= min(a[1],b[1]):
        raise ValueError('overlapping or wrapping seed reservations')
    if config['evaluationPairs']*2 > stride:
        raise ValueError('evaluation exceeds stage seed stride')
    for field in ('trainingScores','evaluationScores'):
        points = config.get(field,[[0,0]])
        if not points or any(len(p)!=2 or any(type(v) is not int or not 0<=v<121 for v in p) for p in points):
            raise ValueError('invalid '+field)
        if points != [[0,0]]:
            raise ValueError('Model 29 uses ordinary 0–0 games only')
    mass = config.get('priorEffectiveSamples',1000)
    if not isinstance(mass,(int,float)) or not math.isfinite(mass) or mass <= 0:
        raise ValueError('invalid prior mass')
    margin = config.get('noninferiorityMargin',.01)
    if not 0 <= margin < .5:
        raise ValueError('invalid noninferiority margin')


def checkpoint(db, config, **activity):
    out=Path(config['output'])
    full=db.execute("select count(*) from results where id like 'train:%' or id like 'eval:%'").fetchone()[0]
    atomic(out/'cache-clock.json',dict(completedGames=config.get('cacheClockBase',0)+full))
    progress=json.loads((out/'progress.json').read_text()) if (out/'progress.json').exists() else {}
    progress.update(activity,updatedAt=time.time(),workers=config['workers'],completedGames=full,cacheClockGames=config.get('cacheClockBase',0)+full,
        trainingMode=activity.get('trainingMode',progress.get('trainingMode',training_mode(config))),forecastRollouts=cache_stats(db).get('forecastRollouts',0),
        trainingGames=db.execute("select count(*) from results where id like 'train:%'").fetchone()[0],
        forecastWorlds=db.execute("select count(*) from results where id like 'forecast:%'").fetchone()[0],
        evaluationGames=db.execute("select count(*) from results where id like 'eval:%'").fetchone()[0])
    atomic(out/'progress.json',progress)


def cache_stats(db):
    """Aggregate each committed result once, in the evidence transaction."""
    db.execute('create table if not exists metrics(name text primary key,value text)')
    row=db.execute("select value from metrics where name='cache'").fetchone()
    stats=json.loads(row[0]) if row else dict(hits=0,misses=0,expired=0,writes=0,maxAgeGames=0,lastRowid=0)
    for rowid,raw in db.execute('select rowid,result from results where rowid>? order by rowid',(stats['lastRowid'],)):
        prior=json.loads(raw).get('cache',{})
        for k in ('hits','misses','expired','writes'):stats[k]+=prior.get(k,0)
        stats['maxAgeGames']=max(stats['maxAgeGames'],prior.get('maxAgeGames',0))
        stats['forecastRollouts']=stats.get('forecastRollouts',0)+len(json.loads(raw).get('outcomes',[]))
        stats['lastRowid']=rowid
    db.execute("insert or replace into metrics values('cache',?)",(json.dumps(stats),))
    return stats


def unconsumed_records(db, root, phase):
    """Filter on the sealed ledger before decoding historical game payloads."""
    path=Path(root)/ASSETS/'model29-state.json'
    state=json.loads(path.read_text()) if path.exists() else {}
    db.execute('create temp table if not exists consumed(id text primary key)')
    db.execute('delete from consumed')
    db.executemany('insert into consumed values(?)',((identity,) for identity in state.get(phase,{}).get('applied',[])))
    pattern="(id like 'train:%' or id like 'forecast:%')" if phase=='forecast' else "id like 'train:%'"
    return [(identity,json.loads(raw)) for identity,raw in db.execute(
        'select id,result from results where '+pattern+' and not exists (select 1 from consumed where consumed.id=results.id) order by id')]


def collect(db, config, root, requests, output, reference=None):
    """One writer and exact request identities; out-of-order completion is resumable."""
    if not requests:
        return []
    pending = [(identity,req) for identity,req in requests
               if not db.execute('select 1 from results where id=?',(identity,)).fetchone()]
    started=time.monotonic(); completed=len(requests)-len(pending)
    stats=cache_stats(db);db.commit()
    atomic(Path(config['output'])/'cache-progress.json',stats)
    checkpoint(db,config,phase='evaluation' if reference else 'forecast' if requests[0][1]['kind'] in ('counterfactual','rejected-discards') else 'collection',
        phaseCompleted=completed,phaseTarget=len(requests),phaseStartedAt=time.time(),activeRoot=str(root))
    groups = [pending[i::config['workers']] for i in range(config['workers'])]
    # Each task is one game so each completion commits promptly. Reuse a worker
    # per thread; loss of a process cannot manufacture completed game indices.
    def one(group):
        if not group:
            return
        worker = Worker(config['binary'],root,reference)
        try:
            for identity,req in group:
                if shutil.disk_usage(config['output']).free < config.get('minimumFreeBytes',10*1024**3):
                    raise RuntimeError('less than reserved free storage; completed evidence is checkpointed')
                yield identity,req,worker.call(req)
        finally:
            worker.close()
    import queue
    arrivals = queue.Queue()
    def submit(group):
        try:
            for row in one(group):
                arrivals.put(('result',row))
        except BaseException as error:
            arrivals.put(('error',error))
        finally:
            arrivals.put(('done',None))
    failure = None
    with concurrent.futures.ThreadPoolExecutor(max_workers=config['workers']) as pool:
        futures = [pool.submit(submit,g) for g in groups]
        complete = 0
        while complete < len(groups):
            kind,value = arrivals.get()
            if kind == 'done':
                complete += 1
            elif kind == 'error':
                failure = value
            else:
                identity,req,game = value
                db.execute('insert into results values(?,?,?,?)',
                           (identity,json.dumps(req),str(root),json.dumps(game)))
                stats=cache_stats(db)
                db.commit()
                completed+=1
                checkpoint(db,config,lastCompleted=identity,phaseCompleted=completed,
                    phaseSeconds=time.monotonic()-started,lastGameSeconds=game['seconds'])
                stats_path=Path(config['output'])/'cache-progress.json'
                stats['updatedAt']=time.time();atomic(stats_path,stats)
        for f in futures:
            f.result()
    if failure:
        raise failure
    result = []
    for identity,req in requests:
        row = db.execute('select request,root,result from results where id=?',(identity,)).fetchone()
        if json.loads(row[0]) != req or row[1] != str(root):
            raise ValueError('resumed request or root changed')
        result.append((identity,json.loads(row[2])))
    return result


def batch_training_mode(db, config, index):
    # Operational speed control is read only at a new batch boundary. The
    # persisted choice, rather than today's control file, governs every resume.
    db.execute('create table if not exists controls(id text primary key,value text)')
    identity='batchMode:'+str(index)
    row=db.execute('select value from controls where id=?',(identity,)).fetchone()
    if row:return json.loads(row[0])['trainingMode']
    control=Path(config['trainingControl']) if config.get('trainingControl') else None
    mode=training_mode(json.loads(control.read_text())) if control else training_mode(config)
    db.execute('insert into controls values(?,?)',(identity,json.dumps(dict(trainingMode=mode))))
    db.commit()
    return mode


def collect_training_batch(db, config, root, requests, directory):
    mode=batch_training_mode(db,config,requests[0][0].split(':')[1])
    checkpoint(db,config,trainingMode=mode)
    games = collect(db, config, root, requests, directory)
    if 'forecast' in config.get('phases', PHASES):
        # Reuse the SAME immutable policy and actual deal as the ordinary game.
        # Rejected keeps are evidence only for the forecast, never other priors.
        collect(db, config, root, rejected_requests(games, dict(config,trainingMode=mode)), directory)
    return games


def compact_report(report):
    result={k:v for k,v in report.items() if k!='update'}
    result['update']={k:v for k,v in report['update'].items() if k not in ('identities',)}
    return result


def maybe_assess(db,config,current,baseline,index,phases):
    """A frozen 500-seed paired panel after exactly 5,000 new training games."""
    phase=index%len(phases)
    if phases[phase]=='forecast':return
    trained=(index//len(phases)*sum(p!='forecast' for p in phases)+sum(p!='forecast' for p in phases[:phase+1]))*config['trainingGames']
    interval=config.get('evaluationEveryGames',5000)
    if trained%interval:return
    out=Path(config['output']);directory=out/'assessments';directory.mkdir(exist_ok=True)
    path=directory/f'{trained:09d}.json'
    if path.exists():
        if json.loads(path.read_text())['root']!=str(current):raise ValueError('checkpoint root changed')
        return
    requests=[(f'eval:checkpoint:{trained}:{i}:{side}',dict(kind='game',seed=config['evaluationSeed']+i,
        firstDealer=i%2,candidateSide=side,scores=[0,0],cache=True)) for i in range(config['evaluationPairs']) for side in (0,1)]
    checkpoint(db,config,asset='original-state comparison',checkpointTrainingGames=trained,
        generation=verify(current)['generation'])
    started=time.monotonic();games=collect(db,config,current,requests,directory,baseline)
    epoch=trained//interval
    assessment_result=assessment([g for _,g in games],config.get('noninferiorityMargin',.01),epoch*(epoch+1))
    result=dict(status='complete',trainingGames=trained,root=str(current),baseline=str(baseline),
        games=len(games),assessment=assessment_result,seconds=time.monotonic()-started,
        policy='candidate rolling cache; original-state opponent has its own frozen-prior cache; evaluations never learn')
    atomic(path,result)
    history=[json.loads(p.read_text()) for p in sorted(directory.glob('*.json'))]
    atomic(out/'evaluation-history.json',dict(checkpoints=history[-60:],completed=len(history)))


def run(config):
    validate(config)
    out = Path(config['output']); out.mkdir(parents=True,exist_ok=True)
    verify_source(config)
    initial = verify(config['initialRoot'])
    if initial['policy']['binarySha256'] != sha(config['binary']):
        raise ValueError('native binary differs from audited policy')
    # Freeze all executable Python policy-update inputs as well as the native binary.
    identity = dict(config=config,binary=sha(config['binary']),
                    source={p.name:sha(p) for p in sorted(Path(__file__).parent.glob('*.py'))},
                    initial=sha(Path(config['initialRoot'])/ASSETS/'model29-generation.json'))
    path = out/'identity.json'
    if path.exists() and json.loads(path.read_text()) != identity:
        raise ValueError('resume differs from frozen run identity')
    atomic(path,identity)
    db = sqlite3.connect(out/'evidence.db')
    db.execute('pragma journal_mode=WAL')
    db.execute('create table if not exists results(id text primary key,request text,root text,result text)')
    current = Path(config['initialRoot']); baseline = Path(config.get('referenceRoot',current))
    verify(baseline)
    reports = []; phases = config.get('phases',list(PHASES)); planned = phases*config['rounds']
    source_seeds=dict(training=[config['seed']],evaluation=[config['evaluationSeed']])
    checkpoint(db,config,phase='preparing')
    try:
        indices=itertools.count() if config.get('continuous') else range(len(planned))
        for index in indices:
            phase=phases[index%len(phases)]
            block=index//len(planned)
            if block:
                from seeds import reserve
                seed_dir=out/'seed-blocks'/str(block)
                path=seed_dir/'seed-reservation.json'
                if not path.exists():
                    excluded=out.parent/'seed-exclusions.json'
                    if sha(excluded)!=config['seedExclusionsSha256']:raise ValueError('seed exclusions changed')
                    seed_dir.mkdir(parents=True,exist_ok=True)
                    reserve(config['repo'],seed_dir,len(planned),json.loads(excluded.read_text()))
                source_seeds=json.loads(path.read_text())['ranges']
            active_config=dict(config,seed=source_seeds['training'][0],evaluationSeed=source_seeds['evaluation'][0])
            directory = out/f'{index:04d}-{phase}'; directory.mkdir(exist_ok=True)
            receipt = directory/'complete.json'
            if receipt.exists():
                report = json.loads(receipt.read_text()); current = Path(report['nextRoot'])
                verify(current); reports.append(compact_report(report))
                maybe_assess(db,active_config,current,baseline,index,phases)
                continue
            started = time.monotonic(); seed = active_config['seed']+(index%len(planned))*100000
            free=shutil.disk_usage(out).free
            if free < 10*1024**3:
                checkpoint(db,config,phase='storage limit',freeBytes=free)
                raise RuntimeError('less than 10 GiB free; evidence is checkpointed; free storage before resuming')
            checkpoint(db,config,asset=phase,stageIndex=index,cycle=index//len(phases)+1,generation=verify(current)['generation'])
            if phase != 'forecast':
                requests = [(f'train:{index}:{i}',dict(kind='game',seed=seed+i,firstDealer=i%2,scores=[0,0]))
                            for i in range(config['trainingGames'])]
                collect_training_batch(db,config,current,requests,directory)
            candidate = directory/'candidate'; update_path = directory/'update.json'
            if update_path.exists():
                details = json.loads(update_path.read_text()); verify(candidate)
                if details['snapshot'] != sha(candidate/ASSETS/'model29-generation.json'):
                    raise ValueError('candidate differs from update receipt')
            else:
                if candidate.exists():
                    candidate.rename(directory/f'interrupted-candidate-{time.time_ns()}')
                checkpoint(db,config,phase='updating',asset=phase)
                verify_source(config)
                records=unconsumed_records(db,current,phase)
                details = update(current,candidate,phase,records,config.get('priorEffectiveSamples',1000),config['repo'])
                atomic(update_path,details)
            # Per-phase checks validate data and assets. The user-requested
            # strength panel runs once per 5,000 training games, separately.
            evaluations = {}; full_games = False; promoted = False; advanced = True
            current = candidate
            report = dict(status='complete',phase=phase,update=details,evaluations=evaluations,
                          fullGameStrengthMeasured=full_games,promoted=promoted,advanced=advanced,nextRoot=str(current),
                          seconds=time.monotonic()-started)
            atomic(receipt,report); reports.append(compact_report(report))
            atomic(out/'history.json',dict(stages=[compact_report(r) for r in reports[-60:]],completedUpdates=len(reports),experimentalRoot=str(current)))
            maybe_assess(db,active_config,current,baseline,index,phases)
        result = dict(status='complete',model=initial['model'],stages=reports,acceptedRoot=str(current),
                      evidenceGames=db.execute("select count(*) from results where id like 'train:%'").fetchone()[0],
                      promoted=(out/'promoted.json').exists())
        atomic(out/'result.json',result)
        checkpoint(db,config,phase='complete')
        return result
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('config',type=Path)
    args = parser.parse_args(); result = run(json.loads(args.config.read_text()))
    print(json.dumps({k:result[k] for k in ('status','model','evidenceGames','promoted')}))
