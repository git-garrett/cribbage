"""Continue the verified Ace replay corpus with a single SQLite writer."""
from collections import deque
from hybrid import worker_limit, reserve_workers, native_worker_limit
import gzip
import json
import os
from pathlib import Path
import shutil
import sys
import time

root = Path(__file__).resolve().parent
teacher = root / "teacher"
sys.path.insert(0, str(teacher / "source"))
from teacher_pipeline import database, digest, read, replay, save
from resources import LEDGER

plan = read(teacher / "plan.json")
os.environ["CRIBBAGE_RUST_MODEL_ROOT"] = plan["assetRoot"]
os.environ["CRIBBAGE_283_FAST_ASSET"] = plan["openingAssetPath"]
from capacity import MacTelemetry, pressure_limit_reason
from dataset import Native

STOP = root / "STOP-COLLECT"
MIB = 2**20

class Capacity:
    def __init__(self):
        self.telemetry = MacTelemetry()
        self.samples = deque(maxlen=32)
        self.backend_workers = max(1, (os.cpu_count() or 12) - 1)

    def sample(self):
        if not self.samples or time.time() - self.samples[-1]["time"] >= 2:
            self.samples.append(self.telemetry.sample())
        return self.samples[-1]

    def workers(self):
        latest = self.sample()
        while pressure_limit_reason(list(self.samples)) or latest["pressure"] >= 4 or latest["thermal"] >= 2:
            if STOP.exists():
                raise InterruptedError("Collection stop requested")
            time.sleep(3)
            latest = self.sample()
        return min(self.backend_workers, worker_limit(list(self.samples), os.cpu_count() or 12))

class AdaptiveTeacher(Native):
    def __init__(self, capacity):
        super().__init__(teacher / "teacher-env")
        self.capacity = capacity
        self.capacity.backend_workers = native_worker_limit(super().call, max(1, (os.cpu_count() or 12) - 1))

    def call(self, value):
        if value["kind"] == "teach":
            value = dict(value, workers=min(value["workers"], self.capacity.workers()))
        return super().call(value)

def archive_sources():
    archive = Path(plan["archiveSource"])
    preferred = plan["firstSource"]
    arm, cycle = preferred.split("/")
    preferred_origin = archive / "arms" / arm / "cycles" / cycle
    if (teacher / (preferred.replace("/", "-") + ".jsonl.gz")).exists():
        yield preferred_origin, plan["firstSourceDigest"], plan["firstSourceGames"]
    paths = list(archive.glob("arms/size-0004-*/cycles/*/archive-manifest.json"))
    for path in sorted(paths, key=lambda p: (source_key(p.parent) == preferred, p.parent.name), reverse=True):
        origin = path.parent
        config = read(origin / "config.json")
        expected = read(path).get("games/round-1.jsonl.gz")
        if config.get("sizeKind") == "train" and config.get("model") == "31.0" and expected:
            yield origin, expected, config["gamesPerRound"]

def source_key(origin):
    return f"{origin.parent.parent.name}/{origin.name}"

def next_source(db):
    for origin, expected, count in archive_sources():
        source = source_key(origin)
        done = {int(key.rsplit(":", 1)[1]) for (key,) in db.execute(
            "SELECT key FROM batches WHERE key LIKE ?", (source + ":%",))}
        pending = [i for i in range(0, count, 32) if i not in done]
        if pending:
            return origin, expected, count, pending
    return None

def freeze(origin, expected):
    path = teacher / (source_key(origin).replace("/", "-") + ".jsonl.gz")
    if not path.exists():
        temp = path.with_suffix(".copy")
        shutil.copyfile(origin / "games/round-1.jsonl.gz", temp)
        assert digest(temp) == expected
        temp.replace(path)
    else:
        assert digest(path) == expected
    return path

def collect_block(db, native, capacity, source, offset, games):
    labels = 0
    index = 0
    while index < len(games) and not STOP.exists():
        key = f"{source}:{offset + index}"
        prior = db.execute("SELECT games,labels FROM resumed_chunks WHERE key=?", (key,)).fetchone()
        if prior:
            index += prior[0]
            labels += prior[1]
            continue
        if shutil.disk_usage(root).free < 5 * 2**30:
            raise RuntimeError("Internal storage reserve reached")
        # Capacity may wait for pressure to clear. Recheck and claim the whole
        # currently available CPU budget under the shared lock afterward.
        budget = min(capacity.workers(), len(games) - index)
        with reserve_workers(LEDGER, f'{root.name}-ace', budget, os.cpu_count() or 12) as workers:
            if workers < 1:
                time.sleep(5)
                continue
            size = min(max(4, workers), len(games) - index)
            began = time.monotonic()
            save(teacher / "live.json", dict(status="collecting", source=source, game=offset + index,
                 workers=workers, chunkGames=size, labelHighWater=db.execute("SELECT MAX(rowid) FROM labels").fetchone()[0]))
            try:
                rows = replay(native, games[index:index + size], source, plan["teacherIdentity"], workers)
            except InterruptedError:
                if STOP.exists():
                    return
                raise
        latest = capacity.sample()
        with db:
            before = db.execute("SELECT MAX(rowid) FROM labels").fetchone()[0]
            db.executemany("INSERT INTO labels VALUES (?,?,?,?)", [
                (x["key"], x["role"], x["split"], json.dumps(x, separators=(",", ":"))) for x in rows])
            end = db.execute("SELECT MAX(rowid) FROM labels").fetchone()[0]
            assert end - before == len(rows) > 0
            seconds = time.monotonic() - began
            db.execute("INSERT INTO resumed_chunks (key,first_row,last_row,labels,games,workers,healthy,seconds) VALUES (?,?,?,?,?,?,?,?)",
                       (key, before + 1, end, len(rows), size, workers, int(latest["pressure"] == 1), seconds))
        index += size
        labels += len(rows)
        save(teacher / "progress.json", dict(source=source, gamesThrough=offset + index, workers=workers,
             chunkGames=size, chunkLabels=len(rows), seconds=seconds, labelHighWater=end,
             newLabels=end - plan["initialHighWater"], pressure=latest["pressure"], swapUsedMiB=latest["swapUsedMiB"]))
    if index == len(games):
        with db:
            db.execute("INSERT INTO batches VALUES (?,?)", (f"{source}:{offset}", labels))

def run():
    assert digest(teacher / "teacher-env") == plan["teacherBinarySha256"]
    db = database(teacher / "labels.sqlite")
    capacity = Capacity()
    native = AdaptiveTeacher(capacity)
    try:
        while not STOP.exists():
            selected = next_source(db)
            if selected is None:
                save(teacher / "live.json", dict(status="waiting for verified game traces", workers=0))
                time.sleep(15)
                continue
            origin, expected, count, pending = selected
            path = freeze(origin, expected)
            at = 0
            with gzip.open(path, "rt") as stream:
                for offset in pending:
                    if STOP.exists():
                        break
                    for _ in range(offset - at):
                        next(stream)
                    games = [json.loads(next(stream)) for _ in range(min(32, count - offset))]
                    at = offset + len(games)
                    collect_block(db, native, capacity, source_key(origin), offset, games)
            if not STOP.exists():
                path.unlink()
    finally:
        native.close()
        db.close()
    save(teacher / "stopped.json", dict(status="complete"))

if __name__ == "__main__":
    run()
