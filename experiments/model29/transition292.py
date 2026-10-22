#!/usr/bin/env python3
"""Frozen, verified handover from stopped 29.1 to continuous 29.2."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
from learning import ASSETS, PHASES, atomic, inherit, sha, verify, verify_source, seal, FORECAST
from cycle import Worker
from seeds import reserve, recorded
from transition291 import copy_file
import resources
import forecast292

PARENT=Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes')
OLD=PARENT/'model291-continuous-20261021-v1'


def stopped_parent():
    status=json.loads((OLD/'supervisor/status.json').read_text())
    if status['state']!='stopped':raise ValueError('29.1 must be explicitly stopped before handover')
    lease=resources.RESERVATION.parent/('model29-lease-'+hashlib.sha256(OLD.name.encode()).hexdigest()+'.lock')
    with lease.open('a+') as lock:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    return Path(json.loads((OLD/'output/history.json').read_text())['experimentalRoot'])


def prepare(runtime,archive):
    source=Path(__file__).resolve().parents[2];runtime=runtime.resolve()
    if runtime.parent!=PARENT or runtime.exists():raise ValueError('fresh persistent internal runtime required')
    if subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True):raise ValueError('commit source first')
    previous=json.loads((OLD/'config.json').read_text());snapshot=stopped_parent();verify(snapshot)
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    runtime.mkdir();frozen=runtime/'frozen';frozen.mkdir()
    names=subprocess.check_output(['git','ls-files','-z'],cwd=source).decode().split('\0')
    for name in filter(None,names):
        if name.startswith(('rust/','scripts/','training/','experiments/model29/','docs/adr/')) or name=='AGENTS.md':copy_file(source/name,frozen/name)
    copy_file(snapshot/ASSETS/'model1323-corrections.bin',frozen/ASSETS/'model1323-corrections.bin')
    atomic(runtime/'source-manifest.json',dict(revision=revision,files={str(p.relative_to(frozen)):sha(p) for p in sorted(frozen.rglob('*')) if p.is_file()}))
    exclusions,_=recorded(source);atomic(runtime/'seed-exclusions.json',exclusions)
    seeds=reserve(source,runtime,50*len(PHASES),exclusions)
    with sqlite3.connect('file:'+str(OLD/'output/evidence.db')+'?mode=ro',uri=True) as db:
        counts={k:db.execute('select count(*) from results where id like ?',(v,)).fetchone()[0] for k,v in [('training','train:%'),('evaluation','eval:%'),('forecast','forecast:%')]}
    config=dict(model='29.2',sourceRevision=revision,repo=str(frozen),sourceManifestSha256=sha(runtime/'source-manifest.json'),
        binary=str(runtime/'bin/model29-worker'),initialRoot=str(runtime/'initial'),referenceRoot=str(runtime/'reference'),
        sourceSnapshot=str(snapshot),originalSnapshot=previous['originalSnapshot'],oldRuntime=str(OLD),oldSpec=str(OLD/'job.json'),
        oldBinary=previous['binary'],openingCodeSha256=previous['openingCodeSha256'],
        output=str(runtime/'output'),trainingControl=str(runtime/'output/training-control.json'),archive=str(archive.resolve()),cacheConfig=str(runtime/'cache-config.json'),
        cacheClockBase=previous['cacheClockBase']+counts['training']+counts['evaluation'],
        rounds=50,continuous=True,phases=list(PHASES),trainingGames=20,evaluationPairs=500,workers=2,evaluationEveryGames=5000,
        trainingMode=True,maxAgeGames=50000,seed=seeds['ranges']['training'][0],evaluationSeed=seeds['ranges']['evaluation'][0],paritySeed=seeds['ranges']['parity'][0],
        seedExclusionsSha256=sha(runtime/'seed-exclusions.json'),trainingScores=[[0,0]],evaluationScores=[[0,0]],priorEffectiveSamples=1000,
        noninferiorityMargin=.01,minimumFreeBytes=10*1024**3,buildMode='FP64 diagnostic release without PGO; two workers; joint point distributions')
    atomic(runtime/'config.json',config);atomic(runtime/'handoff-source.json',dict(root=str(snapshot),counts=counts))
    python=sys.executable;target=runtime/'target'
    env=dict(PATH=os.environ['PATH'],PYTHONDONTWRITEBYTECODE='1',CARGO_BUILD_JOBS='1',CARGO_TARGET_DIR=str(target),MODEL29_CACHE_CONFIG=config['cacheConfig'],CRIBBAGE_283_FAST_ASSET='')
    def check(path):return dict(type='json_field',path=str(path),field='status',equals='complete')
    def stage(name,command,checks,cpus=None):
        if cpus:command=[python,str(frozen/'experiments/model29/resources.py'),runtime.name,str(cpus)]+command
        return dict(name=name,cwd=str(frozen),env=env,command=command,completionChecks=checks)
    stages=[stage('build',[str(frozen/'scripts/run-quiet.sh'),'--show-warnings','Model 29.2 release build',shutil.which('cargo'),'build','--offline','--locked','--release','--manifest-path',str(frozen/'rust/Cargo.toml'),'-p','cribbage-shadow-engine','--features','model29-training','--bin','model29-worker'],[dict(type='file_exists',path=str(target/'release/model29-worker'))],1)]
    for name in ('bootstrap','verify','handoff'):
        stages.append(stage(name,[python,str(frozen/'experiments/model29/transition292.py'),name,str(runtime/'config.json')],[check(runtime/(name+'.json'))],1 if name=='verify' else None))
    stages.append(stage('cycles',[python,str(frozen/'experiments/model29/cycle.py'),str(runtime/'config.json')],[check(runtime/'output/result.json')],2))
    for name in ('report','sync','verify-sync'):
        path=runtime/(name+'.json' if name!='verify-sync' else 'sync-verification.json')
        checks=[dict(type='json_field',path=str(path),field='status',equals='copied' if name=='sync' else 'complete')]
        stages.append(stage(name,[python,str(frozen/'experiments/model29/stage.py'),name,str(runtime/'config.json')],checks))
    stages[-1]['completionChecks'].append(check(archive/'sync-verification.json'))
    atomic(runtime/'job.json',dict(schemaVersion=1,jobId=runtime.name,jobRoot=str(runtime/'supervisor'),stages=stages,
        trainingStudy=dict(root=config['output'],title='Model 29.2 · joint scoring forecast learning',mode='cyclic',target=5000,workers=2,rounds=None,continuous=True,trainingMode=True,maxAgeGames=50000),
        reportCommand=[python,str(frozen/'scripts/cribbage_job_queue.py'),'summary',str(runtime/'job.json')]))
    print(json.dumps(dict(status='prepared',job=str(runtime/'job.json'),workers=2,cacheClockBase=config['cacheClockBase'])))


def compatibility(config):
    source=Path(config['repo'])/'rust/cribbage-shadow-engine';old=OLD/'frozen/rust/cribbage-shadow-engine'
    exceptions={'bin/model29-worker.rs','examples/model283-hands.rs','lib.rs','model_id.rs','model.rs','model29_snapshot.rs','model283_opening_training.rs','model29_forecast.rs'}
    unchanged={}
    for path in old.rglob('*.rs'):
        name=str(path.relative_to(old))
        if name in exceptions:continue
        if sha(path)!=sha(source/name):raise ValueError('pegging-policy source changed: '+name)
        unchanged[name]=sha(path)
    # All model.rs changes must stay inside discard valuation or model-ID routing.
    def untouched(path):
        text=path.read_text()
        for name in ('model29_input','recommend_discard_model1323_with_assets'):
            text=re.sub(r'(?ms)^fn '+name+r'\(.*?^}',f'fn {name}() {{ /* audited change */ }}',text,count=1)
        return text
    if untouched(source/'model.rs')!=untouched(old/'model.rs'):raise ValueError('pegging calculation changed')
    parent=verify(config['sourceSnapshot'])
    if parent['policy']['binarySha256']!=sha(config['oldBinary']) or parent['policy']['openingCodeSha256']!=config['openingCodeSha256']:
        raise ValueError('parent executable identity changed')
    return dict(status='complete',unchanged=unchanged,inspectedExceptions={n:sha(source/n) for n in sorted(exceptions)},code=config['openingCodeSha256'],
        scope='unchanged executable pegging; scoring forecast changes discard valuation; inherited cache age retained')


def policy(config):
    runtime=Path(config['output']).parent
    return dict(peggingPolicy='28.3-f64',sourceRevision=config['sourceRevision'],sourceSha256=config['sourceManifestSha256'],binarySha256=sha(config['binary']),
        openingCodeSha256=config['openingCodeSha256'],openingCompatibilityAudit=sha(runtime/'opening-compatibility.json'),audit='29.2 joint pegging point distributions; no WP residuals; inherited 29.1 non-forecast priors')


def bootstrap(config):
    runtime=Path(config['output']).parent
    copy_file(runtime/'target/release/model29-worker',Path(config['binary']))
    atomic(runtime/'opening-compatibility.json',compatibility(config));p=policy(config)
    for target,source,version in [(config['initialRoot'],config['sourceSnapshot'],'29.2'),(config['referenceRoot'],config['originalSnapshot'],'29.0')]:
        if Path(target).exists():
            if verify(target)['policy']!=p:raise ValueError('bootstrap identity changed')
        else:inherit(source,target,p,version)
    out=Path(config['output']);out.mkdir(exist_ok=True)
    atomic(config['trainingControl'],dict(trainingMode=True));atomic(out/'cache-clock.json',dict(completedGames=config['cacheClockBase']))
    previous=json.loads((OLD/'cache-config.json').read_text())
    def chain(field,first):
        tail=previous.get(field,[]);return [str(OLD/'output'/first)]+(tail if isinstance(tail,list) else [tail])
    atomic(config['cacheConfig'],dict(root=str(out/'opening'),referenceRoot=str(out/'baseline-opening'),fallbackRoot=chain('fallbackRoot','opening'),
        referenceFallbackRoot=chain('referenceFallbackRoot','baseline-opening'),baseline=str(runtime/'empty-opening-bank'),clock=str(out/'cache-clock.json'),maxAgeGames=50000,
        baselineGeneration=sha(Path(config['referenceRoot'])/ASSETS/'model29-generation.json'),code=config['openingCodeSha256']))
    atomic(runtime/'bootstrap.json',dict(status='complete',policy=p,parentSnapshot=config['sourceSnapshot']))


def verify_transition(config):
    runtime=Path(config['output']).parent
    if compatibility(config)!=json.loads((runtime/'opening-compatibility.json').read_text()):raise ValueError('compatibility audit changed')
    # Remove the explicitly rejected post-WP overlays for the parity baseline.
    baseline=runtime/'verification-legacy'
    if not baseline.exists():
        inherit(config['sourceSnapshot'],baseline,policy(config),'29.0')
        atomic(baseline/ASSETS/FORECAST,dict(prior_mass=32.,rows={}))
        seal(baseline,0,None,dict(purpose='parity without removed WP overlays'),policy(config),'29.0')
    old=Worker(config['oldBinary'],baseline);new=Worker(config['binary'],config['initialRoot'])
    try:
        for role in ('dealer','pone'):
            text=f'kind=discard;model=29.0;role={role};aiHand=0,4,8,12,16,20;aiScore=110;humanScore=112;turnCard=0'
            if old.call(dict(kind='decision',cache=False,inputText=text))!=new.call(dict(kind='decision',cache=False,inputText=text.replace('29.0','29.2'))):raise ValueError('empty scoring asset changed inherited distribution')
        request=dict(kind='game',seed=config['paritySeed'],firstDealer=0,scores=[0,0],cache=True)
        a=old.call(request);b=new.call(request)
        ignored={'model','seconds','cache','forecastInputs','scoringPacked','scoringInputs','sourceRoot'}
        if {k:v for k,v in a.items() if k not in ignored}!={k:v for k,v in b.items() if k not in ignored}:raise ValueError('empty-asset full-game parity failed')
        from forecast import rejected_requests, scoring_inputs
        if b['model']!='29.2' or not scoring_inputs(b):raise ValueError('scoring priors missing')
        identity,request=rejected_requests([('train:pilot:0',b)],dict(trainingMode=True))[0]
        rejected=new.call(request)
        if len(rejected['outcomes'])!=14 or len(scoring_inputs(rejected))!=14:raise ValueError('all alternatives not recorded')
        from learning import update
        learned=runtime/'verification-candidate'
        if not learned.exists():update(config['initialRoot'],learned,'forecast',[('train:pilot:0',b),(identity,rejected)],1000,config['repo'])
        verify(learned);asset=forecast292.read(learned/ASSETS/forecast292.FILE)
        if not asset['rows'] or not asset['stats']['completeSamples']:raise ValueError('point distributions did not learn')
        probe=Worker(config['binary'],learned)
        try:
            answer=probe.call(dict(kind='decision',cache=False,inputText='kind=discard;model=29.2;role=dealer;aiHand=0,4,8,12,16,20;aiScore=110;humanScore=112;turnCard=0'))
            if not 0<=answer['wp']<=1:raise ValueError('invalid learned forecast inference')
        finally:probe.close()
        atomic(runtime/'verification-games.json',dict(original=a,candidate=b,rejected=rejected))
        atomic(runtime/'verify.json',dict(status='complete',binarySha256=sha(config['binary']),decisionFixtures=2,wholeGameParity=True,
            parityBaseline='inherited priors without discarded WP overlays',allRejectedDiscards=14,learnedAssetVerified=True,scoring=asset['stats'],cache=b['cache']))
    finally:old.close();new.close()


def handoff(config):
    runtime=Path(config['output']).parent
    if str(stopped_parent())!=config['sourceSnapshot']:raise ValueError('stopped predecessor changed')
    checked=json.loads((runtime/'verify.json').read_text())
    if checked['status']!='complete' or checked['binarySha256']!=sha(config['binary']):raise ValueError('unverified executable')
    atomic(runtime/'handoff.json',dict(status='complete',previousJob=OLD.name,sourceSnapshot=config['sourceSnapshot'],initialSha256=sha(Path(config['initialRoot'])/ASSETS/'model29-generation.json'),
        cacheClockBase=config['cacheClockBase'],workers=2,trainingMode=True))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=('prepare','bootstrap','verify','handoff'));parser.add_argument('path',type=Path);parser.add_argument('archive',nargs='?',type=Path);args=parser.parse_args()
    if args.action=='prepare':prepare(args.path,args.archive);return
    config=json.loads(args.path.read_text());verify_source(config)
    {'bootstrap':bootstrap,'verify':verify_transition,'handoff':handoff}[args.action](config)
    print(json.dumps(dict(status='complete',stage=args.action)))

if __name__=='__main__':main()
