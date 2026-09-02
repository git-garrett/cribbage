#!/usr/bin/env python3
"""Run resumable cribbage benchmark/build stages as a one-shot launchd job."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import signal
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


SCHEMA_VERSION = 1
INTERNAL_JOB_ROOT = Path("/private/tmp/cribbage-jobs")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_spec(path: Path) -> dict:
    spec = json.loads(path.read_text())
    validate_spec(spec)
    return spec


def validate_spec(spec: dict) -> None:
    if spec.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"schemaVersion must be {SCHEMA_VERSION}")
    job_id = spec.get("jobId")
    if not isinstance(job_id, str) or not job_id or any(
        char not in "abcdefghijklmnopqrstuvwxyz0123456789-" for char in job_id
    ):
        raise ValueError("jobId must contain only lowercase letters, digits, and hyphens")
    stages = spec.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("stages must be a non-empty list")
    names: set[str] = set()
    for stage in stages:
        name = stage.get("name")
        command = stage.get("command")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("stage names must be non-empty and unique")
        names.add(name)
        if not isinstance(command, list) or not command or not all(
            isinstance(part, str) and part for part in command
        ):
            raise ValueError(f"stage {name} command must be a non-empty argv list")
        if not Path(command[0]).is_absolute():
            raise ValueError(f"stage {name} executable must be an absolute path")
        cwd = stage.get("cwd")
        if cwd is not None and not Path(cwd).is_absolute():
            raise ValueError(f"stage {name} cwd must be absolute")
        environment = stage.get("env", {})
        if not isinstance(environment, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in environment.items()
        ):
            raise ValueError(f"stage {name} env must contain string pairs")
        checks = stage.get("completionChecks", [])
        if not isinstance(checks, list):
            raise ValueError(f"stage {name} completionChecks must be a list")
        for check in checks:
            validate_check(name, check)


def validate_check(stage_name: str, check: dict) -> None:
    kind = check.get("type")
    if kind == "file_exists":
        if not isinstance(check.get("path"), str):
            raise ValueError(f"stage {stage_name} file_exists requires path")
    elif kind == "json_field":
        if not isinstance(check.get("path"), str) or not isinstance(
            check.get("field"), str
        ):
            raise ValueError(f"stage {stage_name} json_field requires path and field")
        if "equals" not in check:
            raise ValueError(f"stage {stage_name} json_field requires equals")
    elif kind == "sqlite_count":
        if not isinstance(check.get("path"), str) or not isinstance(
            check.get("table"), str
        ):
            raise ValueError(f"stage {stage_name} sqlite_count requires path and table")
        if not isinstance(check.get("equals"), int):
            raise ValueError(f"stage {stage_name} sqlite_count requires integer equals")
        if not check["table"].replace("_", "").isalnum():
            raise ValueError(f"stage {stage_name} sqlite_count table is invalid")
    elif kind == "sqlite_contiguous_indices":
        if (
            not isinstance(check.get("path"), str)
            or not isinstance(check.get("table"), str)
            or not isinstance(check.get("column"), str)
        ):
            raise ValueError(
                f"stage {stage_name} sqlite_contiguous_indices requires path, table, and column"
            )
        if not isinstance(check.get("start"), int) or not isinstance(
            check.get("count"), int
        ):
            raise ValueError(
                f"stage {stage_name} sqlite_contiguous_indices requires integer start and count"
            )
        if not check["table"].replace("_", "").isalnum() or not check[
            "column"
        ].replace("_", "").isalnum():
            raise ValueError(
                f"stage {stage_name} sqlite_contiguous_indices identifiers are invalid"
            )
    else:
        raise ValueError(f"stage {stage_name} has unknown completion check {kind!r}")


def spec_checksum(spec: dict) -> str:
    encoded = json.dumps(spec, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def job_root(spec: dict) -> Path:
    override = spec.get("jobRoot")
    root = Path(override) if override else INTERNAL_JOB_ROOT / spec["jobId"]
    return root.resolve()


def status_path(spec: dict) -> Path:
    return job_root(spec) / "status.json"


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=path.name, dir=path.parent)
    try:
        with os.fdopen(handle, "w") as temporary:
            json.dump(value, temporary, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def read_status(spec: dict) -> dict:
    path = status_path(spec)
    if not path.exists():
        return {
            "schemaVersion": SCHEMA_VERSION,
            "jobId": spec["jobId"],
            "specChecksum": spec_checksum(spec),
            "state": "pending",
            "stages": [],
        }
    status = json.loads(path.read_text())
    if status.get("specChecksum") != spec_checksum(spec):
        raise ValueError("status belongs to a different job specification")
    return status


def field_value(value: object, dotted_field: str) -> object:
    current = value
    for part in dotted_field.split("."):
        if not isinstance(current, dict) or part not in current:
            raise KeyError(dotted_field)
        current = current[part]
    return current


def check_completion(check: dict) -> tuple[bool, str]:
    path = Path(check["path"])
    if check["type"] == "file_exists":
        ok = path.is_file()
        return ok, f"file {path} {'exists' if ok else 'is missing'}"
    if not path.is_file():
        return False, f"file {path} is missing"
    if check["type"] == "json_field":
        try:
            actual = field_value(json.loads(path.read_text()), check["field"])
        except (json.JSONDecodeError, KeyError) as error:
            return False, f"cannot read {check['field']} from {path}: {error}"
        expected = check["equals"]
        return actual == expected, f"{path}:{check['field']}={actual!r}, expected {expected!r}"
    if check["type"] == "sqlite_count":
        with sqlite3.connect(path) as database:
            actual = database.execute(
                f"SELECT COUNT(*) FROM {check['table']}"
            ).fetchone()[0]
        expected = check["equals"]
        return actual == expected, f"{path}:{check['table']} count={actual}, expected {expected}"
    start = check["start"]
    count = check["count"]
    end = start + count
    with sqlite3.connect(path) as database:
        actual = database.execute(
            f"SELECT COUNT(DISTINCT {check['column']}) FROM {check['table']} "
            f"WHERE {check['column']} >= ? AND {check['column']} < ?",
            (start, end),
        ).fetchone()[0]
    return (
        actual == count,
        f"{path}:{check['table']}.{check['column']} has {actual}/{count} indexes in [{start}, {end})",
    )


def stage_checks(stage: dict) -> tuple[bool, list[str]]:
    messages: list[str] = []
    ok = True
    for check in stage.get("completionChecks", []):
        passed, message = check_completion(check)
        ok = ok and passed
        messages.append(message)
    return ok, messages


def stage_record(status: dict, name: str) -> dict | None:
    return next((stage for stage in status["stages"] if stage["name"] == name), None)


def update_stage(status: dict, name: str, **values: object) -> dict:
    record = stage_record(status, name)
    if record is None:
        record = {"name": name}
        status["stages"].append(record)
    record.update(values)
    status["updatedAt"] = utc_now()
    atomic_json(status_path_from_status(status), status)
    return record


def status_path_from_status(status: dict) -> Path:
    return Path(status["statusPath"])


def run_job(spec_path: Path) -> int:
    spec = load_spec(spec_path)
    status = read_status(spec)
    status["statusPath"] = str(status_path(spec))
    status["state"] = "running"
    status["startedAt"] = status.get("startedAt", utc_now())
    status["updatedAt"] = utc_now()
    status["pid"] = os.getpid()
    atomic_json(status_path(spec), status)

    for stage in spec["stages"]:
        prior = stage_record(status, stage["name"])
        checks_ok, messages = stage_checks(stage)
        if prior and prior.get("state") == "complete" and checks_ok:
            continue

        root = job_root(spec)
        log_path = root / f"{stage['name']}.log"
        update_stage(
            status,
            stage["name"],
            state="running",
            startedAt=utc_now(),
            command=stage["command"],
            logPath=str(log_path),
        )
        environment = os.environ.copy()
        environment.update(stage.get("env", {}))
        with log_path.open("ab", buffering=0) as log:
            completed = subprocess.run(
                stage["command"],
                cwd=stage.get("cwd"),
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=False,
            )
        checks_ok, messages = stage_checks(stage)
        if completed.returncode != 0 or not checks_ok:
            update_stage(
                status,
                stage["name"],
                state="failed",
                completedAt=utc_now(),
                exitCode=completed.returncode,
                checks=messages,
            )
            status["state"] = "failed"
            status["updatedAt"] = utc_now()
            atomic_json(status_path(spec), status)
            return completed.returncode or 1
        update_stage(
            status,
            stage["name"],
            state="complete",
            completedAt=utc_now(),
            exitCode=0,
            checks=messages,
        )

    status["state"] = "complete"
    status["completedAt"] = utc_now()
    status["updatedAt"] = status["completedAt"]
    atomic_json(status_path(spec), status)
    return 0


def launch_label(spec: dict) -> str:
    return f"com.strongcribbage.job.{spec['jobId']}"


def make_plist(spec: dict, internal_runner: Path, internal_spec: Path) -> dict:
    root = job_root(spec)
    return {
        "Label": launch_label(spec),
        "ProgramArguments": [
            "/usr/bin/python3",
            str(internal_runner),
            "run",
            str(internal_spec),
        ],
        "RunAtLoad": True,
        "KeepAlive": False,
        "ProcessType": "Standard",
        "StandardOutPath": str(root / "supervisor.log"),
        "StandardErrorPath": str(root / "supervisor.log"),
    }


def install_job(spec_path: Path) -> int:
    spec = load_spec(spec_path)
    root = job_root(spec)
    if root != INTERNAL_JOB_ROOT / spec["jobId"]:
        raise ValueError(f"managed jobRoot must be {INTERNAL_JOB_ROOT / spec['jobId']}")
    root.mkdir(parents=True, exist_ok=True)
    if status_path(spec).exists():
        # Refuse to reuse a job ID for different work. A matching failed or
        # interrupted job is safe to reinstall because completed stages and
        # their checks are retained.
        read_status(spec)
    internal_runner = root / "cribbage_job_queue.py"
    internal_spec = root / "job.json"
    shutil.copy2(Path(__file__).resolve(), internal_runner)
    internal_spec.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n")
    plist_path = root / f"{launch_label(spec)}.plist"
    with plist_path.open("wb") as plist_file:
        plistlib.dump(make_plist(spec, internal_runner, internal_spec), plist_file)
    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{launch_label(spec)}"
    subprocess.run(
        ["launchctl", "bootout", service],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    print(f"launchctl bootstrap {domain} {plist_path}")
    completed = subprocess.run(
        ["launchctl", "bootstrap", domain, str(plist_path)], check=False
    )
    return completed.returncode


def print_status(spec_path: Path) -> int:
    spec = load_spec(spec_path)
    print(json.dumps(read_status(spec), indent=2, sort_keys=True))
    return 0


def stop_job(spec_path: Path) -> int:
    spec = load_spec(spec_path)
    service = f"gui/{os.getuid()}/{launch_label(spec)}"
    completed = subprocess.run(["launchctl", "bootout", service], check=False)
    stopped = completed.returncode == 0
    if status_path(spec).exists():
        status = read_status(spec)
        if not stopped:
            pid = status.get("pid")
            if isinstance(pid, int) and pid > 1:
                try:
                    process_group = os.getpgid(pid)
                    if process_group != pid:
                        raise RuntimeError(
                            f"refusing to stop unexpected process group {process_group} for pid {pid}"
                        )
                    os.killpg(process_group, signal.SIGTERM)
                    stopped = True
                except ProcessLookupError:
                    stopped = True
                except (OSError, RuntimeError) as error:
                    print(f"failed to stop job process group: {error}", file=sys.stderr)
        if not stopped:
            return completed.returncode or 1
        status["statusPath"] = str(status_path(spec))
        status["state"] = "stopped"
        status["updatedAt"] = utc_now()
        atomic_json(status_path(spec), status)
    return 0 if stopped else completed.returncode


def validate_command(spec_path: Path) -> int:
    spec = load_spec(spec_path)
    print(f"valid jobId={spec['jobId']} stages={len(spec['stages'])} checksum={spec_checksum(spec)}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "run", "install", "status", "stop"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("spec", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "validate":
            return validate_command(args.spec)
        if args.command == "run":
            return run_job(args.spec)
        if args.command == "install":
            return install_job(args.spec)
        if args.command == "stop":
            return stop_job(args.spec)
        return print_status(args.spec)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
