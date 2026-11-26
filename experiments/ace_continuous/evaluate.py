"""Run frozen baseline comparisons with existing native inference and Rust rules."""
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

from checkpoints import files, read, save, sha, summary, verify

ROOT=Path(sys.argv[1])
MANIFEST=read(ROOT/'manifest.json')


def inputs():
    verify(ROOT,MANIFEST['files'])
    for path,digest in MANIFEST['binaries'].items():
        assert sha(path)==digest,'Live native binary identity changed: '+path


def guard(*_):
    while shutil.disk_usage(ROOT).free<5*2**30 or subprocess.check_output(
        ['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],text=True).strip()=='4':
        time.sleep(5)


def outcomes(model):
    base=MANIFEST['seed'];pairs=MANIFEST['pairs'];result=[]
    if model==31:
        path=ROOT/'evaluation-31/games/comparison.jsonl.gz'
        with gzip.open(path,'rt') as stream:
            for i,line in enumerate(stream):
                game=json.loads(line)
                assert (game['id'],game['seed'],game['orientation'])==(i,base+i//2,i%2)
                assert game['winner'] in (0,1) and game['scores'][game['winner']]==121
                result.append(int(game['winner']==game['orientation']))
    else:
        for offset in range(0,pairs,32):
            count=min(32,pairs-offset)
            path=ROOT/'evaluation-32'/f'batch-{offset:06d}'/'games.jsonl'
            games=[json.loads(line) for line in path.read_text().splitlines()]
            assert len(games)==count*2
            for i,game in enumerate(games):
                assert (game['seed'],game['orientation'])==(base+offset+i//2,i%2)
                assert game['winner'] in (0,1) and game['scores'][game['winner']]==121
                result.append(int(game['winner']==i%2))
    assert len(result)==pairs*2
    return result


def compare31():
    sys.path.insert(0,str(ROOT/'source-31'))
    import numpy as np
    from checkpoint_policy import models
    from native_rollout import Rollout
    cfg=read(ROOT/'config-31.json')
    cfg.update(model='31.0',candidateChunk=128,candidateQueueDepth=1,initializationSeed=8110403)
    candidate=ROOT/'candidate-31';baseline=ROOT/'baseline-31'
    folder=ROOT/'evaluation-31';folder.mkdir(exist_ok=True)
    Rollout(cfg['nativeCpp']['rolloutBuild'])(folder,cfg,models(cfg,ROOT,candidate.name),
        np.load(candidate/'wp-state.npz')['table'],MANIFEST['seed'],MANIFEST['games'],32,'comparison',
        opponent=(models(cfg,ROOT,baseline.name),np.load(baseline/'wp-state.npz')['table']),progress=guard)
    return summary(outcomes(31))


def compare32():
    sys.path.insert(0,str(ROOT/'source-32'))
    import campaign
    from native import Backend
    from runner import Player,Model31
    runtime=Path(MANIFEST['model32Runtime'])
    cfg=read(ROOT/'config-32.json');reference=cfg['references'][0]
    backend=Backend(runtime)
    player=Player.load(backend,ROOT/'candidate-32',True)
    opponent=None
    try:
        opponent=Model31(runtime,ROOT/'baseline-32',reference['library'],True)
        campaign.evaluate(runtime,player,opponent,ROOT/'evaluation-32',MANIFEST['pairs'],MANIFEST['seed'],backend)
    finally:
        player.close()
        if opponent is not None:opponent.close()
    return summary(outcomes(32))


def verify_results():
    inputs()
    for model in (31,32):
        result=read(ROOT/f'compare-{model}.json')
        expected=summary(outcomes(model))
        assert all(result[k]==v for k,v in expected.items()),'Comparison summary differs from saved games'
        assert result['seed']==MANIFEST['seed'] and result['round']==MANIFEST['modelRounds'][str(model)]


def report():
    data={str(model):read(ROOT/f'compare-{model}.json') for model in (31,32)}
    text=[f"Checkpoint {MANIFEST['sequence']}: frozen models versus original Model 31",'',
          '| Model | Round | Games | Win rate | Paired 95% interval |',
          '|---|---:|---:|---:|---:|']
    for model,row in data.items():
        lo,hi=row['paired95']
        text.append(f"| {model} | {row['round']} | {row['games']:,} | {row['winRate']:.2%} | {lo:.2%}–{hi:.2%} |")
    text+=['','Fresh shared deal seeds; both seat orientations for every deal.',
           'Intervals are descriptive. Repeated checkpoints do not establish simultaneous confidence or automatic promotion.',
           'Training resumes after this comparison. The separate Ace benchmark remains held.']
    (ROOT/'report.txt').write_text('\n'.join(text)+'\n')
    save(ROOT/'report.json',dict(status='complete',manifest=MANIFEST,results=data,completedAt=time.time()))


def archive():
    target=Path(MANIFEST['archive'])
    assert Path('/Volumes/TerraMasterWDBlue').is_mount(),'Archive volume is unavailable'
    if not (target/'archive-manifest.json').exists():
        temporary=target.with_name(target.name+'.partial')
        if temporary.exists():shutil.rmtree(temporary)
        temporary.parent.mkdir(parents=True,exist_ok=True)
        shutil.copytree(ROOT,temporary,ignore=shutil.ignore_patterns('*.tmp'))
        identities=files(temporary);verify(temporary,identities)
        # Check the copied scientific inputs against the frozen source manifest.
        verify(temporary,MANIFEST['files'])
        save(temporary/'archive-manifest.json',identities)
        assert not target.exists(),'Incomplete archive target needs inspection'
        temporary.rename(target)
    identities=read(target/'archive-manifest.json');verify(target,identities)
    assert read(target/'manifest.json')==MANIFEST
    save(ROOT/'archive.json',dict(status='complete',archive=str(target),files=identities))


if __name__=='__main__':
    stage=sys.argv[2]
    if stage=='verify-inputs':inputs();save(ROOT/(stage+'.json'),dict(status='complete'))
    elif stage in ('compare-31','compare-32'):
        inputs();model=int(stage.split('-')[1]);guard();started=time.time()
        result=compare31() if model==31 else compare32()
        result.update(model=model,round=MANIFEST['modelRounds'][str(model)],seed=MANIFEST['seed'],
                      startedAt=started,completedAt=time.time())
        save(ROOT/(stage+'.json'),result)
    elif stage=='verify-results':verify_results();save(ROOT/(stage+'.json'),dict(status='complete'))
    elif stage=='report':report()
    elif stage=='archive':archive()
    else:raise ValueError(stage)
