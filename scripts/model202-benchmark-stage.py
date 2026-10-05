#!/usr/bin/env python3
"""Ordered, checked stages for the frozen Model 20.2 versus 20.0 experiment."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    root = Path(sys.argv[1]).resolve()
    mode = sys.argv[2]
    cfg = json.loads((root / "experiment.json").read_text())
    source = root / "source"
    out = Path(cfg["outputRoot"])
    runner = root / "bin/cribbage-runner"
    frozen = root / "bin/model200-decision-worker"

    def verify_inputs():
        record = json.loads((root / "frozen-inputs.json").read_text())
        for name, expected in record["files"].items():
            if sha(root / name) != expected:
                raise RuntimeError("frozen input changed: " + name)
        return record

    env = os.environ.copy()
    env.update({
        "BENCH_MODEL_ROOT": str(source), "OUT_DIR": str(out), "RUNNER": str(runner),
        "SOURCE_COMMIT": cfg["sourceCommit"], "SEED": cfg["seedHex"],
        "WORKERS": str(cfg["workersPerOrientation"]),
        "GAMES_PER_ORIENTATION": str(cfg["gamesPerOrientation"]),
        "FROZEN_ENGINE": str(frozen), "FROZEN_MODEL_ROOT": str(root / "legacy"),
        "FROZEN_ENGINE_SHA256": cfg["opponentBinarySha256"],
        "OPPONENT_SOURCE_COMMIT": cfg["opponentSourceCommit"],
        "EXPECTED_RUNNER_SHA256": cfg["runnerSha256"],
        "EXPECTED_CORRECTION_SHA256": cfg["correctionAssetSha256"],
    })

    def verify_games(base, count, seed):
        for label, left, right in [
            ("20.2-left", cfg["candidate"], cfg["opponent"]),
            ("20.0-left", cfg["opponent"], cfg["candidate"]),
        ]:
            database = base / label / "games.db"
            wal = Path(str(database) + "-wal")
            if wal.exists() and wal.stat().st_size:
                raise RuntimeError("uncheckpointed completed database: " + str(database))
            with sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
                rows = db.execute("SELECT game_index, random_seed, left_engine, right_engine, reproducible, included_in_tables FROM compact_games ORDER BY game_index").fetchall()
                if len(rows) != count:
                    raise RuntimeError(f"{label}: expected {count} games, got {len(rows)}")
                for index, row in enumerate(rows):
                    if row != (index, str(seed + index), left, right, 1, 1):
                        raise RuntimeError(f"{label}: invalid game identity {row}")
                metadata = json.loads(db.execute("SELECT metadata_json FROM ai_runs").fetchone()[0])
                if metadata["frozenEngine"]["sha256"] != cfg["opponentBinarySha256"]:
                    raise RuntimeError("opponent binary provenance differs")
                if metadata["sourceCommit"] != cfg["sourceCommit"]:
                    raise RuntimeError("candidate source provenance differs")

    if mode == "prepare":
        record = verify_inputs()
        out.mkdir(parents=True, exist_ok=True)
        for name in ["experiment.json", "frozen-inputs.json", "job-v1.json", "legacy-core-verification.json"]:
            shutil.copy2(root / name, out / name)
        shutil.copy2(runner, out / "cribbage-runner")
        shutil.copy2(frozen, out / "model200-decision-worker")
        (out / "frozen-verification.json").write_text(json.dumps({
            "status": "complete", "filesVerified": len(record["files"]),
            "sourceCommit": cfg["sourceCommit"], "opponentSourceCommit": cfg["opponentSourceCommit"],
            "runnerSha256": sha(runner), "opponentBinarySha256": sha(frozen),
        }, indent=2) + "\n")
        print("Both frozen engines and inputs verified.")
    elif mode == "smoke":
        verify_inputs()
        base = out / "smoke"
        for label, left, right in [("20.2-left", cfg["candidate"], cfg["opponent"]),
                                   ("20.0-left", cfg["opponent"], cfg["candidate"])]:
            directory = base / label
            directory.mkdir(parents=True, exist_ok=True)
            subprocess.run([str(runner), "--left", left, "--right", right,
                "--games", "1", "--seed", str(cfg["smokeSeed"]), "--workers", "1",
                "--model-root", str(source), "--frozen-engine", str(frozen),
                "--frozen-model-root", str(root / "legacy"), "--frozen-model", cfg["opponent"],
                "--out-dir", str(directory), "--db", str(directory / "games.db"),
                "--run-id", "smoke-" + label, "--matchup-id", "20.2-vs-20.0-smoke"],
                env=env, cwd=source, check=True)
        verify_games(base, 1, cfg["smokeSeed"])
        (out / "smoke.json").write_text(json.dumps({"status": "complete", "games": 2}) + "\n")
        print("Both orientations passed complete-game and provenance checks.")
    elif mode == "retire-prior":
        verify_inputs()
        if json.loads((out / "smoke.json").read_text())["status"] != "complete":
            raise RuntimeError("refusing to retire prior benchmark before smoke validation")
        prior = Path(cfg["replacesRoot"])
        prior_spec = json.loads((prior / "job-v1.json").read_text())
        prior_status = Path(prior_spec["jobRoot"]) / "status.json"
        state = json.loads(prior_status.read_text())["state"]
        if state not in ("complete", "stopped"):
            subprocess.run(["/usr/bin/python3", str(source / "scripts/cribbage_job_queue.py"), "stop", str(prior / "job-v1.json")], check=True)
        for attempt in range(30):
            processes = subprocess.run(["/bin/ps", "-axo", "command="], capture_output=True, text=True, check=True).stdout
            if not any(str(prior) + "/bin/" in line or str(prior) + "/source/scripts/run-" in line for line in processes.splitlines()):
                break
            time.sleep(1)
        else:
            raise RuntimeError("prior benchmark workers have not exited")
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        proof = {"status": "complete", "stoppedAt": stamp, "replacement": cfg["jobId"], "orientations": {}}
        previous_out = prior / "benchmark"
        for label in ("20.1-left", "20.0-left"):
            with sqlite3.connect(previous_out / label / "games.db") as db:
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise RuntimeError("prior database integrity check failed")
                rows = db.execute("SELECT game_index,game_id FROM compact_games ORDER BY game_index").fetchall()
            proof["orientations"][label] = {"completed": len(rows), "completedIndexes": [i for i,_ in rows], "gameIds": [g for _,g in rows]}
            status_file = previous_out / label / "status.json"
            status = json.loads(status_file.read_text())
            if status.get("status") != "complete":
                status.update(status="stopped", updatedAt=stamp, replacementJob=cfg["jobId"])
                status_file.write_text(json.dumps(status, indent=2)+"\n")
        report_args = ["node", "--no-warnings", str(source / "scripts/report-paired-live-benchmark.cjs"),
            "--root", str(previous_out), "--candidate", "schell_table-peg_table-20.1", "--opponent", cfg["opponent"],
            "--candidate-left", "20.1-left", "--opponent-left", "20.0-left", "--candidate-left-run-id", "model20-20.1-left",
            "--opponent-left-run-id", "model20-20.0-left"]
        for fmt, name in [("markdown", "stopped-report.md"), ("json", "stopped-report.json")]:
            with (previous_out / name).open("w") as report:
                subprocess.run(report_args + ["--format", fmt], env=env, cwd=source, stdout=report, check=True)
        (previous_out / "stop-provenance.json").write_text(json.dumps(proof, indent=2)+"\n")
        prior_cfg = json.loads((prior / "experiment.json").read_text())
        destination = Path(prior_cfg["durableRoot"])
        destination.mkdir(parents=True, exist_ok=True)
        subprocess.run(["/usr/bin/rsync", "-a", str(previous_out)+"/", str(destination)+"/"], check=True)
        for label, record in proof["orientations"].items():
            with sqlite3.connect((destination / label / "games.db").as_uri()+"?mode=ro&immutable=1", uri=True) as db:
                if db.execute("SELECT game_index,game_id FROM compact_games ORDER BY game_index").fetchall() != list(zip(record["completedIndexes"], record["gameIds"])):
                    raise RuntimeError("prior durable game archive differs")
        (out / "prior-retirement.json").write_text(json.dumps(proof, indent=2)+"\n")
        print("Prior benchmark stopped and every completed game archived.")
    elif mode in ("benchmark", "report"):
        verify_inputs()
        script = "run-model202-vs-model200-10k.sh" if mode == "benchmark" else "report-model202-vs-model200-10k.sh"
        subprocess.run(["/bin/bash", str(source / "scripts" / script)], env=env, cwd=source, check=True)
    elif mode == "verify-games":
        verify_games(out, cfg["gamesPerOrientation"], cfg["seed"])
        (out / "game-integrity.json").write_text(json.dumps({
            "status": "complete", "games": cfg["gamesPerOrientation"] * 2,
            "pairedSeeds": True, "sourceCommit": cfg["sourceCommit"],
            "opponentSourceCommit": cfg["opponentSourceCommit"],
        }, indent=2) + "\n")
        print("Verified game indexes, paired seeds, engine identities and provenance.")
    elif mode == "sync":
        destination = Path(cfg["durableRoot"])
        destination.mkdir(parents=True, exist_ok=True)
        subprocess.run(["/usr/bin/rsync", "-a", str(out) + "/", str(destination) + "/"], check=True)
    else:
        raise SystemExit("unknown stage " + mode)


if __name__ == "__main__":
    main()
