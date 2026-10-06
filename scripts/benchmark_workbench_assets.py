"""Small, read-only asset-build snapshots. Never scan shards or the live queue."""
import json
import math
from pathlib import Path
import time


def read_json(path, default=None):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else default
    except (OSError, ValueError):
        return default


def history_rows(path):
    try:
        with path.open('rb') as stream:
            size = stream.seek(0, 2)
            stream.seek(max(0, size - 32 * 1024**2))
            if stream.tell(): stream.readline()
            lines = stream.read().splitlines()
    except OSError:
        return []
    rows = []
    # At most 500 plotted observations, including both ends. A trailing partial
    # append is ignored; it is not evidence of a failed build.
    step = max(1, math.ceil(len(lines) / 499))
    indices = sorted(set(range(0, len(lines), step)) | {len(lines)-1})
    for i in indices:
        if i < 0: continue
        try:
            row = json.loads(lines[i])
            if isinstance(row.get('updatedAt'), (int, float)) and isinstance(row.get('completed'), int):
                rows.append({key: row.get(key) for key in ('updatedAt', 'completed', 'chunksPerHour', 'segmentStartedAt', 'status')})
        except (ValueError, AttributeError):
            continue
    return rows


def build_asset_report(entry, status, now=None):
    now = time.time() if now is None else now
    spec = read_json(Path(entry['spec']), {})
    settings = spec['assetBuild']
    root = Path(entry['root'])
    target = settings['target']
    result = dict(id=entry['id'], kind='asset', title=settings.get('title', 'Opening assets'),
                  target=target, policy=settings['policy'], state=status.get('state', 'unavailable'),
                  asOf=now, warnings=[], stages=status.get('stages', []))
    p = read_json(root / 'progress.json')
    if not p:
        return {**result, 'waiting': 'Waiting for the first asset-build snapshot.'}
    for key in ('completed', 'contiguousCompleted', 'published', 'fullBytes', 'shallowBytes',
                'workers', 'workerLimit', 'diskFreeBytes', 'diskReserveBytes', 'chunksPerHour',
                'updatedAt', 'scheduling', 'etaBasis'):
        result[key] = p.get(key)
    fresh = 0 <= now - p.get('updatedAt', 0) < 90 and p.get('total') == target
    result['fresh'] = fresh
    result['snapshotAgeSeconds'] = max(0, now-p.get('updatedAt', 0))
    if result['state'] == 'running':
        stage = next((s.get('name', '') for s in status.get('stages', []) if s.get('state') == 'running'), '')
        if p.get('status') == 'complete' and p.get('total') == target:
            result['state'] = 'waiting_for_archive' if stage == 'await-durable-archive' else 'verifying'
        else:
            result['state'] = p.get('status', 'running') if fresh else 'stale'
    if not fresh and (result['state'] == 'stale' or p.get('total') != target):
        result['warnings'].append('Build telemetry is stale or belongs to the previous target. Counts are the last saved snapshot; ETA is withheld.')
    rate = p.get('chunksPerHour')
    active = fresh and result['state'] == 'running' and rate is not None and rate > 0
    result['remainingSeconds'] = max(0, target-p['completed']) / rate * 3600 if active else None
    result['milestones'] = [dict(chunks=n, seconds=(n-p['completed']) / rate * 3600 if active else None)
                            for n in sorted({min(target, (p['completed']//step+1)*step) for step in (10000, 100000)} | {target})]
    result['history'] = history_rows(root / 'history.jsonl')
    coverage = read_json(root / 'coverage.json', {})
    if coverage.get('rankingSha256') == settings.get('rankingSha256') and coverage.get('policy') == settings['policy']:
        curve = [r for r in coverage.get('curve', []) if r['chunks'] <= target]
        prefix = p.get('contiguousCompleted', 0)
        covered = [r for r in curve if r['chunks'] <= prefix]
        result['coverage'] = dict(curve=curve, current=covered[-1] if covered else None,
                                  target=next((r for r in curve if r['chunks'] == target), None),
                                  samples=coverage.get('samples'), basis=coverage.get('basis'))
    else:
        result['coverage'] = None
    archive = read_json(root / 'archive-progress.json', {})
    result['archive'] = ({key: archive.get(key) for key in ('completed', 'bytes', 'updatedAt', 'location', 'releasedBytes')}
                         if archive.get('policy') == settings['policy'] else None)
    result['archivePending'] = max(0, p['completed']-archive['completed']) if result['archive'] else None
    result['storageWaitHours'] = None
    if active and p['completed'] > 0 and p.get('diskFreeBytes') is not None:
        mean_bytes = (p.get('fullBytes', 0)+p.get('shallowBytes', 0))/p['completed']
        if mean_bytes:
            result['storageWaitHours'] = max(0, p['diskFreeBytes']-p.get('diskReserveBytes', 0))/mean_bytes/rate
    return result
