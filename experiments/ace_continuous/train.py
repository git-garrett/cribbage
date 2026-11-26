"""Feed each GPU trainer its own cursor range and publish resumable checkpoints."""
import hashlib
import json
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import time

root = Path(__file__).resolve().parent
models = {31: root / "model31", 32: root / "model32"}
sys.path.insert(0, str(models[31] / "source"))
from scaling_data import save
from checkpoints import maybe_checkpoint
from hybrid import begin, finish, pending, publish32

def read(path):
    return json.loads(path.read_text())

def rows(db, cursor, limit):
    for role, last in enumerate(cursor):
        yield from db.execute("SELECT rowid,payload FROM labels WHERE role=? AND split=0 AND rowid>? ORDER BY rowid LIMIT ?", (role, last, limit))

def selection31(number):
    return models[31] / "data" / f"labels-{number}.json"

def prepare_selection(model, number, db, cursor):
    path = selection31(number)
    if model == 31 and path.exists():
        checksum = path.with_suffix(".sha256.json")
        if not checksum.exists():
            save(checksum, {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        return True

    selected = list(rows(db, cursor, batch["labelsPerRole"]))
    if len(selected) < batch["minimumLabels"]:
        return False
    if model == 31:
        labels = [dict(json.loads(payload), rowId=row_id) for row_id, payload in selected]
        assert all(x["split"] == 0 and x["teacherIdentity"] == config["teacherIdentity"] and x["action"] in x["legal"] for x in labels)
        save(path, {"rows": labels})
        save(path.with_suffix(".sha256.json"), {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    return True

def receipt(model, number):
    prefix = "round" if model == 31 else "model32-round"
    return models[model] / f"{prefix}-{number}.json"

child = None
stop_signal = None

def forward_stop(signum, _frame):
    global stop_signal
    stop_signal = signum
    if child is not None and child.poll() is None:
        child.send_signal(signum)

signal.signal(signal.SIGTERM, forward_stop)
signal.signal(signal.SIGINT, forward_stop)


def checkpoint_command(command):
    global child
    child = subprocess.Popen(command)
    if stop_signal is not None and child.poll() is None:
        child.send_signal(stop_signal)
    code = child.wait()
    child = None
    if stop_signal is not None:
        raise SystemExit(128 + stop_signal)
    return code


def update(model, number):
    global child
    path = receipt(model, number)
    if not path.exists():
        save(root / "gpu-live.json", dict(status="training", model=model, round=number, batchPolicy=batch))
        command = [sys.executable, str(models[model] / "train.py"), str(models[model]), str(number)]
        child = subprocess.Popen(command)
        if stop_signal is not None and child.poll() is None:
            child.send_signal(stop_signal)
        result = child.wait()
        child = None
        if stop_signal is not None:
            raise SystemExit(128 + stop_signal)
        if result:
            raise subprocess.CalledProcessError(result, command)
    result = read(path)
    assert result["status"] == "complete"
    return result

def prune(model, current):
    data = models[model] / ("data" if model == 31 else "data/model32")
    if model == 31:
        for suffix in (".json", ".sha256.json"):
            (data / f"labels-{current-2}{suffix}").unlink(missing_ok=True)
    else:
        for number in range(config["start32"] + 1, current - 1):
            candidate = data / f"round-{number}"
            if candidate.is_dir():
                shutil.rmtree(candidate)
            (data / f"labels-{number}.json").unlink(missing_ok=True)

def self_play(state):
    active = begin(root, state)
    save(root / 'gpu-live.json', dict(status='self-play while Ace labels accumulate', **active))
    command = [sys.executable, str(root / 'selfplay.py'), str(root)]
    pause = Path(active['folder']) / 'resource-pause.json'
    pause.unlink(missing_ok=True)
    code = checkpoint_command(command)
    if code == 75 and pause.exists() and read(pause)['identity'] == active:
        save(root / 'gpu-live.json', dict(status='self-play waiting for system resources', **active))
        time.sleep(15)
        return
    if code == 76 and (root / 'STOP-TRAIN').exists():
        return
    if code:
        raise subprocess.CalledProcessError(code, command)
    finish(root, active)

config = read(root / "config.json")
batch = config["trainingBatch"]
state_path = root / "gpu-state.json"
state = read(state_path) if state_path.exists() else {
    "31": {"round": config["start31"], "cursors": config["cursors31"]},
    "32": {"round": config["start32"], "cursors": config["cursors32"]},
}
if not state_path.exists():
    save(state_path, state)
with sqlite3.connect((root / "teacher/labels.sqlite").as_uri() + "?mode=ro", uri=True, timeout=10) as db:
    while stop_signal is None and not (root / "STOP-TRAIN").exists():
        if pending(root):
            self_play(state)
            continue
        settled31 = read(models[31] / 'data/current.json').get('round') == state['31']['round']
        pending32 = models[32] / 'data/model32' / f'round-{state["32"]["round"]+1}' / 'current.json'
        if settled31 and not pending32.exists():
            maybe_checkpoint(root, state, checkpoint_command)
        worked = False
        for model in (32, 31):
            if stop_signal is not None or (root / "STOP-TRAIN").exists():
                break
            key = str(model)
            prior = state[key]
            number = prior["round"] + 1
            work32 = models[32] / "data/model32" / f"round-{number}" / "current.json"
            available = receipt(model, number).exists() or (model == 32 and work32.exists())
            if not available:
                available = prepare_selection(model, number, db, prior["cursors"])
            if not available:
                continue
            result = update(model, number)
            assert all(new >= old for old, new in zip(prior["cursors"], result["cursors"]))
            state[key] = {"round": number, "cursors": result["cursors"],
                          "labels": result.get("trainableLabels", result.get("labelsConsumed"))}
            if model == 32:
                publish32(root, number, result['checkpoint'], 'ace')
            save(state_path, state)
            prune(model, number)
            worked = True
        if stop_signal is None and not (root / "STOP-TRAIN").exists():
            maybe_checkpoint(root, state, checkpoint_command)
        if not worked and not (root / "STOP-TRAIN").exists():
            if config.get('selfPlay', {}).get('enabled'):
                self_play(state)
            else:
                save(root / "gpu-live.json", dict(status="waiting for training labels", batchPolicy=batch))
                time.sleep(10)
if stop_signal is not None:
    raise SystemExit(128 + stop_signal)
save(root / "gpu-stopped.json", dict(status="complete"))
