#!/usr/bin/env python3
"""Report a fully merged, independently verified correction-only build."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--core-selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    runtime = json.loads((args.runtime / "runtime-manifest.json").read_text())
    shards = json.loads((args.work / "pair-shards/status.json").read_text())
    manifest = json.loads((args.work / "merged/manifest.json").read_text())
    verification = json.loads((args.work / "verification.json").read_text())
    selection = json.loads(args.core_selection.read_text())
    if any(value.get("status") != "complete" for value in [shards, manifest, verification, selection]):
        raise ValueError("cannot report incomplete build/verification/core selection")
    if shards["compatiblePairs"] != 3274375 or shards["completedDealerKeeps"] != 1820:
        raise ValueError("incomplete correction coverage")
    if shards["workers"] != selection["selectedWorkers"] or shards["shards"] != manifest["shards"]:
        raise ValueError("worker or shard configuration differs")
    if manifest["modelVersion"] != "13.23" or manifest["jointDistributions"] is not True:
        raise ValueError("merged artifact is not a joint-distribution build")
    if verification["partial"] or verification["rowsVerified"] != 330590 or not verification["exactLegacyMomentsMatch"]:
        raise ValueError("exact full-row verification is missing")
    if runtime["boardAssetSha256"] != "099715bc3aed5b296c39fb3edfd8fa30e0dad13239dede1c8963e344dfe8d679":
        raise ValueError("incorrect WP board asset")
    report = {"schemaVersion": 1, "modelVersion": "13.23", "status": "complete",
              "scope": "correction/aggregation asset rebuild, not playing-strength validation",
              "sourceRevision": runtime["sourceRevision"], "workers": shards["workers"],
              "shards": shards["shards"], "compatiblePairs": shards["compatiblePairs"],
              "jointWorldVisits": shards["exactJointWorlds"], "jointBins": verification["jointBins"],
              "rowsVerified": verification["rowsVerified"], "exactLegacyMomentsMatch": True,
              "bytes": verification["bytes"], "assetSha256": verification["assetSha256"],
              "referenceSha256": verification["referenceSha256"],
              "boardAssetSha256": runtime["boardAssetSha256"],
              "aggregateWorkerSeconds": shards["aggregateWorkerSeconds"],
              "lastBuildInvocationSeconds": shards["elapsedSecondsThisInvocation"],
              "peakAggregateRssKb": shards["peakAggregateRssKb"],
              "reporterSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "durableObservationActionTable": False}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=args.output.name, dir=args.output.parent)
    try:
        with os.fdopen(fd, "w") as target:
            json.dump(report, target, indent=2, sort_keys=True)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, args.output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f"13.23 correction asset complete: {report['jointBins']} joint bins, all {report['rowsVerified']} row moments verified")


if __name__ == "__main__":
    main()
