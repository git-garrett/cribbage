#!/usr/bin/env python3
"""Freeze a small Model 29 pilot and write its one-shot supervisor specification."""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from learning import ASSETS, PHASES, atomic, sha
from seeds import reserve, recorded


def prepare(source, runtime, archive, training_mode=True):
    source,runtime,archive = map(lambda p:Path(p).resolve(),(source,runtime,archive))
    parent = Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes').resolve()
    if runtime.parent != parent or runtime.exists():
        raise ValueError('choose a new run under persistent internal runtimes')
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    dirty = subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],cwd=source,text=True)
    if dirty:
        raise ValueError('commit the reviewed source before freezing')
    runtime.mkdir(parents=True)
    exclusions,_=recorded(source)
    atomic(runtime/'seed-exclusions.json',exclusions)
    reservation = reserve(source,runtime,5*len(PHASES),exclusions)
    frozen = runtime/'frozen'; frozen.mkdir()
    names = subprocess.check_output(['git','ls-files','-z'],cwd=source).decode().split('\0')
    for name in filter(None,names):
        if not name.startswith(('rust/','scripts/','training/','experiments/model29/','docs/adr/')) and name != 'AGENTS.md':
            continue
        target = frozen/name; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source/name,target)
    corrections = 'model1323-corrections.bin'
    shutil.copy2(source/ASSETS/corrections,frozen/ASSETS/corrections)
    atomic(runtime/'source-manifest.json',dict(revision=revision,
           files={str(p.relative_to(frozen)):sha(p) for p in sorted(frozen.rglob('*')) if p.is_file()}))
    config = dict(model='29.0',sourceRevision=revision,repo=str(frozen),
                  sourceManifestSha256=sha(runtime/'source-manifest.json'),
                  binary=str(runtime/'target/release/model29-worker'),
                  initialRoot=str(runtime/'initial'),output=str(runtime/'output'),archive=str(archive),
                  rounds=5,continuous=True,phases=list(PHASES),trainingGames=200,evaluationPairs=500,workers=10,
                  evaluationEveryGames=5000,seedExclusionsSha256=sha(runtime/'seed-exclusions.json'),
                  trainingMode=training_mode,maxAgeGames=50000,
                  cacheBank=str(parent/'model29-opening-bank-20261016-v1'),
                  cacheTail=str(parent/'model29-opening-tail-20261016-v1'),
                  cacheConfig=str(runtime/'cache-config.json'),
                  seed=reservation['ranges']['training'][0],evaluationSeed=reservation['ranges']['evaluation'][0],
                  paritySeed=reservation['ranges']['parity'][0],
                  trainingScores=[[0,0]],evaluationScores=[[0,0]],
                  priorEffectiveSamples=1000,noninferiorityMargin=.01,
                  buildMode='diagnostic release without PGO; pilot speed is not production throughput')
    atomic(runtime/'config.json',config)
    python = sys.executable; cargo = shutil.which('cargo')
    if not cargo:
        raise ValueError('cargo unavailable')
    env = dict(PATH=os.environ['PATH'],PYTHONDONTWRITEBYTECODE='1',CARGO_BUILD_JOBS='2',
               CARGO_TARGET_DIR=str(runtime/'target'),CRIBBAGE_283_FAST_ASSET='',
               MODEL29_CACHE_CONFIG=config['cacheConfig'])
    def checked(path, field='status', value='complete'):
        return dict(type='json_field',path=str(path),field=field,equals=value)
    def stage(name):
        return dict(name=name,cwd=str(frozen),env=env,
                    command=[python,str(frozen/'experiments/model29/stage.py'),name,str(runtime/'config.json')],
                    completionChecks=[checked(runtime/(name+'.json'))])
    stages = [dict(name='build',cwd=str(frozen),env=env,
                   command=['/bin/bash',str(frozen/'scripts/run-quiet.sh'),'--show-warnings','Model 29 pilot build',
                            cargo,'build','--offline','--locked','--release','--manifest-path',str(frozen/'rust/Cargo.toml'),
                            '-p','cribbage-shadow-engine','--features','model29-training','--bin','model29-worker','--bin','build-model283-opening'],
                   completionChecks=[dict(type='file_exists',path=config['binary'])]),stage('bootstrap'),stage('parity'),stage('await-cache'),stage('cache-parity'),
              dict(name='cycles',cwd=str(frozen),env=env,
                   command=[python,str(frozen/'experiments/model29/cycle.py'),str(runtime/'config.json')],
                   completionChecks=[checked(runtime/'output/result.json')]),stage('report'),stage('sync'),stage('verify-sync')]
    for item in stages:
        if item['name'] in ('build','parity','cache-parity','cycles'):
            item['command'] = [python,str(frozen/'experiments/model29/resources.py'),runtime.name,'10' if item['name']=='cycles' else '2']+item['command']
    stages[-2]['completionChecks'] = [checked(runtime/'sync.json',value='copied')]
    stages[-1]['completionChecks'] = [checked(runtime/'sync-verification.json'),checked(archive/'sync-verification.json')]
    spec = dict(schemaVersion=1,jobId=runtime.name,jobRoot=str(runtime/'supervisor'),stages=stages,
                trainingStudy=dict(root=config['output'],title='Model 29.0 · cyclic prior learning',mode='cyclic',
                    target=5000,workers=10,rounds=None,continuous=True,trainingMode=training_mode,maxAgeGames=50000,cacheBank=config['cacheBank'],cacheTail=config['cacheTail']),
                reportCommand=[python,str(frozen/'scripts/cribbage_job_queue.py'),'summary',str(runtime/'job.json')])
    atomic(runtime/'job.json',spec)
    print(json.dumps(dict(status='prepared',job=str(runtime/'job.json'),seed= config['seed'],evaluationSeed=config['evaluationSeed'])))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('runtime',type=Path); parser.add_argument('archive',type=Path)
    parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[2])
    parser.add_argument('--ordinary-hands-only', action='store_true',
                        help='disable rejected-discard continuations; learn only from played hands')
    args = parser.parse_args(); prepare(args.source,args.runtime,args.archive,not args.ordinary_hands_only)
