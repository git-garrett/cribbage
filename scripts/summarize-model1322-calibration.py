#!/usr/bin/env python3
"""Combine deterministic Model 13.22 calibration shards and project full ETA."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

CANONICAL_SIX_HANDS = 18_395


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def summarize(output: Path, workers: int, wall_seconds: float) -> dict[str, object]:
    statuses = []
    roots = []
    for worker in range(workers):
        shard = output / f"shard-{worker:02d}"
        status = json.loads((shard / "status.json").read_text())
        if status.get("status") != "complete":
            raise ValueError(f"{shard} is not complete")
        statuses.append(status)
        for root in sorted(shard.glob("root-*.json")):
            roots.append(json.loads(root.read_text()))
    if not roots or wall_seconds <= 0:
        raise ValueError("calibration requires completed roots and positive wall time")
    rollouts = sum(int(root["rollouts"]) for root in roots)
    physical = sum(int(root["physicalCutWorlds"]) for root in roots)
    worker_seconds = sum(float(status["elapsedSeconds"]) for status in statuses)
    full_rollouts = round(
        sum(int(root["exactFullRolloutsForRoot"]) for root in roots)
        / len(roots)
        * CANONICAL_SIX_HANDS
    )
    aggregate_rate = rollouts / wall_seconds
    per_core_rate = rollouts / worker_seconds
    projected_wall = full_rollouts / aggregate_rate
    projected_cpu = full_rollouts / per_core_rate
    semantics = roots[0].get(
        "workloadSemantics",
        "mean exact workload of sampled six-card roots multiplied by all canonical roots",
    )
    if any(root.get("workloadSemantics", semantics) != semantics for root in roots):
        raise ValueError("calibration roots disagree on workload semantics")
    policy_stats = [status.get("policyStats", {}) for status in statuses]
    policy_modes = {status.get("policyMode", "unknown") for status in statuses}
    cache_limits = {json.dumps(status.get("cacheLimits"), sort_keys=True) for status in statuses}
    if len(policy_modes) != 1 or len(cache_limits) != 1:
        raise ValueError("calibration shards disagree on policy mode or cache limits")
    decision_requests = sum(int(stats.get("decisionRequests", 0)) for stats in policy_stats)
    decision_hits = sum(int(stats.get("decisionCacheHits", 0)) for stats in policy_stats)
    continuation_hits = sum(
        int(stats.get("continuationCacheHits", stats.get("futureCacheHits", 0)))
        for stats in policy_stats
    )
    continuation_states = sum(
        int(stats.get("continuationStates", stats.get("randomFutureStates", 0)))
        for stats in policy_stats
    )
    posterior_requests = sum(
        int(stats.get("posteriorRequests", 0)) for stats in policy_stats
    )
    return {
        "status": "complete",
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "workers": workers,
        "policyMode": next(iter(policy_modes)),
        "cacheLimits": json.loads(next(iter(cache_limits))),
        "sampledSixCardRoots": len(roots),
        "rollouts": rollouts,
        "physicalCutWorlds": physical,
        "wallSeconds": wall_seconds,
        "aggregateRolloutsPerSecond": aggregate_rate,
        "workerSeconds": worker_seconds,
        "perCoreRolloutsPerSecond": per_core_rate,
        "policyCacheStats": {
            "decisionRequests": decision_requests,
            "decisionCacheHits": decision_hits,
            "decisionCacheHitRate": (
                decision_hits / decision_requests if decision_requests else 0.0
            ),
            "decisionCacheCapacityClears": sum(
                int(stats.get("decisionCacheCapacityClears", 0))
                for stats in policy_stats
            ),
            "decisionCachePeakEntriesPerWorker": max(
                int(stats.get("decisionCachePeakEntries", 0))
                for stats in policy_stats
            ),
            "posteriorRequests": posterior_requests,
            "posteriorHandsGenerated": sum(
                int(stats.get("posteriorHandsGenerated", 0))
                for stats in policy_stats
            ),
            "continuationCacheHits": continuation_hits,
            "continuationStates": continuation_states,
            "continuationCacheHitRate": (
                continuation_hits / (continuation_hits + continuation_states)
                if continuation_hits + continuation_states
                else 0.0
            ),
            "continuationCacheCapacityClears": sum(
                int(
                    stats.get(
                        "continuationCacheCapacityClears",
                        stats.get("futureCacheCapacityClears", 0),
                    )
                )
                for stats in policy_stats
            ),
            "continuationCachePeakEntriesPerWorker": max(
                int(
                    stats.get(
                        "continuationCachePeakEntries",
                        stats.get("futureCachePeakEntries", 0),
                    )
                )
                for stats in policy_stats
            ),
        },
        "projectedFullRollouts": full_rollouts,
        "projectedFullCpuSeconds": projected_cpu,
        "projectedFullWallSecondsOnMeasuredWorkers": projected_wall,
        "projectedFullWallDaysOnMeasuredWorkers": projected_wall / 86_400,
        "projectionSemantics": (
            f"mean exact workload of sampled six-card roots multiplied by all 18,395 roots; {semantics}"
        ),
        "calibrationOnly": True,
    }


def add_full_asset_projection(result: dict[str, object], workload_path: Path) -> None:
    workload = json.loads(workload_path.read_text())
    full_rollouts = int(workload["projectedFullRollouts"])
    aggregate_rate = float(result["aggregateRolloutsPerSecond"])
    per_core_rate = float(result["perCoreRolloutsPerSecond"])
    workers = int(result["workers"])
    if full_rollouts <= 0 or aggregate_rate <= 0 or per_core_rate <= 0 or workers <= 0:
        raise ValueError("full asset workload and measured rates must be positive")
    wall_seconds = full_rollouts / aggregate_rate
    cpu_seconds = full_rollouts / per_core_rate
    result["fullAssetProjection"] = {
        "source": str(workload_path),
        "rollouts": full_rollouts,
        "measuredWorkers": workers,
        "aggregateRolloutsPerSecond": aggregate_rate,
        "projectedCpuSeconds": cpu_seconds,
        "projectedWallSeconds": wall_seconds,
        "projectedWallDays": wall_seconds / 86_400,
        "projectedWallYears": wall_seconds / (86_400 * 365.25),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--workers", required=True, type=int)
    parser.add_argument("--wall-seconds", required=True, type=float)
    parser.add_argument("--full-workload", type=Path)
    args = parser.parse_args()
    result = summarize(args.output, args.workers, args.wall_seconds)
    if args.full_workload is not None:
        add_full_asset_projection(result, args.full_workload)
    atomic_json(args.output / "status.json", result)
    atomic_json(args.output / "report.json", result)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
