#!/usr/bin/env python3
"""Objective completion receipts for the one-shot pilot supervisor."""
import argparse
import json
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import time
from pathlib import Path
from cycle import Worker
from forecast import rejected_requests, training_mode
from learning import ASSETS, atomic, bootstrap, sha, verify, verify_source


def cache_configuration(config):
    out=Path(config['output']); out.mkdir(exist_ok=True)
    if not (out/'cache-clock.json').exists(): atomic(out/'cache-clock.json',dict(completedGames=0))
    atomic(config['cacheConfig'],dict(root=str(out/'opening'),baseline=str(Path(config['cacheBank'])/'chunks'),
        baselineTail=str(Path(config['cacheTail'])/'chunks'),referenceRoot=str(out/'baseline-opening'),
        baselineGeneration=sha(Path(config['initialRoot'])/ASSETS/'model29-generation.json'),
        clock=str(out/'cache-clock.json'),maxAgeGames=config['maxAgeGames'],code=sha(config['binary']),
        baselinePolicy='7c4c58c9100ef3f5388b0d5e3838b6542fb810e230451035d5dee2f5b6cfd2a8'))


def cache_parity(config):
    """Independent full solver, captured chunks, replay and age-expiry checks."""
    runtime=Path(config['output']).parent; directory=runtime/'cache-validation';directory.mkdir(exist_ok=True)
    base=json.loads(Path(config['cacheConfig']).read_text())
    validation=dict(base,root=str(directory/'chunks'),referenceRoot=str(directory/'chunks'),baseline=str(directory/'empty'),baselineTail=str(directory/'empty'),clock=str(directory/'clock.json'))
    atomic(directory/'clock.json',dict(completedGames=0));atomic(directory/'config.json',validation)
    old=os.environ.get('MODEL29_CACHE_CONFIG');os.environ['MODEL29_CACHE_CONFIG']=str(directory/'config.json')
    worker=Worker(config['binary'],config['initialRoot'])
    try:
        request=dict(kind='game',seed=config['paritySeed'],firstDealer=0,scores=[0,0])
        exact=worker.call(dict(request,cache=False));captured=worker.call(request);replayed=worker.call(request)
        semantic=lambda g:{k:v for k,v in g.items() if k not in ('seconds','cache')}
        if semantic(exact)!=semantic(captured) or semantic(exact)!=semantic(replayed):raise ValueError('captured opening changes a whole game')
        if not captured['cache']['writes'] or not replayed['cache']['hits']:raise ValueError('capture/replay path not exercised')
        sample=next((directory/'chunks').glob('cut*/pone*/dealer*-lead*.bin'))
        match=re.fullmatch(r'cut(\d+)/pone(\d+)/dealer(\d+)-lead(\d+)\.bin',str(sample.relative_to(directory/'chunks')))
        if not match:raise ValueError('unexpected chunk path')
        receipt=json.loads(subprocess.check_output([str(Path(config['binary']).with_name('build-model283-opening')),
            str(Path(config['initialRoot'])/ASSETS),str(directory/'independent'),*match.groups()],text=True))
        def body(path):
            raw=Path(path).read_bytes();n=struct.unpack_from('<I',raw)[0];return json.loads(raw[4:4+n]),raw[4+n:]
        header,payload=body(sample);independent,other=body(receipt['path'])
        if payload!=other or header['rows']!=independent['rows']:raise ValueError('capture differs from independent public-domain builder')
        # Exercise the actual TTL through a second full-game replay. This is a
        # one-time implementation test, never an early-refresh training policy.
        atomic(directory/'clock.json',dict(completedGames=config['maxAgeGames']))
        expired=worker.call(request)
        if semantic(expired)!=semantic(exact) or not expired['cache']['expired'] or not expired['cache']['writes']:
            raise ValueError('expired chunks were reused or changed fresh policy')
        atomic(directory/'results.json',dict(exact=exact,captured=captured,replayed=replayed,expired=expired))
    finally:
        worker.close()
        if old is None:os.environ.pop('MODEL29_CACHE_CONFIG',None)
        else:os.environ['MODEL29_CACHE_CONFIG']=old
    # Reuse the staged historical bank with the current executable at generation zero.
    worker=Worker(config['binary'],config['initialRoot'])
    try:
        inherited=worker.call(request)
        world=dict(kind='counterfactual',seed=config['paritySeed']+1,own=[0,4,8,12,16,20],scores=[110,112],dealer=0)
        modern=worker.call(world);reference=worker.call(dict(world,cache=False))
        if modern['outcomes']!=reference['outcomes'] or len(modern['outcomes'])!=15:
            raise ValueError('counterfactual hand outcomes differ with opening capture/reuse')
        atomic(directory/'counterfactual.json',modern)
    finally:worker.close()
    if semantic(inherited)!=semantic(exact) or not inherited['cache']['hits']:raise ValueError('inherited bank parity failed')
    atomic(runtime/'cache-parity.json',dict(status='complete',wholeGameComparisons=4,independentChunkParity=True,counterfactualKeeps=15,
        captured=captured['cache'],replayed=replayed['cache'],expired=expired['cache'],inherited=inherited['cache']))


def archive_inputs(config):
    files=['config.json','source-manifest.json','seed-reservation.json','seed-exclusions.json',
           'job.json','bootstrap.json','cache-config.json','report.json']
    directories=['output','initial','frozen']
    if config.get('model') in ('29.1','29.2'):
        files+=['verify.json','opening-compatibility.json','handoff-source.json','handoff.json','verification-games.json']
        directories+=['reference']
    else:
        files+=['parity.json','cache-parity.json','cache-stage.json']
    return files,directories


def run(stage, config):
    root = Path(config['repo']); out = Path(config['output']); runtime = out.parent
    verify_source(config)
    if stage == 'bootstrap':
        policy = dict(peggingPolicy='28.3-f64',sourceRevision=config['sourceRevision'],
                      sourceSha256=sha(runtime/'source-manifest.json'),
                      binarySha256=sha(config['binary']),
                      audit='29.0 normalizes only identity to 28.3; legal observations, solver, ties and FP64 retained')
        initial = Path(config['initialRoot'])
        if initial.exists():
            try:
                existing = verify(initial)
                if existing['policy'] != policy:
                    raise ValueError('initial policy changed')
                cache_configuration(config)
                atomic(runtime/'bootstrap.json',dict(status='complete',policy=policy)); return
            except (OSError,ValueError,KeyError):
                initial.rename(runtime/f'interrupted-bootstrap-{time.time_ns()}')
        bootstrap(root,initial,policy)
        cache_configuration(config)
        atomic(runtime/'bootstrap.json',dict(status='complete',policy=policy))
    elif stage == 'cache-parity':
        cache_parity(config)
    elif stage == 'await-cache':
        receipts=[]
        for name in ('cacheBank','cacheTail'):
            bank=Path(config[name])
            while True:
                status=json.loads((bank/'supervisor/status.json').read_text())
                if status['state']=='complete':break
                if status['state'] in ('failed','stopped','interrupted'):raise ValueError('opening bank staging needs attention')
                time.sleep(10)
            receipts.append(json.loads((bank/'receipt.json').read_text()))
        atomic(runtime/'cache-stage.json',dict(status='complete',chunks=sum(r['chunks'] for r in receipts),parts=receipts))
        atomic(runtime/'await-cache.json',dict(status='complete'))
    elif stage == 'parity':
        worker = Worker(config['binary'],config['initialRoot'])
        count = 0
        try:
            for role in ('dealer','pone'):
                for scores in ((119,120),(75,80)):
                    inputs = []
                    history = ('aiHand=4,9;aiTable=0,3;humanTable=2,5;humanHandCount=2;plays=0,2,3,5;count=14;pegHistory=s0,o2,s3,o5' if role == 'pone' else 'aiHand=4,9,17;aiTable=2;humanTable=0,3;humanHandCount=2;plays=0,2,3;count=8;pegHistory=o0,s2,o3')
                    for model in ('28.3','29.0'):
                        text = (f'kind=peg;model=schell_table-peg_table-{model};turnCard=10;role={role};'
                                f'ownDiscards=1,6;{history};'
                                f'aiScore={scores[0]};humanScore={scores[1]};'
                                'last=human')
                        inputs.append(worker.call(dict(kind='decision',inputText=text)))
                    if inputs[0] != inputs[1]:
                        raise ValueError('generation zero differs from 28.3')
                    count += 1
            for role in ('dealer','pone'):
                choices = [worker.call(dict(kind='decision',inputText=
                           f'kind=discard;model=schell_table-peg_table-{model};role={role};'
                           'aiHand=0,4,8,12,16,20;aiScore=110;humanScore=112;turnCard=2'))
                           for model in ('28.3','29.0')]
                if choices[0] != choices[1]:
                    raise ValueError('generation zero discard differs from 28.3')
                count += 1
        finally:
            worker.close()
        atomic(runtime/'parity.json',dict(status='complete',identicalDecisionFixtures=count,arithmetic='f64'))
    elif stage == 'report':
        result = json.loads((out/'result.json').read_text())
        if result['status'] != 'complete':
            raise ValueError('incomplete cycle')
        expected_training = config['rounds']*len([p for p in config['phases'] if p!='forecast'])*config['trainingGames']
        with sqlite3.connect(out/'evidence.db') as db:
            rows = db.execute('select id,root,result from results order by id').fetchall()
            modes={k:json.loads(v)['trainingMode'] for k,v in db.execute('select id,value from controls')}
        training = [json.loads(r[2]) for r in rows if r[0].startswith('train:')]
        if len(training) != expected_training:
            raise ValueError('incomplete training games')
        for i in range(config['rounds']*len(config['phases'])):
            if config['phases'][i%len(config['phases'])]=='forecast':
                continue
            expected = {f'train:{i}:{j}' for j in range(config['trainingGames'])}
            actual = {r[0] for r in rows if r[0].startswith(f'train:{i}:')}
            if actual != expected:
                raise ValueError('missing or overlapping game indices')
        records = [(r[0],json.loads(r[2])) for r in rows if r[0].startswith('train:')]
        expected = {identity for source,game in records for identity,_ in rejected_requests([(source,game)],dict(config,trainingMode=modes['batchMode:'+source.split(':')[1]]))} if 'forecast' in config['phases'] else set()
        actual = {r[0] for r in rows if r[0].startswith('forecast:')}
        if actual != expected:
            raise ValueError('missing or unexpected rejected-discard cohorts')
        for path in out.glob('*/candidate'):
            verify(path)
        full = [g for g in training if not g['trajectory'] and max(g['scores'])>=121 and min(g['scores'])<121 and g['start']==[0,0]]
        if len(full)!=len(training):raise ValueError('nonstandard training game')
        seconds = sum(g['seconds'] for g in full)
        report = dict(status='complete',model=config['model'],trainingGames=len(training),
                      normalGames=len(full),evaluationGames=sum(r[0].startswith('eval:') for r in rows),
                      forecastWorlds=sum(r[0].startswith('forecast:') for r in rows),
                      trainingMode=training_mode(config),
                      forecastRollouts=sum(len(json.loads(r[2])['outcomes']) for r in rows if r[0].startswith('forecast:')),
                      workerGamesPerHour=3600*len(full)/seconds if seconds else None,
                      stages=[dict(phase=s['phase'],changed=s['update']['changed'],
                                   evaluations=s['evaluations'],promoted=s['promoted']) for s in result['stages']],
                      parity=json.loads((runtime/('verify.json' if config.get('model')=='29.1' else 'parity.json')).read_text()),
                      promoted=result['promoted'],interpretation='Engineering pilot; insufficient evidence of playing-strength improvement')
        atomic(runtime/'report.json',report)
        print(json.dumps({k:report[k] for k in ('status','model','trainingGames','forecastWorlds','promoted')}))
    elif stage == 'sync':
        archive = Path(config['archive']); archive.mkdir(parents=True,exist_ok=True)
        # Completed snapshots and evidence are archived, not large compiler caches.
        files,directories=archive_inputs(config)
        for name in files:shutil.copy2(runtime/name,archive/name)
        for name in directories:shutil.copytree(runtime/name,archive/name,dirs_exist_ok=True)
        (archive/'bin').mkdir(exist_ok=True)
        shutil.copy2(config['binary'],archive/'bin/model29-worker')
        atomic(runtime/'sync.json',dict(status='copied'))
    elif stage == 'verify-sync':
        archive = Path(config['archive'])
        checked = 0
        files,directories=archive_inputs(config)
        for name in files:
            if sha(runtime/name)!=sha(archive/name):raise ValueError('archive differs: '+name)
            checked+=1
        for directory in directories:
            for source in (runtime/directory).rglob('*'):
                if source.is_file():
                    dest = archive/source.relative_to(runtime)
                    if not dest.is_file() or sha(source) != sha(dest):
                        raise ValueError('archive differs: '+str(dest))
                    checked += 1
        if sha(config['binary']) != sha(archive/'bin/model29-worker'):
            raise ValueError('archived binary differs')
        atomic(runtime/'sync-verification.json',dict(status='complete',files=checked))
        atomic(archive/'sync-verification.json',dict(status='complete',files=checked))
    else:
        raise ValueError('unknown stage')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('stage'); parser.add_argument('config',type=Path)
    args = parser.parse_args(); run(args.stage,json.loads(args.config.read_text()))
