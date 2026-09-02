#!/usr/bin/env python3
"""Run fixed Model 13.22 correction shards with bounded concurrency."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path


KEEP_COUNT = 1820


def required_path(environment: dict[str, str], name: str) -> Path:
    value = environment.get(name)
    if not value:
        raise ValueError(f"{name} is required")
    return Path(value)


def completed(checkpoint: Path, dealer_count: int) -> bool:
    if not checkpoint.is_file():
        return False
    try:
        value = json.loads(checkpoint.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    return (
        value.get("state") == "complete"
        and value.get("completedDealerKeeps") == dealer_count
    )


def main() -> int:
    environment = dict(os.environ)
    runtime_root = required_path(environment, "MODEL1322_CORRECTION_RUNTIME_ROOT")
    output_root = required_path(environment, "MODEL1322_CORRECTION_OUTPUT_ROOT")
    concurrency = int(environment.get("MODEL1322_CORRECTION_WORKERS", "6"))
    shard_count = int(environment.get("MODEL1322_CORRECTION_SHARDS", "40"))
    action_cache = environment.get("MODEL1322_CORRECTION_ACTION_CACHE_LIMIT", "250000")
    evidence_cache = environment.get("MODEL1322_CORRECTION_EVIDENCE_CACHE_LIMIT", "300000")
    future_cache = environment.get("MODEL1322_CORRECTION_FUTURE_CACHE_LIMIT", "3000000")
    if not 1 <= concurrency <= 10:
        raise ValueError("MODEL1322_CORRECTION_WORKERS must be between 1 and 10")
    if not concurrency <= shard_count <= 100:
        raise ValueError("MODEL1322_CORRECTION_SHARDS must be between concurrency and 100")

    builder = runtime_root / "bin/build_model1322_corrections"
    inputs = {
        "--beliefs": runtime_root / "assets/model91-pegging-beliefs.bin",
        "--factors": runtime_root / "assets/model1322-decline-factors.json",
        "--keep-prior": runtime_root / "assets/model132-keep-prior.json",
        "--discard-histograms": runtime_root
        / "assets/model1322-opponent-discard-histograms.json",
        "--baseline-pairs": runtime_root / "assets/model911-pair-outcomes.bin",
    }
    if not builder.is_file() or not os.access(builder, os.X_OK):
        raise ValueError(f"missing Model 13.22 correction builder: {builder}")
    for path in inputs.values():
        if not path.is_file():
            raise ValueError(f"missing frozen Model 13.22 correction input: {path}")
    output_root.mkdir(parents=True, exist_ok=True)

    pending: list[tuple[int, int, int]] = []
    for shard_index in range(shard_count):
        dealer_start = shard_index * KEEP_COUNT // shard_count
        dealer_end = (shard_index + 1) * KEEP_COUNT // shard_count
        dealer_count = dealer_end - dealer_start
        shard = output_root / f"shard-{shard_index:02d}"
        if not completed(shard / "checkpoint.json", dealer_count):
            pending.append((shard_index, dealer_start, dealer_count))

    running: dict[subprocess.Popen[bytes], object] = {}
    stopping = False

    def stop_children(_signum: int | None = None, _frame: object | None = None) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for process in running:
            if process.poll() is None:
                process.terminate()
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and any(
            process.poll() is None for process in running
        ):
            time.sleep(0.1)
        for process in running:
            if process.poll() is None:
                process.kill()

    signal.signal(signal.SIGTERM, stop_children)
    signal.signal(signal.SIGINT, stop_children)

    try:
        while pending or running:
            while pending and len(running) < concurrency and not stopping:
                shard_index, dealer_start, dealer_count = pending.pop(0)
                shard = output_root / f"shard-{shard_index:02d}"
                arguments = [
                    str(builder),
                    "build",
                    "--output",
                    str(shard),
                ]
                for flag, path in inputs.items():
                    arguments.extend((flag, str(path)))
                arguments.extend(
                    (
                        "--dealer-start",
                        str(dealer_start),
                        "--dealer-count",
                        str(dealer_count),
                        "--pone-start",
                        "0",
                        "--pone-count",
                        str(KEEP_COUNT),
                        "--action-cache-limit",
                        action_cache,
                        "--evidence-cache-outcome-limit",
                        evidence_cache,
                        "--future-cache-limit",
                        future_cache,
                    )
                )
                if (shard / "checkpoint.json").is_file():
                    arguments.append("--resume")
                log = (output_root / f"shard-{shard_index:02d}.log").open("ab", buffering=0)
                process = subprocess.Popen(arguments, stdout=log, stderr=subprocess.STDOUT)
                running[process] = log

            if stopping:
                return 130
            failures = []
            for process, log in list(running.items()):
                return_code = process.poll()
                if return_code is None:
                    continue
                log.close()
                del running[process]
                if return_code != 0:
                    failures.append(return_code)
            if failures:
                stop_children()
                return failures[0]
            if running:
                time.sleep(1.0)
    finally:
        if running:
            stop_children()
            for process, log in running.items():
                process.wait()
                log.close()

    summarizer = runtime_root / "scripts/summarize-model1322-corrections.py"
    completed_summary = subprocess.run(
        (
            sys.executable,
            str(summarizer),
            "--shards",
            str(output_root),
            "--output",
            str(output_root / "status.json"),
            "--workers",
            str(concurrency),
            "--shard-count",
            str(shard_count),
            "--require-complete",
        ),
        check=False,
    )
    return completed_summary.returncode


if __name__ == "__main__":
    raise SystemExit(main())
