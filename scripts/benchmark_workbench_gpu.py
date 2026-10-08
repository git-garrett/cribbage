"""Read-only GPU build telemetry; the UI never opens worker result databases."""
from pathlib import Path
import math
import time

from benchmark_workbench_assets import history_rows, read_json


def build_gpu_report(entry, status, now=None):
    now = time.time() if now is None else now
    settings = read_json(Path(entry['spec']), {})['gpuBuild']
    root = Path(entry['root'])
    result = dict(id=entry['id'], kind='gpu', title=entry['title'], target=settings['target'],
                  unit=settings.get('unit', 'decisions'), scope=settings.get('scope', ''),
                  policy=settings['policy'], asOf=now, state=status.get('state', 'unavailable'),
                  warnings=[], stages=status.get('stages', []))
    progress = read_json(root / 'progress.json')
    if not progress:
        return {**result, 'state': status.get('state', 'prepared'),
                'stage': 'Waiting for the first GPU build checkpoint',
                'completed': 0, 'updatedAt': None, 'fresh': False,
                'ratePerSecond': None, 'remainingSeconds': None, 'history': [],
                'priorityCompleted': 0, 'priorityTarget': settings.get('priorityTarget'),
                'priorityCoverage': settings.get('priorityCoverage'),
                'handTarget': settings.get('handTarget'), 'scoreCells': settings.get('scoreCells'),
                'gpuCommandDuty': settings.get('gpuCommandDuty'),
                'verification': 'pending', 'archive': 'pending'}
    if progress.get('target') != settings['target']:
        raise ValueError('GPU snapshot belongs to a different build target')
    completed = progress.get('completed')
    if type(completed) is not int or not 0 <= completed <= result['target']:
        raise ValueError('Invalid GPU completion count')
    for key in ('completed', 'updatedAt', 'workers', 'workerLimit', 'gpuSeconds',
                'elapsedSeconds', 'ratePerSecond', 'completedHands', 'handTarget',
                'scoreCells', 'backend', 'etaBasis', 'gpuCommandDuty'):
        result[key] = progress.get(key)
    for key in ('priorityCompleted', 'priorityTarget', 'priorityCoverage'):
        result[key] = progress.get(key)
    rate = result['ratePerSecond']
    if rate is not None and (not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate < 0):
        raise ValueError('Invalid GPU throughput')
    result['fresh'] = 0 <= now - (progress.get('updatedAt') or 0) < 90
    result['remainingSeconds'] = None
    result['stage'] = next((s['name'] for s in status.get('stages', []) if s.get('state') in ('running', 'failed')), '')
    if result['state'] == 'running':
        if completed == result['target']:
            result['state'] = 'archiving' if result['stage'] in ('archive', 'sync') else 'verifying'
        elif not result['fresh']:
            result['state'] = 'stale'
            result['warnings'].append('GPU telemetry is stale. Saved counts remain visible; throughput and ETA are withheld.')
        elif progress.get('status') == 'waiting':
            result['state'] = 'waiting'
        elif rate:
            seconds = progress.get('remainingSeconds')
            if seconds is not None and (not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds < 0):
                raise ValueError('Invalid GPU remaining time')
            result['remainingSeconds'] = seconds
    if result['state'] not in ('running', 'complete'):
        result['ratePerSecond'] = None
    result['history'] = history_rows(root / 'history.jsonl')
    for name in ('verification', 'archive'):
        receipt = read_json(root / (name + '-verified.json'), {})
        result[name] = receipt.get('status', 'pending')
    return result
