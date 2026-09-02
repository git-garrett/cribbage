#!/usr/bin/env python3
"""Project full Model 13.22 ETAs from production-shaped cache probes."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


SECONDS_PER_DAY = 86_400
PROJECTION_CORES = 192


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def project(probe: dict, workload: dict) -> dict:
    full_rollouts = workload["projectedFullRollouts"]
    aggregate_rate = probe["aggregateRolloutsPerSecond"]
    per_core_rate = probe["perCoreRolloutsPerSecond"]
    workers = probe["workers"]
    wall_seconds = probe["wallSeconds"]
    worker_seconds = probe["workerSeconds"]
    if min(full_rollouts, aggregate_rate, per_core_rate, workers, wall_seconds) <= 0:
        raise ValueError("probe and workload values must be positive")
    utilization = worker_seconds / (wall_seconds * workers)
    cpu_seconds = full_rollouts / per_core_rate
    measured_wall_seconds = full_rollouts / aggregate_rate
    return {
        "fullRollouts": full_rollouts,
        "probe": {
            "sampledSixCardRoots": probe["sampledSixCardRoots"],
            "rollouts": probe["rollouts"],
            "wallSeconds": wall_seconds,
            "workerSeconds": worker_seconds,
            "workers": workers,
            "aggregateRolloutsPerSecond": aggregate_rate,
            "perCoreRolloutsPerSecond": per_core_rate,
            "observedWorkerUtilization": utilization,
            "policyCacheStats": probe.get("policyCacheStats", {}),
        },
        "projectedFullCpuSeconds": cpu_seconds,
        "projectedFullCoreYears": cpu_seconds / (SECONDS_PER_DAY * 365.25),
        "projectedFullWallSecondsOnMeasuredWorkers": measured_wall_seconds,
        "projectedFullWallDaysOnMeasuredWorkers": measured_wall_seconds / SECONDS_PER_DAY,
        "projectedFullWallDaysOnIdeal192Cores": (
            cpu_seconds / PROJECTION_CORES / SECONDS_PER_DAY
        ),
        "projectedFullWallDaysOn192CoresAtObservedUtilization": (
            cpu_seconds / (PROJECTION_CORES * utilization) / SECONDS_PER_DAY
        ),
    }


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-probe", required=True, type=Path)
    parser.add_argument("--histogram-probe", required=True, type=Path)
    parser.add_argument("--keep-workload", required=True, type=Path)
    parser.add_argument("--histogram-workload", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    keep = project(load(args.keep_probe), load(args.keep_workload))
    histogram = project(load(args.histogram_probe), load(args.histogram_workload))
    result = {
        "schemaVersion": 1,
        "status": "complete",
        "modelVersion": "13.22",
        "semantics": (
            "Each probe selects one discard and one cut for ten spread six-card roots, "
            "then processes every compatible opponent keep for both roles before the "
            "decision-local future cache is cleared. Full workload counts come from the "
            "separate exhaustive-workload calibrations."
        ),
        "keepOnly": keep,
        "conditionalHistogram": histogram,
        "comparison": {
            "keepOnlyToHistogramCpuRatio": (
                keep["projectedFullCpuSeconds"]
                / histogram["projectedFullCpuSeconds"]
            ),
            "keepOnlyToHistogramMeasuredWallRatio": (
                keep["projectedFullWallSecondsOnMeasuredWorkers"]
                / histogram["projectedFullWallSecondsOnMeasuredWorkers"]
            ),
        },
    }
    atomic_json(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
