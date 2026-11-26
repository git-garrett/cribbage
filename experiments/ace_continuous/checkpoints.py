"""Freeze and assess periodic checkpoints at the training coordinator's boundaries."""
from datetime import datetime, timezone
from hybrid import latest32
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import sys
import time


def read(path, default=None):
    path=Path(path)
    return json.loads(path.read_text()) if path.exists() else default


def save(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+f'.{os.getpid()}.tmp')
    with tmp.open('w') as stream:
        json.dump(value,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    tmp.replace(path)


def sha(path):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()


def files(folder):
    return {str(p.relative_to(folder)):sha(p) for p in sorted(Path(folder).rglob('*')) if p.is_file()}


def verify(folder, manifest):
    for name,digest in manifest.items():
        assert sha(Path(folder)/name)==digest, f'Checkpoint input changed: {name}'


def summary(outcomes):
    assert outcomes and len(outcomes)%2==0
    pairs=[sum(outcomes[i:i+2])/2 for i in range(0,len(outcomes),2)]
    mean=statistics.mean(pairs)
    radius=1.96*statistics.stdev(pairs)/math.sqrt(len(pairs)) if len(pairs)>1 else 1
    return dict(status='complete',games=len(outcomes),pairs=len(pairs),modelWins=sum(outcomes),
        winRate=mean,paired95=[max(0,mean-radius),min(1,mean+radius)],
        candidateSweeps=pairs.count(1),splits=pairs.count(.5),baselineSweeps=pairs.count(0),
        orientationWins=[sum(outcomes[::2]),sum(outcomes[1::2])],
        confidence='Descriptive paired normal 95% interval; repeated checkpoints do not have simultaneous coverage.')


def due(state, now):
    return state is None or state.get('active') is not None or now>=state['nextAt']


def freeze(root, state, sequence, config, now):
    root=Path(root);folder=root/'checkpoints'/f'checkpoint-{sequence:06d}'
    if (folder/'manifest.json').exists():
        if not (folder/'supervisor/job.json').exists():make_job(folder,config)
        return folder
    temporary=folder.with_name(folder.name+'.partial')
    if temporary.exists():shutil.rmtree(temporary)
    temporary.mkdir(parents=True)
    m31=root/'model31';m32=root/'model32'
    pointer=read(m31/'data/current.json')
    assert pointer.get('round')==state['31']['round'], 'Model 31 is not at a committed round boundary'
    source31=m31/'data'/pointer['folder']
    source32=latest32(root,state["32"]["round"])
    assert read(source31/'ace-teacher-state.json')['cursor']==state['31']['cursors']
    assert read(source32/'checkpoint.json')['teacherCursor']==state['32']['cursors']
    cfg31=read(m31/'config.json');cfg32=read(m32/'campaign-config.json')
    reference32=cfg32['references'][0]
    assert reference32['name']=='original'
    baseline31=m31/'baseline-opponent';baseline32=Path(reference32['checkpoint'])
    # Both families must face exactly the same frozen original weights and WP.
    for name in ['pone-peg.npz','dealer-peg.npz','pone-discard.npz','dealer-discard.npz','wp-state.npz']:
        assert sha(baseline31/name)==sha(baseline32/name), 'The baseline references differ: '+name
    for name,source in [('candidate-31',source31),('candidate-32',source32),('baseline-31',baseline31),('baseline-32',baseline32)]:
        shutil.copytree(source,temporary/name)
    for model,source in [(31,m31),(32,m32)]:
        dest=temporary/f'source-{model}';dest.mkdir()
        for p in (source/'source').glob('*.py'):shutil.copy2(p,dest/p.name)
    save(temporary/'config-31.json',cfg31);save(temporary/'config-32.json',cfg32)
    binaries=dict(cfg31['nativeCpp']['hashes'])
    binaries[str(m32/'build/libmodel32_33.dylib')]=sha(m32/'build/libmodel32_33.dylib')
    binaries[str(m32/'cargo-target/release/libmodel3233_env.dylib')]=sha(m32/'cargo-target/release/libmodel3233_env.dylib')
    binaries[reference32['library']]=sha(reference32['library'])
    for i,(path,digest) in enumerate(binaries.items()):
        assert sha(path)==digest, 'Native binary identity changed: '+path
        dest=temporary/'binaries'/str(i)/Path(path).name;dest.parent.mkdir(parents=True);shutil.copy2(path,dest)
    for name in ['evaluate.py','checkpoints.py','hybrid.py']:
        shutil.copy2(Path(__file__).with_name(name),temporary/name)
    # Use the existing global allocator in production; both models share this
    # reservation, and different checkpoints never reuse its deal seeds.
    reservation=None
    if config.get('historicalSeeds'):
        reserved=Path(config['runtimes'])/(config['reservationPrefix']+f'-{sequence:06d}')
        ledger=Path(config['runtimes'])/'coordination/ordered-outcome-seed-reservations.json'
        reservation=next((entry['ranges'] for entry in read(ledger,[]) if entry['root']==str(reserved)),None)
        if reservation is None:
            # The installer may use a stdlib-only Python; the established seed
            # allocator imports NumPy, so run it in the frozen ML environment.
            script=('import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);'
                    'from prepare_run import reserve_seeds;'
                    'print(json.dumps(reserve_seeds(Path(sys.argv[2]),Path(sys.argv[3]),'
                    'Path(sys.argv[4]),sizes=dict(baseline=int(sys.argv[5])))))')
            reservation=json.loads(subprocess.check_output([config['python'],'-c',script,
                str(m31/'source'),str(reserved),config['repo'],config['historicalSeeds'],str(2*config['pairs'])],text=True))
        assert reservation['baseline'][1]-reservation['baseline'][0]+1==2*config['pairs']
        seed=reservation['baseline'][0]
    else:
        seed=config['seedBase']+(sequence-1)*config['pairs']
    assert seed+2*config['pairs']<2**32
    manifest=dict(sequence=sequence,createdAt=now,modelRounds={k:v['round'] for k,v in state.items()},
        trainingState=state,pairs=config['pairs'],games=2*config['pairs'],seed=seed,seedReservation=reservation,
        baseline='Unchanged original Model 31, identical weights and WP for both comparisons',
        binaries=binaries,model32Runtime=str(m32),python=config['python'],
        archive=str(Path(config['archive'])/folder.name),cpuWorkers=1,gpu=True,
        inferenceBackend='Existing native C++/MLX with Rust game rules')
    manifest['files']=files(temporary);save(temporary/'manifest.json',manifest)
    temporary.rename(folder)
    make_job(folder,config)
    return folder


def make_job(folder, config):
    sequence=read(folder/'manifest.json')['sequence']
    supervisor=folder/'supervisor';supervisor.mkdir(exist_ok=True)
    shutil.copy2(config['runner'],supervisor/'cribbage_job_queue.py')
    stages=[]
    for name in ['verify-inputs','compare-31','compare-32','verify-results','report','archive']:
        receipt=folder/(name+'.json')
        stages.append(dict(name=name,command=[config['python'],str(folder/'evaluate.py'),str(folder),name],
            env=dict(PYTHONUNBUFFERED='1',OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',VECLIB_MAXIMUM_THREADS='1',MLX_NUM_THREADS='1'),
            completionChecks=[dict(type='json_field',path=str(receipt),field='status',equals='complete')]))
    spec=dict(schemaVersion=1,jobId='baseline-checkpoint-'+f'{sequence:06d}',jobRoot=str(supervisor),stages=stages)
    save(supervisor/'job.json',spec)




def watch(config, folder):
    path=Path(config['watchConfig'])
    data=read(path)
    job=dict(name='Periodic baseline checkpoint comparisons',spec=str(folder/'supervisor/job.json'),
        worker=str(folder/'evaluate.py'),workerExecutable=config['workerExecutable'])
    data['jobs']=[j for j in data['jobs'] if j['name']!=job['name']]+[job]
    save(path,data)


def prune(root, keep=2):
    complete=[p for p in sorted((Path(root)/'checkpoints').glob('checkpoint-*'))
              if p.is_dir() and read(p/'archive.json',{}).get('status')=='complete']
    for folder in complete[:-keep]:
        receipt=read(folder/'archive.json')
        # Never release local artifacts until the retained archive manifest is present.
        target=Path(receipt['archive'])
        if not target.is_dir() or read(target/'archive-manifest.json')!=receipt['files']:continue
        try:verify(target,receipt['files'])
        except (OSError,AssertionError):continue
        for name in ['candidate-31','candidate-32','baseline-31','baseline-32','evaluation-31','evaluation-32','binaries']:
            p=folder/name
            if p.exists():shutil.rmtree(p)


def maybe_checkpoint(root, state, execute, now=None):
    root=Path(root);config=read(root/'checkpoint-config.json')
    if not config:return None
    now=time.time() if now is None else now
    path=root/'checkpoint-state.json';schedule=read(path)
    if not due(schedule,now):return None
    if schedule and schedule.get('active'):
        folder=Path(schedule['active'])
    else:
        sequence=(schedule or {}).get('sequence',0)+1
        folder=freeze(root,state,sequence,config,now)
        schedule=dict(sequence=sequence,active=str(folder),nextAt=now)
        save(path,schedule)
    watch(config,folder)
    status=read(folder/'supervisor/status.json',{})
    # Failed stages stay failed until explicitly repaired; orphaned in-progress
    # work resumes through the original exact job and immutable batch journals.
    if status.get('state')=='failed':code=1
    else:
        save(root/'gpu-live.json',dict(status='evaluating frozen checkpoint',checkpoint=folder.name,
                                     modelRounds=read(folder/'manifest.json')['modelRounds']))
        code=execute([config['python'],str(folder/'supervisor/cribbage_job_queue.py'),'run',str(folder/'supervisor/job.json')])
    completed=time.time()
    schedule.update(active=None,lastCheckpoint=str(folder),lastStatus='complete' if code==0 else 'failed',
                    completedAt=completed,nextAt=completed+config['intervalSeconds'])
    save(path,schedule)
    prune(root,config.get('retainLocal',2))
    return schedule
