"""Verify and sync after a controlled stop."""
import hashlib
from hybrid import latest32
import json
from pathlib import Path
import shutil
import sqlite3
import sys

root = Path(__file__).resolve().parent
name, stage = sys.argv[1:]
cfg = json.loads((root / "config.json").read_text())
archive = Path(cfg["archive"])
teacher = root / "teacher"
is_collector = name == "ace-label-production"

def read(p):
    return json.loads(p.read_text())

def save(p, data):
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(p)

def digest(p):
    with p.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def checkpoints():
    m31, m32 = root / "model31", root / "model32"
    state = read(root / "gpu-state.json")
    p31 = m31 / "data" / read(m31 / "data/current.json")["folder"]
    p32 = latest32(root, state["32"]["round"])
    return p31, p32

if stage == "verify":
    if is_collector:
        with sqlite3.connect(teacher / "labels.sqlite") as db:
            assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            assert db.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
            total = db.execute("SELECT MAX(rowid) FROM labels").fetchone()[0]
        save(root / f"{name}-verify.json", dict(status="complete", labelHighWater=total))
    else:
        p31, p32 = checkpoints()
        state = read(root / "gpu-state.json")
        assert read(p31 / "ace-teacher-state.json")["cursor"] == state["31"]["cursors"]
        assert read(p32 / "checkpoint.json")["teacherCursor"] == state["32"]["cursors"]
        save(root / f"{name}-verify.json", dict(status="complete", model31=str(p31), doubled32=str(p32), state=state))
elif stage == "report":
    save(root / f"{name}-report.json", read(root / f"{name}-verify.json"))
elif stage == "sync":
    archive.mkdir(parents=True, exist_ok=True)
    files = [root / f"{name}.json", root / f"{name}-report.json", root / "config.json"]
    if is_collector:
        files.extend([teacher / "plan.json", teacher / "labels.sqlite"])
    else:
        files.extend([root / "gpu-state.json", *(p for folder in checkpoints() for p in folder.iterdir() if p.is_file())])
    for path in files:
        dest = archive / name / path.relative_to(root)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".copy")
        shutil.copy2(path, tmp)
        assert digest(path) == digest(tmp)
        tmp.replace(dest)
    save(archive / f"{name}-sync.json", dict(status="complete", files=len(files)))
else:
    raise ValueError(stage)
