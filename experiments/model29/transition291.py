#!/usr/bin/env python3
"""Prepare and verify 29.1 before a one-shot, checkpoint-preserving handover."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
from learning import ASSETS, PHASES, atomic, inherit, sha, verify, verify_source
from cycle import Worker
from seeds import reserve, recorded
import resources

PARENT = Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes')
OLD = PARENT/'model29-continuous-20261016-v1'
OLD_SPEC = OLD/'resource-relief-20261021-v1/live-job-v3.json'


def copy_file(source, target):
    target.parent.mkdir(parents=True,exist_ok=True)
    result=subprocess.run(['/bin/cp','-c',str(source),str(target)],capture_output=True)
    if result.returncode:shutil.copy2(source,target)


def parent_snapshot():
    return Path(json.loads((OLD/'output/history.json').read_text())['experimentalRoot'])


def prepare(runtime, archive, ordinary_only):
    source=Path(__file__).resolve().parents[2]
    runtime=runtime.resolve();archive=archive.resolve()
    if runtime.parent!=PARENT or runtime.exists():raise ValueError('choose a fresh persistent internal runtime')
    if subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=source,text=True):raise ValueError('commit source first')
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    runtime.mkdir();frozen=runtime/'frozen';frozen.mkdir()
    names=subprocess.check_output(['git','ls-files','-z'],cwd=source).decode().split('\0')
    for name in filter(None,names):
        if name.startswith(('rust/','scripts/','training/','experiments/model29/','docs/adr/')) or name=='AGENTS.md':
            copy_file(source/name,frozen/name)
    copy_file(OLD/'initial'/ASSETS/'model1323-corrections.bin',frozen/ASSETS/'model1323-corrections.bin')
    atomic(runtime/'source-manifest.json',dict(revision=revision,files={str(p.relative_to(frozen)):sha(p) for p in sorted(frozen.rglob('*')) if p.is_file()}))
    exclusions,_=recorded(source);atomic(runtime/'seed-exclusions.json',exclusions)
    seeds=reserve(source,runtime,50*len(PHASES),exclusions)
    snapshot=parent_snapshot();old=verify(snapshot)
    config=dict(model='29.1',sourceRevision=revision,repo=str(frozen),
        sourceManifestSha256=sha(runtime/'source-manifest.json'),binary=str(runtime/'bin/model29-worker'),
        initialRoot=str(runtime/'initial'),referenceRoot=str(runtime/'reference'),sourceSnapshot=str(snapshot),
        originalSnapshot=str(OLD/'initial'),oldRuntime=str(OLD),oldSpec=str(OLD_SPEC),
        oldBinary=str(OLD/'target/release/model29-worker'),openingCodeSha256=old['policy']['binarySha256'],
        output=str(runtime/'output'),trainingControl=str(runtime/'output/training-control.json'),archive=str(archive),cacheConfig=str(runtime/'cache-config.json'),
        rounds=50,continuous=True,phases=list(PHASES),trainingGames=20,evaluationPairs=500,workers=2,
        evaluationEveryGames=5000,trainingMode=not ordinary_only,maxAgeGames=50000,
        seed=seeds['ranges']['training'][0],evaluationSeed=seeds['ranges']['evaluation'][0],paritySeed=seeds['ranges']['parity'][0],
        seedExclusionsSha256=sha(runtime/'seed-exclusions.json'),trainingScores=[[0,0]],evaluationScores=[[0,0]],
        priorEffectiveSamples=1000,noninferiorityMargin=.01,minimumFreeBytes=10*1024**3,
        buildMode='FP64 diagnostic release without PGO; two workers; 20-game batches')
    atomic(runtime/'config.json',config)
    target=runtime/'target';python=sys.executable;cargo=shutil.which('cargo')
    env=dict(PATH=os.environ['PATH'],PYTHONDONTWRITEBYTECODE='1',CARGO_BUILD_JOBS='1',CARGO_TARGET_DIR=str(target),
        MODEL29_CACHE_CONFIG=config['cacheConfig'],CRIBBAGE_283_FAST_ASSET='')
    runner=str(frozen/'experiments/model29/transition291.py')
    def check(path):return dict(type='json_field',path=str(path),field='status',equals='complete')
    def stage(name,command,checks,cpus=None):
        if cpus:command=[python,str(frozen/'experiments/model29/resources.py'),runtime.name,str(cpus)]+command
        return dict(name=name,cwd=str(frozen),env=env,command=command,completionChecks=checks)
    stages=[stage('build',[str(frozen/'scripts/run-quiet.sh'),'--show-warnings','Model 29.1 release build',cargo,'build','--offline','--locked','--release',
                '--manifest-path',str(frozen/'rust/Cargo.toml'),'-p','cribbage-shadow-engine','--features','model29-training','--bin','model29-worker'],
                [dict(type='file_exists',path=str(target/'release/model29-worker'))],1)]
    for name in ('bootstrap','verify','handoff'):
        stages.append(stage(name,[python,runner,name,str(runtime/'config.json')],[check(runtime/(name+'.json'))],1 if name=='verify' else None))
    stages.append(stage('cycles',[python,str(frozen/'experiments/model29/cycle.py'),str(runtime/'config.json')],[check(runtime/'output/result.json')],2))
    for name in ('report','sync','verify-sync'):
        stages.append(stage(name,[python,str(frozen/'experiments/model29/stage.py'),name,str(runtime/'config.json')],
            [dict(type='json_field',path=str(runtime/(name+'.json' if name!='verify-sync' else 'sync-verification.json')),field='status',equals='copied' if name=='sync' else 'complete')]))
    stages[-1]['completionChecks'].append(check(archive/'sync-verification.json'))
    spec=dict(schemaVersion=1,jobId=runtime.name,jobRoot=str(runtime/'supervisor'),stages=stages,
        trainingStudy=dict(root=config['output'],title='Model 29.1 · exact-hand forecast learning',mode='cyclic',target=5000,
            workers=2,rounds=None,continuous=True,trainingMode=not ordinary_only,maxAgeGames=50000),
        reportCommand=[python,str(frozen/'scripts/cribbage_job_queue.py'),'summary',str(runtime/'job.json')])
    atomic(runtime/'job.json',spec)
    print(json.dumps(dict(status='prepared',job=str(runtime/'job.json'),sourceSnapshot=str(snapshot),workers=2,trainingMode=not ordinary_only)))


def policy(config):
    runtime=Path(config['output']).parent
    return dict(peggingPolicy='28.3-f64',sourceRevision=config['sourceRevision'],sourceSha256=config['sourceManifestSha256'],
        binarySha256=sha(config['binary']),openingCodeSha256=config['openingCodeSha256'],
        openingCompatibilityAudit=sha(runtime/'opening-compatibility.json'),
        audit='29.1 exact-hand WP correction; unchanged executable pegging; inherited 29.0 priors')


def cache_config(config):
    runtime=Path(config['output']).parent;out=Path(config['output']);out.mkdir(exist_ok=True)
    old=Path(config['oldRuntime'])
    if not Path(config['trainingControl']).exists():atomic(config['trainingControl'],dict(trainingMode=config['trainingMode']))
    if 'cacheClockBase' not in config:
        config['cacheClockBase']=json.loads((old/'output/cache-clock.json').read_text())['completedGames']
    atomic(runtime/'config.json',config)
    atomic(out/'cache-clock.json',dict(completedGames=config['cacheClockBase']))
    atomic(config['cacheConfig'],dict(root=str(out/'opening'),referenceRoot=str(out/'baseline-opening'),
        fallbackRoot=str(old/'output/opening'),referenceFallbackRoot=str(old/'output/baseline-opening'),
        baseline=str(runtime/'empty-opening-bank'),clock=str(out/'cache-clock.json'),maxAgeGames=50000,
        baselineGeneration=sha(Path(config['referenceRoot'])/ASSETS/'model29-generation.json'),code=config['openingCodeSha256']))


def compatibility(config):
    """Only explicitly inspected execution/recording changes may reuse old books."""
    source=Path(config['repo'])/'rust/cribbage-shadow-engine'
    old=Path(config['oldRuntime'])/'frozen/rust/cribbage-shadow-engine'
    exceptions={'bin/model29-worker.rs','lib.rs','model_id.rs','model.rs','model29_snapshot.rs','model283_opening_training.rs'}
    unchanged={}
    for path in old.rglob('*.rs'):
        name=str(path.relative_to(old));new=source/name
        if name in exceptions:continue
        if not new.exists() or sha(path)!=sha(new):raise ValueError('opening-policy source changed: '+name)
        unchanged[name]=sha(path)
    # The only model.rs changes are version routing and the discard correction.
    current=(source/'model.rs').read_text()
    current=current.replace('if !matches!(input.model.as_str(), crate::model_id::MODEL_29_0 | "29.0" | crate::model_id::MODEL_29_1 | "29.1") {',
        'if input.model != crate::model_id::MODEL_29_0 && input.model != "29.0" {')
    current=current.replace('\n        #[cfg(feature = "model29-training")]\n        crate::model291_forecast::adjust(input, &discard, board, &mut evaluation.win_probability)?;','')
    if current!=(old/'model.rs').read_text():raise ValueError('unreviewed executable-policy difference')
    if sha(config['oldBinary'])!=config['openingCodeSha256']:raise ValueError('old executable changed')
    return dict(status='complete',unchanged=unchanged,inspectedExceptions={n:sha(source/n) for n in sorted(exceptions)},
        code=config['openingCodeSha256'],scope='unchanged pegging calculations; discard changes remain covered by declared prior lag')


def bootstrap(config):
    runtime=Path(config['output']).parent
    copy_file(runtime/'target/release/model29-worker',Path(config['binary']))
    atomic(runtime/'opening-compatibility.json',compatibility(config))
    p=policy(config)
    for target,source,version in ((config['initialRoot'],config['sourceSnapshot'],'29.1'),(config['referenceRoot'],config['originalSnapshot'],'29.0')):
        if Path(target).exists():
            if verify(target)['policy']!=p:raise ValueError('bootstrap snapshot changed')
        else:inherit(source,target,p,version)
    cache_config(config)
    atomic(runtime/'bootstrap.json',dict(status='complete',policy=p,parentSnapshot=config['sourceSnapshot']))


def verify_transition(config):
    runtime=Path(config['output']).parent
    audit=compatibility(config)
    if audit!=json.loads((runtime/'opening-compatibility.json').read_text()):raise ValueError('opening compatibility changed')
    # The new forecast is empty: demonstrate unchanged decisions and a whole
    # ordinary game before allowing the new job to stop its predecessor.
    old=Worker(config['oldBinary'],config['sourceSnapshot'])
    new=Worker(config['binary'],config['initialRoot'])
    try:
        decisions=0
        for role in ('dealer','pone'):
            text=f'kind=discard;model=29.0;role={role};aiHand=0,4,8,12,16,20;aiScore=110;humanScore=112;turnCard=0'
            a=old.call(dict(kind='decision',cache=False,inputText=text))
            b=new.call(dict(kind='decision',cache=False,inputText=text.replace('29.0','29.1')))
            if a!=b:raise ValueError('initial discard policy differs')
            decisions+=1
        request=dict(kind='game',seed=config['paritySeed'],firstDealer=0,scores=[0,0],cache=True)
        a=old.call(request);b=new.call(request)
        ignored={'model','seconds','cache','forecastInputs','sourceRoot'}
        if {k:v for k,v in a.items() if k not in ignored}!={k:v for k,v in b.items() if k not in ignored}:raise ValueError('initial full-game policy differs')
        if b['model']!='29.1' or not b.get('forecastInputs'):raise ValueError('29.1 forecast inputs missing')
        from forecast import rejected_requests, ordinary_cohorts
        requests=rejected_requests([('train:pilot:0',b)],dict(trainingMode=True))
        identity,request=requests[0]
        result=new.call(request)
        if len(result['outcomes'])!=14 or any(not r.get('forecast') for r in result['outcomes']):raise ValueError('missing rejected-discard forecasts')
        # Exercise a real update and inference on both ordinary and alternative evidence.
        from learning import update
        learned=runtime/'verification-candidate'
        if not learned.exists():update(config['initialRoot'],learned,'forecast',[('train:pilot:0',b),(identity,result)],1000,config['repo'])
        verify(learned)
        probe=Worker(config['binary'],learned)
        try:
            answer=probe.call(dict(kind='decision',cache=False,inputText='kind=discard;model=29.1;role=dealer;aiHand=0,4,8,12,16,20;aiScore=110;humanScore=112;turnCard=0'))
            if not 0<=answer['wp']<=1:raise ValueError('invalid learned forecast')
        finally:probe.close()
        atomic(runtime/'verification-games.json',dict(original=a,candidate=b,rejected=result))
        atomic(runtime/'verify.json',dict(status='complete',binarySha256=sha(config['binary']),decisionFixtures=decisions,
            wholeGameParity=True,allRejectedDiscards=14,learnedAssetVerified=True,cache=b['cache']))
    finally:old.close();new.close()


def install_initial(source, target, policy_value):
    """Publish a complete inherited snapshot; resume safely around either rename."""
    target=Path(target);parent=sha(Path(source)/ASSETS/'model29-generation.json')
    def matches(path):
        value=verify(path)
        return value['model']=='29.1' and value['parent']==parent and value['policy']==policy_value
    if target.exists() and matches(target):return
    staged=target.with_name('handoff-initial')
    if staged.exists():
        try:valid=matches(staged)
        except (ValueError,FileNotFoundError):valid=False
        if not valid:staged.rename(staged.with_name('interrupted-handoff-'+str(time.time_ns())))
    if not staged.exists():inherit(source,staged,policy_value)
    if target.exists():target.rename(target.with_name('preflight-initial-'+str(time.time_ns())))
    staged.rename(target)


def handoff(config):
    runtime=Path(config['output']).parent;receipt=runtime/'handoff.json'
    if receipt.exists():
        if json.loads(receipt.read_text())['initialSha256']!=sha(Path(config['initialRoot'])/ASSETS/'model29-generation.json'):raise ValueError('handoff identity changed')
        return
    checked=json.loads((runtime/'verify.json').read_text())
    if checked['status']!='complete' or checked['binarySha256']!=sha(config['binary']):raise ValueError('unverified executable')
    latest=parent_snapshot()
    if verify(latest)['policy']['binarySha256']!=config['openingCodeSha256']:raise ValueError('parent policy changed before handoff')
    queue=Path(config['repo'])/'scripts/cribbage_job_queue.py'
    subprocess.run([sys.executable,str(queue),'summary',config['oldSpec']],check=True)
    subprocess.run([sys.executable,str(queue),'stop',config['oldSpec']],check=True)
    owner=Path(config['oldRuntime']).name
    lease=resources.RESERVATION.parent/('model29-lease-'+hashlib.sha256(owner.encode()).hexdigest()+'.lock')
    with lease.open('a+') as lock:
        deadline=time.monotonic()+30
        while True:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()>deadline:raise RuntimeError('previous workers still hold their lease')
                time.sleep(.5)
        allocations=json.loads(resources.RESERVATION.read_text()).get('allocations',{})
        if owner in allocations:resources.allocation(owner,allocations[owner],release=True)
    # Freeze the stopped predecessor's checkpoint before changing any target.
    # A retry uses the same parent even if publication was interrupted.
    source_receipt=runtime/'handoff-source.json'
    if source_receipt.exists():
        source=json.loads(source_receipt.read_text())
    else:
        latest=parent_snapshot();verify(latest)
        with sqlite3.connect('file:'+str(Path(config['oldRuntime'])/'output/evidence.db')+'?mode=ro',uri=True) as db:
            counts={name:db.execute('select count(*) from results where id like ?', (prefix,)).fetchone()[0]
                    for name,prefix in [('training','train:%'),('evaluation','eval:%'),('forecast','forecast:%')]}
        source=dict(root=str(latest),counts=counts)
        atomic(source_receipt,source)
    latest=Path(source['root']);counts=source['counts'];initial=Path(config['initialRoot'])
    install_initial(latest,initial,policy(config))
    config['sourceSnapshot']=str(latest);config['cacheClockBase']=counts['training']+counts['evaluation']
    cache_config(config)
    atomic(receipt,dict(status='complete',previousJob=owner,previousCounts=counts,sourceSnapshot=str(latest),
        initialSha256=sha(initial/ASSETS/'model29-generation.json'),cacheClockBase=config['cacheClockBase'],workers=2,trainingMode=config['trainingMode']))


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=('prepare','bootstrap','verify','handoff'))
    parser.add_argument('path',type=Path);parser.add_argument('archive',nargs='?',type=Path)
    parser.add_argument('--ordinary-hands-only',action='store_true');args=parser.parse_args()
    if args.action=='prepare':prepare(args.path,args.archive,args.ordinary_hands_only);return
    config=json.loads(args.path.read_text());verify_source(config)
    {'bootstrap':bootstrap,'verify':verify_transition,'handoff':handoff}[args.action](config)
    print(json.dumps(dict(status='complete',stage=args.action)))

if __name__=='__main__':main()
