#!/usr/bin/env python3
"""Resumable, bounded learning cycles. Launch through cribbage_job_queue.py."""
import argparse
import concurrent.futures
import json
import math
import sqlite3
import subprocess
import time
from pathlib import Path
from learning import ASSETS, PHASES, atomic, canonical, manifest, sha, update, verify


class Worker:
    def __init__(self, binary, root, reference=None):
        args = [binary, str(root)] + ([str(reference)] if reference else [])
        self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def call(self, request):
        self.process.stdin.write(json.dumps(request)+'\n'); self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('native worker exited before completing request')
        response = json.loads(line)
        if not response.get('ok'):
            raise RuntimeError(response.get('error','native worker failed'))
        return response['result']

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
    for name in ('seed','evaluationSeed'):
        if type(config.get(name)) is not int or not 0 <= config[name] <= 0xffffffff:
            raise ValueError('invalid '+name)
    n = config['rounds']*len(phases); stride = 100000
    a = (config['seed'], config['seed']+(n-1)*stride+config['trainingGames']-1)
    b = (config['evaluationSeed'], config['evaluationSeed']+(n-1)*stride+2*config['evaluationPairs']-1)
    if max(a[1],b[1]) > 0xffffffff or max(a[0],b[0]) <= min(a[1],b[1]):
        raise ValueError('overlapping or wrapping seed reservations')
    if config['evaluationPairs']*2 > stride:
        raise ValueError('evaluation exceeds stage seed stride')
    for field in ('trainingScores','evaluationScores'):
        points = config.get(field,[[0,0]])
        if not points or any(len(p)!=2 or any(type(v) is not int or not 0<=v<121 for v in p) for p in points):
            raise ValueError('invalid '+field)
    mass = config.get('priorEffectiveSamples',1000)
    if not isinstance(mass,(int,float)) or not math.isfinite(mass) or mass <= 0:
        raise ValueError('invalid prior mass')
    margin = config.get('noninferiorityMargin',.01)
    if not 0 <= margin < .5:
        raise ValueError('invalid noninferiority margin')


def collect(db, config, root, requests, output, reference=None):
    """One writer and exact request identities; out-of-order completion is resumable."""
    pending = [(identity,req) for identity,req in requests
               if not db.execute('select 1 from results where id=?',(identity,)).fetchone()]
    groups = [pending[i::config['workers']] for i in range(config['workers'])]
    # Each task is one game so each completion commits promptly. Reuse a worker
    # per thread; loss of a process cannot manufacture completed game indices.
    def one(group):
        if not group:
            return
        worker = Worker(config['binary'],root,reference)
        try:
            for identity,req in group:
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
                db.commit()
                atomic(output/'progress.json',dict(phase='evaluation' if reference else 'collection',
                       lastCompleted=identity,seconds=game['seconds'],updatedAt=time.time()))
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


def run(config):
    validate(config)
    out = Path(config['output']); out.mkdir(parents=True,exist_ok=True)
    verify(config['initialRoot'])
    # Freeze all executable Python policy-update inputs as well as the native binary.
    identity = dict(config=config,binary=sha(config['binary']),
                    source={p.name:sha(p) for p in sorted(Path(__file__).parent.glob('*.py'))},
                    initial=sha(Path(config['initialRoot'])/ASSETS/'model29-generation.json'))
    path = out/'identity.json'
    if path.exists() and json.loads(path.read_text()) != identity:
        raise ValueError('resume differs from frozen run identity')
    atomic(path,identity)
    db = sqlite3.connect(out/'evidence.db')
    db.execute('create table if not exists results(id text primary key,request text,root text,result text)')
    current = Path(config['initialRoot']); baseline = current
    reports = []; phases = config.get('phases',list(PHASES)); planned = phases*config['rounds']
    try:
        for index,phase in enumerate(planned):
            directory = out/f'{index:04d}-{phase}'; directory.mkdir(exist_ok=True)
            receipt = directory/'complete.json'
            if receipt.exists():
                report = json.loads(receipt.read_text()); current = Path(report['nextRoot'])
                verify(current); reports.append(report); continue
            started = time.monotonic(); seed = config['seed']+index*100000
            points = config.get('trainingScores',[[90,90],[110,115]])
            requests = [(f'train:{index}:{i}',dict(kind='trajectory' if i == 0 else 'game',
                         seed=seed+i,firstDealer=i%2,scores=[0,0] if i == 0 else points[(i-1)%len(points)]))
                        for i in range(config['trainingGames'])]
            collect(db,config,current,requests,directory)
            records = [(r[0],json.loads(r[1])) for r in db.execute("select id,result from results where id like 'train:%' order by id")]
            candidate = directory/'candidate'; update_path = directory/'update.json'
            if update_path.exists():
                details = json.loads(update_path.read_text()); verify(candidate)
                if details['snapshot'] != sha(candidate/ASSETS/'model29-generation.json'):
                    raise ValueError('candidate differs from update receipt')
            else:
                if candidate.exists():
                    candidate.rename(directory/f'interrupted-candidate-{time.time_ns()}')
                atomic(directory/'progress.json',dict(phase='updating',asset=phase,updatedAt=time.time()))
                details = update(current,candidate,phase,records,config.get('priorEffectiveSamples',1000),config['repo'])
                atomic(update_path,details)
            evaluations = {}
            # Test both the previous accepted generation and the frozen 28.3 baseline.
            references = [('previous',current)]
            if current != baseline:
                references.append(('baseline',baseline))
            scores = config.get('evaluationScores',[[0,0]])
            for panel,(name,reference) in enumerate(references):
                eval_requests = [(f'eval:{index}:{name}:{i}:{side}',dict(kind='game',
                                  seed=config['evaluationSeed']+index*100000+panel*config['evaluationPairs']+i,
                                  firstDealer=i%2,candidateSide=side,
                                  scores=scores[i%len(scores)] if side==0 else scores[i%len(scores)][::-1]))
                                 for i in range(config['evaluationPairs']) for side in range(2)]
                games = collect(db,config,candidate,eval_requests,directory,reference)
                evaluations[name] = assessment([g for _,g in games],config.get('noninferiorityMargin',.01),2*len(planned))
            full_games = scores == [[0,0]]
            promoted = full_games and all(v['status']=='passed' for v in evaluations.values())
            if promoted:
                current = candidate
                atomic(out/'promoted.json',dict(root=str(current),snapshot=details['snapshot'],evaluations=evaluations))
            report = dict(status='complete',phase=phase,update=details,evaluations=evaluations,
                          fullGameStrengthMeasured=full_games,promoted=promoted,nextRoot=str(current),
                          seconds=time.monotonic()-started)
            atomic(receipt,report); reports.append(report)
        result = dict(status='complete',model='29.0',stages=reports,acceptedRoot=str(current),
                      evidenceGames=db.execute("select count(*) from results where id like 'train:%'").fetchone()[0],
                      promoted=(out/'promoted.json').exists())
        atomic(out/'result.json',result)
        return result
    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('config',type=Path)
    args = parser.parse_args(); result = run(json.loads(args.config.read_text()))
    print(json.dumps({k:result[k] for k in ('status','model','evidenceGames','promoted')}))
