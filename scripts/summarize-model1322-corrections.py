#!/usr/bin/env python3
"""Validate Model 13.22 correction shards and write one atomic summary."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path


KEEP_COUNT = 1820
CHECKSUM_FIELDS = (
    "beliefChecksum",
    "factorChecksum",
    "priorChecksum",
    "histogramChecksum",
    "baselineChecksum",
)
SUM_FIELDS = (
    "compatiblePairs",
    "actorScreens",
    "suffixRollouts",
    "stableJointWorlds",
    "exactJointWorlds",
    "verifiedWorlds",
)


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shards", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, required=True)
    parser.add_argument("--shard-count", type=int)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.workers <= 10:
        raise ValueError("workers must be between 1 and 10")
    shard_count = args.shard_count or args.workers
    if not args.workers <= shard_count <= 100:
        raise ValueError("shard count must be between workers and 100")

    shards = []
    statuses = []
    for shard_index in range(shard_count):
        directory = args.shards / f"shard-{shard_index:02d}"
        checkpoint = json.loads((directory / "checkpoint.json").read_text())
        status = json.loads((directory / "status.json").read_text())
        if checkpoint.get("schemaVersion") != 1 or checkpoint.get("modelVersion") != "13.22":
            raise ValueError(f"invalid Model 13.22 checkpoint {directory}")
        if checkpoint.get("poneStart") != 0 or checkpoint.get("poneCount") != KEEP_COUNT:
            raise ValueError(f"incomplete pone range in {directory}")
        if status.get("dealerStart") != checkpoint.get("dealerStart"):
            raise ValueError(f"status/checkpoint mismatch in {directory}")
        if status.get("completedDealerKeeps") != checkpoint.get("completedDealerKeeps"):
            raise ValueError(f"status/checkpoint progress mismatch in {directory}")
        if args.require_complete and (
            checkpoint.get("state") != "complete"
            or status.get("status") != "complete"
            or checkpoint.get("completedDealerKeeps") != checkpoint.get("dealerCount")
        ):
            raise ValueError(f"incomplete Model 13.22 correction shard {directory}")
        shards.append(checkpoint)
        statuses.append(status)

    shards.sort(key=lambda value: value["dealerStart"])
    next_dealer = 0
    for shard in shards:
        if shard["dealerStart"] != next_dealer:
            raise ValueError(f"gap or overlap at dealer keep {next_dealer}")
        next_dealer += shard["dealerCount"]
    if next_dealer != KEEP_COUNT:
        raise ValueError(f"shards cover {next_dealer}/{KEEP_COUNT} dealer keeps")

    for field in CHECKSUM_FIELDS:
        values = {shard[field] for shard in shards}
        if len(values) != 1:
            raise ValueError(f"shards disagree on {field}")
    cache_limits = {json.dumps(status["cacheLimits"], sort_keys=True) for status in statuses}
    if len(cache_limits) != 1:
        raise ValueError("shards disagree on cache limits")

    wall_seconds = max(shard["elapsedSeconds"] for shard in shards)
    summary = {
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "status": "complete" if args.require_complete else "running",
        "workers": args.workers,
        "shards": shard_count,
        "dealerKeeps": next_dealer,
        "poneKeeps": KEEP_COUNT,
        "wallSeconds": wall_seconds,
        "aggregateWorkerSeconds": sum(shard["elapsedSeconds"] for shard in shards),
        "pairsPerWallSecond": (
            sum(shard["compatiblePairs"] for shard in shards) / wall_seconds
            if wall_seconds
            else 0.0
        ),
        "cacheLimits": statuses[0]["cacheLimits"],
        "checkpointUnit": "one dealer-keep row per worker",
        "resumeCommand": "scripts/model1322-correction-control.sh resume",
    }
    summary.update({field: shards[0][field] for field in CHECKSUM_FIELDS})
    summary.update({field: sum(shard[field] for shard in shards) for field in SUM_FIELDS})
    atomic_json(args.output, summary)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
