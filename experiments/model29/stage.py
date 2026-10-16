#!/usr/bin/env python3
"""Objective completion receipts for the one-shot pilot supervisor."""
import argparse
import json
import shutil
import sqlite3
import time
from pathlib import Path
from cycle import Worker
from learning import ASSETS, atomic, bootstrap, manifest, sha, verify


def run(stage, config):
    root = Path(config['repo']); out = Path(config['output']); runtime = out.parent
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
                atomic(runtime/'bootstrap.json',dict(status='complete',policy=policy)); return
            except (OSError,ValueError,KeyError):
                initial.rename(runtime/f'interrupted-bootstrap-{time.time_ns()}')
        bootstrap(root,initial,policy)
        atomic(runtime/'bootstrap.json',dict(status='complete',policy=policy))
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
        expected_training = config['rounds']*len(config['phases'])*config['trainingGames']
        with sqlite3.connect(out/'evidence.db') as db:
            rows = db.execute('select id,root,result from results order by id').fetchall()
        training = [json.loads(r[2]) for r in rows if r[0].startswith('train:')]
        if len(training) != expected_training:
            raise ValueError('incomplete training games')
        for i in range(config['rounds']*len(config['phases'])):
            expected = {f'train:{i}:{j}' for j in range(config['trainingGames'])}
            actual = {r[0] for r in rows if r[0].startswith(f'train:{i}:')}
            if actual != expected:
                raise ValueError('missing or overlapping game indices')
        for path in out.glob('*/candidate'):
            verify(path)
        full = [g for g in training if g['trajectory']]
        seconds = sum(g['seconds'] for g in full)
        report = dict(status='complete',model='29.0',trainingGames=len(training),
                      completedTwoSidedTrajectories=len(full),evaluationGames=len(rows)-len(training),
                      twoSidedGamesPerHour=3600*len(full)/seconds if seconds else None,
                      stages=[dict(phase=s['phase'],changed=s['update']['changed'],
                                   evaluations=s['evaluations'],promoted=s['promoted']) for s in result['stages']],
                      parity=json.loads((runtime/'parity.json').read_text()),
                      promoted=result['promoted'],interpretation='Engineering pilot; insufficient evidence of playing-strength improvement')
        atomic(runtime/'report.json',report)
        print(json.dumps(report))
    elif stage == 'sync':
        archive = Path(config['archive']); archive.mkdir(parents=True,exist_ok=True)
        # Completed snapshots and evidence are archived, not large compiler caches.
        shutil.copytree(out,archive/'output',dirs_exist_ok=True)
        for name in ('config.json','source-manifest.json','seed-reservation.json','job.json',
                     'bootstrap.json','parity.json','report.json'):
            shutil.copy2(runtime/name,archive/name)
        shutil.copytree(runtime/'frozen',archive/'frozen',dirs_exist_ok=True)
        shutil.copytree(runtime/'initial',archive/'initial',dirs_exist_ok=True)
        (archive/'bin').mkdir(exist_ok=True)
        shutil.copy2(config['binary'],archive/'bin/model29-worker')
        atomic(runtime/'sync.json',dict(status='copied'))
    elif stage == 'verify-sync':
        archive = Path(config['archive'])
        checked = 0
        for directory in ('output','initial','frozen'):
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
