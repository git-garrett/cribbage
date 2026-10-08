"""Read-only progress for supervised analysis jobs; never scan result databases."""
from pathlib import Path
import time
from benchmark_workbench_assets import read_json, history_rows


def build_analysis_report(entry, status, now=None):
    now = time.time() if now is None else now
    settings = read_json(Path(entry['spec']), {})['analysisJob']
    root = Path(entry['root'])
    result = dict(id=entry['id'], kind='analysis', title=entry['title'],
                  target=settings['target'], asOf=now, state=status.get('state', 'unavailable'),
                  warnings=[], stages=status.get('stages', []))
    p = read_json(root / 'progress.json')
    if not p:
        return {**result, 'waiting': 'Waiting for the first analysis snapshot.'}
    if p.get('target') != settings['target']:
        raise ValueError('Analysis snapshot belongs to a different target')
    for key in ('completed', 'reused', 'workers', 'workerLimit', 'updatedAt', 'groups', 'etaBasis'):
        result[key] = p.get(key)
    result['fresh'] = 0 <= now - p.get('updatedAt', 0) < 90
    result['remainingSeconds'] = None
    stage = next((s['name'] for s in status.get('stages', []) if s.get('state') in ('running', 'failed')), '')
    result['stage'] = stage
    if result['state'] == 'running':
        if p.get('status') == 'complete':
            result['state'] = 'reporting'
        elif not result['fresh']:
            result['state'] = 'stale'
            result['warnings'].append('Analysis telemetry is stale; counts are the last saved snapshot and ETA is withheld.')
        else:
            result['remainingSeconds'] = p.get('remainingSeconds')
    result['history'] = history_rows(root / 'history.jsonl')
    return result
