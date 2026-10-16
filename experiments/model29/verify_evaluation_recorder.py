#!/usr/bin/env python3
"""Frozen, supervised parity check before enabling evaluation-only telemetry."""
import concurrent.futures
import json
import os
from pathlib import Path
import sys

from evaluation_runner import sha


def main():
    upgrade = Path(sys.argv[1]).resolve()
    setup = json.loads((upgrade/'setup.json').read_text())
    config_path = Path(setup['config']); config = json.loads(config_path.read_text())
    sys.path.insert(0,str(Path(config['repo'])/'experiments/model29'))
    from cycle import Worker
    from learning import atomic, verify_source
    verify_source(config)
    source = json.loads((Path(config['repo']).parent/'source-manifest.json').read_text())
    worker_file = 'rust/cribbage-shadow-engine/bin/model29-worker.rs'
    for relative, digest in source['files'].items():
        if relative != worker_file and sha(upgrade/'source'/relative) != digest:
            raise ValueError('Recorder changed a policy input: '+relative)
    actual = {str(p.relative_to(upgrade/'source')) for p in (upgrade/'source').rglob('*') if p.is_file()}
    if actual != set(source['files']): raise ValueError('Recorder source inventory changed')
    binary = upgrade/'target/release/model29-worker'
    seed = json.loads((upgrade/'seed-reservation.json').read_text())['ranges']['parity'][0]
    requests = [dict(kind='game',seed=seed+i,firstDealer=i,candidateSide=side,scores=[0,0],cache=True)
                for i in range(2) for side in (0,1)]
    base_cache = json.loads(Path(config['cacheConfig']).read_text())
    atomic(upgrade/'parity-clock.json',dict(completedGames=setup['cacheClock']))
    # Each binary sees independent cache files, identical initial banks and age.
    def play(name, executable):
        cache = dict(base_cache,root=str(upgrade/name/'opening'),referenceRoot=str(upgrade/name/'baseline-opening'),
                     clock=str(upgrade/'parity-clock.json'))
        atomic(upgrade/name/'cache.json',cache)
        import subprocess
        env=dict(os.environ,MODEL29_CACHE_CONFIG=str(upgrade/name/'cache.json'))
        lease=env.get('MODEL29_LEASE_FD')
        worker=Worker.__new__(Worker)
        worker.process=subprocess.Popen([str(executable),setup['parityRoot'],config['initialRoot']],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,env=env,
            pass_fds=(int(lease),) if lease else ())
        try: return [worker.call(request) for request in requests]
        finally: worker.close()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        old=pool.submit(play,'original',config['binary']); new=pool.submit(play,'recorder',binary)
        old,new=old.result(),new.result()
    semantic=lambda game:{k:v for k,v in game.items() if k not in ('seconds','cache','benchmark')}
    if any(semantic(a) != semantic(b) for a,b in zip(old,new)):
        raise ValueError('Recording changed decisions or game outcomes')
    for game in new:
        data=game['benchmark']
        for d in data['discards']+data['plays']:
            if 'legalCount' not in d or (d['action']==0 and d['legalCount']>1):
                if any(d[k] is None for k in ('ev','wp','micros')):
                    raise ValueError('Missing non-forced decision telemetry')
    sys.path.insert(0,str(upgrade/'reporting'))
    from benchmark_workbench_comparisons import hand_scores
    from benchmark_comparison_telemetry import telemetry_report
    telemetry=telemetry_report(new,hand_scores)
    if telemetry['telemetry']['status'] != 'complete' or not all(telemetry[k]['rows'] for k in ('evCalibration','winProbabilityCalibration','timing')):
        raise ValueError('Incomplete benchmark metrics')
    atomic(upgrade/'parity-games.json',dict(original=old,recorder=new,telemetry=telemetry))
    atomic(upgrade/'parity.json',dict(status='complete',games=len(new),binarySha256=sha(binary),
        trainingBinarySha256=sha(config['binary']),seedRange=[seed,seed+1],
        policySourcesUnchanged=True,decisionOutcomeParity=True,telemetryComplete=True))
    files = [p for folder in ('source','reporting') for p in (upgrade/folder).rglob('*') if p.is_file()]
    files += [binary,upgrade/'evaluation_runner.py',upgrade/'verify_evaluation_recorder.py',
              upgrade/'parity.json',upgrade/'setup.json',upgrade/'seed-reservation.json']
    atomic(upgrade/'extension.json',dict(schemaVersion=1,configSha256=sha(config_path),
        trainingBinarySha256=sha(config['binary']),binary=str(binary),parity=str(upgrade/'parity.json'),
        files={str(p):sha(p) for p in files}))
    print('Evaluation recorder verified: 4 matched games, unchanged policy sources, complete benchmark telemetry.')


if __name__=='__main__':main()
