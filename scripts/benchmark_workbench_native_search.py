"""Read native model-search receipts without opening weights or training rows."""
import json
from pathlib import Path
import time


def read(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def route_training_report(previous):
    def report(entry, status, now=None):
        settings = read(entry['spec'], {}).get('trainingStudy', {})
        if settings.get('mode') == 'native-search':
            return build_report(entry, status, settings, now)
        return previous(entry, status, now)
    return report


def points(folder, phase, offset=0):
    rows = []
    for path in sorted(folder.glob('round-*/report.json')):
        row = read(path, {})
        ev = row.get('evaluation', {})
        if row.get('status') != 'complete' or ev.get('status') != 'complete':
            continue
        rows.append(dict(round=row['round'], hours=offset + row['seconds'] / 3600,
                         winRate=ev['winRate'], paired95=ev['paired95'],
                         games=ev['pairs'] * 2, phase=phase))
    return rows


def candidate(folder):
    result = read(folder/'result.json', {})
    return dict(id=folder.name, config=result.get('config', {}),
                history=points(folder, 'Candidate testing'))


def latest_stage(status):
    return next((s for s in reversed(status.get('stages', []))
                 if s.get('state') in ('running', 'failed', 'stopped')), {})


def activity(root, model, status, cfg, now):
    stage = latest_stage(status).get('name', '')
    state = status.get('state', 'prepared')
    answer = dict(state=state, stage=stage, label='Waiting for its next training allocation',
                  gamesCompleted=None, gamesPlanned=None, checkpointAgeSeconds=None)
    if state != 'running':
        answer['label'] = 'Campaign ' + state
        return answer
    if not stage.startswith(f'train-{model}-'):
        answer['label'] = ('Candidate search or evaluation' if stage.endswith(f'-{model}')
                           else 'Waiting; campaign is running ' + stage)
        return answer
    seed = stage.split('-')[2]
    folder = root/f'train-{model}-seed-{seed}'
    rounds = sorted(folder.glob('round-*'))
    answer['label'] = f'Training seed {seed}: preparing next round'
    if not rounds:
        return answer
    work = rounds[-1]
    rid = int(work.name.split('-')[-1])
    answer['round'] = rid
    top = read(folder/'current.json', {})
    if (work/'report.json').exists():
        answer['label'] = f'Seed {seed}, round {rid}: archiving / preparing next round'
    elif top.get('committedRound') == rid:
        answer['label'] = f'Seed {seed}, round {rid}: evaluating frozen checkpoint'
    elif (work/'current.json').exists():
        answer['label'] = f'Seed {seed}, round {rid}: learning from completed games'
    else:
        target = cfg.get('gamesPerPhase', 0)
        batch = cfg.get('gameBatch', 16)
        total = 0
        for phase in ('explore', 'greedy'):
            for part in work.glob(phase+'-*/complete.json'):
                offset = int(part.parent.name.split('-')[-1])
                total += max(0, min(batch, target-offset))
        answer.update(label=f'Seed {seed}, round {rid}: self-play',
                      gamesCompleted=total, gamesPlanned=2*target)
    checkpoint = work/'current.json' if (work/'current.json').exists() else folder/'current.json'
    if checkpoint.exists():
        answer['checkpointAgeSeconds'] = max(0, now-checkpoint.stat().st_mtime)
    return answer


def build_report(entry, status, settings, now=None):
    now = time.time() if now is None else now
    root = Path(settings['campaignRoot'])
    model = settings['model']
    cfg = read(root/'campaign-config.json', {})
    winner = read(root/f'winner-{model}.json', {}).get('winner', {})
    contenders = [candidate(p) for p in sorted(root.glob(f'live-{model}-*')) if p.is_dir()]
    selected = next((c for c in contenders if c['config'] == winner.get('config') and c['history']), None)
    seeds = []
    for seed in (1, 2):
        source = winner if seed == 1 else read(root/f'confirm-{model}.json', {})
        initial = (selected['history'] if selected else []) if seed == 1 else points(root/f'confirm-{model}', 'Independent confirmation')
        elapsed = source.get('seconds', 0)/3600
        continued = points(root/f'train-{model}-seed-{seed}', 'Continued training', elapsed)
        best = read(root/f'train-{model}-seed-{seed}/best.json', {})
        seeds.append(dict(seed=seed, initializationSeed=source.get('config', {}).get('seed'),
                          history=initial+continued, continuationAtHours=elapsed if continued else None,
                          bestRound=best.get('round')))
    trials = []
    search = root/f'search-{model}'
    archive = read(search/'cold-archive.json', {}).get('archive')
    for folder in sorted([*search.glob('trial-*'), *search.glob('refine-*')]):
        history = []
        history_path = folder/'validation-history.jsonl'
        if not history_path.exists() and archive:
            history_path = Path(archive)/folder.name/'validation-history.jsonl'
        try:
            for line in history_path.read_text().splitlines():
                try:
                    value = json.loads(line)
                    history.append(dict(hours=value['seconds']/3600, loss=value['metric']))
                except (ValueError, KeyError):
                    continue  # A writer can be appending the final record.
        except OSError:
            pass
        spec = read(folder/'config.json', {})
        best = read(folder/'best-validation.json', {})
        current = read(folder/'current.json', {})
        selected_config = winner.get('config', {})
        matches = bool(selected_config) and all(spec.get(k) == selected_config.get(k)
                 for k in ('model', 'widths', 'rate', 'mixtures', 'auxiliary', 'seed'))
        trials.append(dict(id=folder.name, config=spec, history=history,
                           bestHours=best.get('seconds', 0)/3600, bestLoss=best.get('metric'),
                           earlyStopped=current.get('earlyStopped', False), selected=matches))
    pace = None
    allocations = list(root.glob(f'train-{model}-seed-*/round-*/allocation.json'))
    if allocations:
        path = max(allocations, key=lambda p: p.stat().st_mtime)
        seconds = read(path, {}).get('seconds', 0)
        if seconds > 0:
            pace = dict(gamesPerSecond=2*cfg.get('gamesPerPhase', 0)/seconds,
                        seconds=seconds, games=2*cfg.get('gamesPerPhase', 0),
                        run=path.parent.parent.name, round=int(path.parent.name.split('-')[-1]))
    return dict(id=entry['id'], kind='training', mode='native-search', title=entry['title'],
                state=status.get('state', 'prepared'), model=model, asOf=now, warnings=[], workflow=None,
                opponent='Frozen original Model 31', config=winner.get('config', {}),
                reference=settings.get('reference'), seeds=seeds, candidates=contenders,
                trials=trials, pace=pace, activity=activity(root, model, status, cfg, now))
