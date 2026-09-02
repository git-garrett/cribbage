#!/usr/bin/env python3
"""Validate resumable Model 9.11 pair shards and write an atomic status."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path


KEEP_COUNT = 1820


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
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, required=True)
    args = parser.parse_args()
    shards = []
    for worker in range(args.workers):
        shard = args.output / f"shard-{worker:02d}"
        status = json.loads((shard / "status.json").read_text())
        checkpoint = json.loads((shard / "checkpoint.json").read_text())
        if (
            status.get("status") != "complete"
            or checkpoint.get("state") != "complete"
            or checkpoint.get("completedDealerKeeps") != checkpoint.get("dealerCount")
        ):
            raise ValueError(f"incomplete Model 9.11 shard {shard}")
        shards.append(checkpoint)
    shards.sort(key=lambda shard: shard["dealerStart"])
    next_dealer = 0
    for shard in shards:
        if shard["dealerStart"] != next_dealer:
            raise ValueError(f"gap or overlap at dealer keep {next_dealer}")
        next_dealer += shard["dealerCount"]
    if next_dealer != KEEP_COUNT:
        raise ValueError(f"shards cover {next_dealer}/{KEEP_COUNT} dealer keeps")
    summary = {
        "status": "complete",
        "modelVersion": "9.11",
        "workers": args.workers,
        "dealerKeeps": next_dealer,
        "validPairs": sum(shard["validPairs"] for shard in shards),
        "aggregateCpuSeconds": sum(shard["elapsedSeconds"] for shard in shards),
        "beliefChecksum": shards[0]["beliefChecksum"],
        "factorChecksum": shards[0]["factorChecksum"],
        "checkpointUnit": "one dealer-keep row per worker",
        "resumeCommand": "reinstall the unchanged one-shot job specification",
    }
    atomic_json(args.output / "status.json", summary)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
