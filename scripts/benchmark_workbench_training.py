"""Read saved training receipts, never datasets, weights or worker databases."""
from pathlib import Path
import re
import time

from benchmark_workbench_assets import read_json


def curve(rows):
    return [dict(epoch=r['epoch'], seconds=r.get('seconds'),
                 **r.get('validation', {}).get('28.3', {})) for r in rows]


def trial_summary(row):
    keys = ('id', 'mode', 'positions', 'hidden', 'seed', 'parameters',
            'chosenEpoch', 'lastEpoch', 'seconds')
    return {**{k: row.get(k) for k in keys},
            'validation': row.get('validation', {}).get('28.3', {}),
            'history': curve(row.get('history', []))}


def build_training_report(entry, status, now=None):
    now = time.time() if now is None else now
    settings = read_json(Path(entry['spec']), {})['trainingStudy']
    root = Path(entry['root'])
    data = read_json(root / 'data.json', {})
    fits = read_json(root / 'fit-progress.json', {})
    active = read_json(root / 'training-progress.json', {})
    completed_fits = read_json(root / 'fit.json', {})
    # Test results are produced only after validation has frozen model selection.
    results = read_json(root / 'results.json', {})
    trials = [trial_summary(r) for r in completed_fits.get('trials', [])]
    if not trials:
        trials = [trial_summary(r) for p in sorted((root / 'students').glob('*/result.json'))
                  if (r := read_json(p, {})).get('status') == 'complete']
    tests = {r['id']: r for r in results.get('trials', [])}
    for trial in trials:
        test = tests.get(trial['id'], {})
        trial['test'] = test.get('test', {}).get('28.3', {})
        trial['test95'] = test.get('natural283Agreement95')
    trials.sort(key=lambda r: (r['parameters'], r['mode'], r['positions'], r['seed']))
    target = settings['target']
    if fits.get('target', target) != target or len(trials) > target:
        raise ValueError('Training snapshot belongs to a different study target')
    preferred = completed_fits.get('preferredByValidation')
    if not preferred and trials:
        preferred = min(trials, key=lambda r: r['validation'].get('crossEntropy', float('inf')))['id']
    stage_states = {s['name']: s for s in status.get('stages', [])}
    stages = [dict(name=name, state=stage_states.get(name, {}).get('state', 'pending'))
              for name in settings.get('stages', [])]
    stage = next((s['name'] for s in stages if s['state'] in ('running', 'failed')), '')
    state = status.get('state', 'prepared')
    # The final progress receipt still names the last fit during later stages.
    current = None
    trial_id = active.get('trial', '')
    match = re.fullmatch(r'(broad|target-only|fine-tuned)-(\d+)x(\d+)-n(\d+)-s(\d+)', trial_id)
    if stage == 'fit' and state == 'running' and match and trial_id not in {r['id'] for r in trials}:
        checkpoint = read_json(root / 'students' / trial_id / 'checkpoint.json', {})
        hidden = [int(match[2]), int(match[3])]
        parameters = next((a['parameters'] for a in settings.get('architectures', [])
                           if a['hidden'] == hidden), None)
        current = dict(id=trial_id, mode=match[1], hidden=hidden, positions=int(match[4]),
                       parameters=parameters, epoch=active.get('epoch'), bestEpoch=active.get('bestEpoch'),
                       updatedAt=active.get('updatedAt'), seconds=active.get('seconds'),
                       gpuPeakBytes=active.get('gpuPeakBytes'), validation=active.get('natural283', {}),
                       history=curve([r for r in checkpoint.get('history', [])
                                      if r['epoch'] <= (active.get('epoch') or 0)]))
    warnings = []
    if current and now - (current['updatedAt'] or 0) > settings.get('staleAfterSeconds', 600):
        warnings.append('No new epoch receipt in over ten minutes. Showing the last saved training metrics.')
    speed = read_json(root / 'speed.json', {})
    return dict(id=entry['id'], kind='training', title=entry['title'], state=state,
                asOf=now, target=target, completed=len(trials), current=current,
                maxEpochs=settings.get('maxEpochs'), precision=settings.get('precision', 'FP32'),
                stages=stages, stage=stage, trials=trials, preferred=preferred,
                selectionFrozen=bool(completed_fits.get('preferredByValidation')),
                testAvailable=results.get('status') == 'complete',
                data={k: data.get(k) for k in ('decisions', 'games', 'splits', 'teachers')},
                speed=speed, frontier=read_json(root / 'frontier.json', {}),
                verification=read_json(root / 'verification.json', {}).get('status', 'pending'),
                archive=read_json(root / 'sync-receipt.json', {}).get('status', 'pending'),
                playingStrengthMeasured=False, fullGameThroughputMeasured=False, warnings=warnings)
