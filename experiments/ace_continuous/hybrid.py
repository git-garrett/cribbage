"""Durable handoff between Ace ingestion and bounded native self-play rounds."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import time
import signal


def read(path, default=None):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else default


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def latest32(root, ace_round):
    root = Path(root)
    pointer = read(root / 'hybrid-model32.json')
    if pointer is not None:
        assert pointer['aceRound'] == ace_round, 'Model 32 handoff is not committed'
        return Path(pointer['checkpoint'])
    return Path(read(root / 'model32' / f'model32-round-{ace_round}.json')['checkpoint'])


def publish32(root, ace_round, checkpoint, mode):
    save(Path(root) / 'hybrid-model32.json', dict(
        aceRound=ace_round, checkpoint=str(checkpoint), mode=mode, updatedAt=time.time()))


def pending(root):
    return read(Path(root) / 'hybrid-state.json', {}).get('active')


def begin(root, training_state):
    root = Path(root)
    path = root / 'hybrid-state.json'
    state = read(path, dict(nextModel=31, sequences={'31': 0, '32': 0}, active=None))
    if state['active'] is not None:
        return state['active']
    model = state['nextModel']
    key = str(model)
    sequence = state['sequences'][key] + 1
    folder = root / 'hybrid' / f'model{model}' / f'{sequence:08d}'
    state['active'] = dict(model=model, sequence=sequence, folder=str(folder),
                           aceRound=training_state[key]['round'], cursors=training_state[key]['cursors'])
    save(path, state)
    return state['active']


def finish(root, active):
    root = Path(root)
    result = read(Path(active['folder']) / 'receipt.json')
    assert result['status'] == 'complete' and result['identity'] == active
    assert result['cursors'] == active['cursors'], 'Self-play must not consume Ace labels'
    state = read(root / 'hybrid-state.json')
    assert state['active'] == active
    state['sequences'][str(active['model'])] = active['sequence']
    state['nextModel'] = 32 if active['model'] == 31 else 31
    state['active'] = None
    state['last'] = result
    save(root / 'hybrid-progress.json', result)
    save(root / 'hybrid-state.json', state)


def worker_limit(samples, cpu_count):
    """Leave one core for the UI/GPU driver; memory and heat take priority."""
    latest = samples[-1]
    if latest['pressure'] >= 4 or latest['thermal'] >= 2:
        return 0
    recent = [s for s in samples if s['time'] >= latest['time'] - 30]
    if latest['Swapouts'] - recent[0]['Swapouts'] > 64 * 2**20:
        return min(2, max(1, cpu_count - 1))
    if latest['pressure'] != 1 or any(s['pressure'] != 1 for s in recent[-8:]):
        return min(4, max(1, cpu_count - 1))
    return max(1, cpu_count - 1)


@contextmanager
def reserve_workers(ledger, prefix, maximum, cpu_count):
    """Claim the current batch atomically after any memory/thermal wait."""
    ledger = Path(ledger)
    keys = []
    def interrupted(*_):
        raise InterruptedError('Collector interrupted; CPU claims released')
    previous = signal.signal(signal.SIGTERM, interrupted)
    try:
        with ledger.with_suffix('.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            data = read(ledger)
            assert data['workers'] == sum(data['allocations'].values())
            count = max(0, min(maximum, max(1, cpu_count - 1) - data['workers']))
            proposed = [f'{prefix}-{i}' for i in range(count)]
            assert not any(key in data['allocations'] for key in proposed), 'Collector reservations already owned'
            for key in proposed:
                data['allocations'][key] = 1
            data.update(workers=sum(data['allocations'].values()), updatedAt=time.time())
            save(ledger, data)
            keys = proposed
        yield count
    finally:
        try:
            if keys:
                with ledger.with_suffix('.lock').open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    data = read(ledger)
                    for key in keys:
                        assert data['allocations'].get(key) == 1, 'Collector reservation ownership changed'
                        del data['allocations'][key]
                    data.update(workers=sum(data['allocations'].values()), updatedAt=time.time())
                    save(ledger, data)
        finally:
            signal.signal(signal.SIGTERM, previous)


def native_worker_limit(call, maximum):
    """Negotiate with old/new teacher binaries using empty, non-learning calls."""
    low, high = 0, maximum
    while low < high:
        probe = (low + high + 1) // 2
        try:
            result = call(dict(kind='teach', workers=probe, ids=[]))
        except RuntimeError as error:
            if 'invalid teacher workers' not in str(error):
                raise
            high = probe - 1
        else:
            assert result['labels'] == []
            low = probe
    assert low > 0, 'Native teacher accepts no CPU workers'
    return low
