"""Fresh seed ranges, recorded once and reused only when resuming that run."""
import fcntl, json, secrets, subprocess
from pathlib import Path
from learning import atomic

LIMIT = 1 << 32


def recorded(repo):
    """Read retained benchmark metadata and inherited validation exclusions."""
    root = Path(repo)
    git = subprocess.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], cwd=root,
                         capture_output=True, text=True)
    if git.returncode == 0:
        root = Path(git.stdout.strip()).parent
    paths = []
    if (root / 'benchmarks').exists():
        found = subprocess.run(['rg', '--files', str(root / 'benchmarks'), '-g', '*config*.json',
                                '-g', '*manifest*.json', '-g', '*status*.json', '-g', '*seed*.json'],
                               capture_output=True, text=True, check=False)
        if found.returncode not in (0, 1):
            raise ValueError('could not inspect recorded benchmark seed ranges')
        paths += [Path(p) for p in found.stdout.splitlines()]
    paths += list(Path('/private/tmp').glob('model30-*/config.json'))
    paths += list(Path('/private/tmp').glob('cribbage-*/config.json'))
    paths += list((Path(repo) / 'training').glob('*reserved*seeds.json'))
    ranges = []; files = 0

    def add(value, span):
        try: start = int(value) % LIMIT
        except (ValueError, TypeError): return
        end = start + min(int(span), LIMIT) - 1
        ranges.append((start, min(end, LIMIT - 1)))
        if end >= LIMIT: ranges.append((0, end % LIMIT))

    def visit(value, span=100000):
        if isinstance(value, dict):
            reservations=value.get('seedReservation',value)
            if isinstance(reservations,dict) and isinstance(reservations.get('ranges'),dict):
                for interval in reservations['ranges'].values():
                    if isinstance(interval,list) and len(interval)==2 and all(type(v)is int for v in interval) and 0<=interval[0]<=interval[1]<LIMIT:
                        ranges.append(tuple(interval))
            if type(value.get('generations')) is int:
                span=max(span,(value['generations']-1)*100000+max(value.get('trainingGames',0),value.get('evaluationPairs',0)))
            count = [v for k, v in value.items() if k.lower() in ('games', 'totalgames', 'pairs', 'plannedgames', 'evaluationpairs') and type(v) is int and v > 0]
            span = max(span,max(count)) if count else span
            for key, child in value.items():
                if key.lower().replace('_', '') in ('seed', 'baseseed', 'seedbase', 'randomseed', 'evaluationseed', 'trainingseed', 'parityseed'):
                    add(child, span)
                elif key.lower().replace('_', '') == 'reservedvalidationseeds' and isinstance(child, list):
                    for seed in child: add(seed, 1)
                else: visit(child, span)
        elif isinstance(value, list):
            for child in value: visit(child, span)

    for path in sorted(set(paths)):
        # Runtime source/asset payloads are not benchmark configuration files.
        if any(p in ('inputs', 'source', 'node_modules', 'target') for p in path.parts): continue
        if path.stat().st_size > 8 * 1024 * 1024: continue
        try: value = json.loads(path.read_text())
        except (ValueError, UnicodeError): continue
        files += 1
        if 'reserved' in path.name and 'seed' in path.name and isinstance(value, list):
            for seed in value: add(seed, 1)
        else: visit(value)
    return ranges, files


def reserve(repo, output, generations=2, exclusions=None):
    span = generations * 100000
    if not 0 < span < LIMIT // 3: raise ValueError('seed reservation too large; use fewer generations')
    shared = Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes/coordination/model29-seed-reservations.json')
    shared.parent.mkdir(parents=True,exist_ok=True)
    with shared.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = json.loads(shared.read_text()) if shared.exists() else []
        blocked, files = recorded(repo) if exclusions is None else (list(map(tuple,exclusions)),0)
        for row in old:
            blocked.extend(tuple(v) for v in row['ranges'].values())
        ranges = {}
        for name, size in [('training', span), ('evaluation', span), ('parity', 2)]:
            for _ in range(10000):
                start = secrets.randbelow(LIMIT - size + 1); end = start + size - 1
                if all(end < low or start > high for low, high in blocked): break
            else: raise ValueError('could not reserve an unused seed range')
            ranges[name] = [start, end]; blocked.append((start, end))
        reservation = dict(output=str(output), ranges=ranges, metadataFilesChecked=files)
        atomic(shared, old + [reservation])
        atomic(Path(output) / 'seed-reservation.json', reservation)
        return reservation
