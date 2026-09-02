#!/usr/bin/env python3
"""Create the deterministic final Model 13.22 correction build report."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


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
    parser.add_argument("--shard-summary", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--verification", type=Path, required=True)
    parser.add_argument("--runtime-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    shard_summary = json.loads(args.shard_summary.read_text())
    manifest = json.loads(args.manifest.read_text())
    verification = json.loads(args.verification.read_text())
    runtime = json.loads(args.runtime_manifest.read_text())
    if any(value.get("status") != "complete" for value in (shard_summary, manifest, verification)):
        raise ValueError("cannot report an incomplete Model 13.22 correction build")
    result = {
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "status": "complete",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workers": shard_summary["workers"],
        "cacheLimits": shard_summary["cacheLimits"],
        "dealerKeeps": manifest["dealerKeeps"],
        "poneKeeps": manifest["poneKeeps"],
        "compatiblePairs": manifest["compatiblePairs"],
        "actorScreens": manifest["actorScreens"],
        "suffixRollouts": manifest["suffixRollouts"],
        "stableJointWorlds": manifest["stableJointWorlds"],
        "exactJointWorlds": manifest["exactJointWorlds"],
        "wallSeconds": manifest["wallSeconds"],
        "pairsPerWallSecond": shard_summary["pairsPerWallSecond"],
        "assetBytes": manifest["bytes"],
        "assetChecksum": verification["outputChecksum"],
        "runtimeManifest": runtime,
        "checkpointUnit": shard_summary["checkpointUnit"],
        "durableObservationActionTable": False,
    }
    atomic_json(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
