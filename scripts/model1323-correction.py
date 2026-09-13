#!/usr/bin/env python3
"""Bounded correction-only workers, reproducible core probe, and exact verification.

Launch long invocations through cribbage_job_queue.py, never detach this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mmap
import os
import signal
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

KEEPS = 1820
ROWS = 165295
PREFIX_BYTES = 128 + 2 * ROWS * 48 + ROWS * 13 * 2
INPUTS = {
    "--beliefs": "model91-pegging-beliefs.bin",
    "--factors": "model1322-decline-factors.json",
    "--keep-prior": "model132-keep-prior.json",
    "--discard-histograms": "model1322-opponent-discard-histograms.json",
    "--baseline-pairs": "model911-pair-outcomes.bin",
}
COUNTERS = ["compatiblePairs", "actorScreens", "suffixRollouts", "stableJointWorlds", "exactJointWorlds", "verifiedWorlds"]
CHECKSUMS = ["beliefChecksum", "factorChecksum", "priorChecksum", "histogramChecksum", "baselineChecksum"]
EXPECTED_INPUT_SHA256 = {
    "model911-pair-outcomes.bin": "317edf22adf99d0785cde1e0a1827591756ad1b3fd601b0a518744f78da4fabb",
    "model91-pegging-beliefs.bin": "2823cdf5357e4fbab379b09f2aad8d45a53a423e852e920e0c54b7ff57b7c6af",
    "model132-keep-prior.json": "ce5f9e6fc81854d5a6cab52a539906298e65c70861afa54ddfaf94eb4c09b4a4",
    "model1322-opponent-discard-histograms.json": "c2b274d38e94f8ff5c0aeabcddf7980dee89ae374af7564330f6d7e69193ac87",
    "model1322-decline-factors.json": "4dfb1b8c20f612153a6b0d57496fd77c5219a8a2ba7e01acb8909b862d5418dc",
}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name, dir=path.parent)
    try:
        with os.fdopen(fd, "w") as target:
            json.dump(value, target, indent=2, sort_keys=True)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1048576), b""):
            result.update(chunk)
    return result.hexdigest()


def freeze(args):
    if args.output.exists():
        raise ValueError("freeze requires a new runtime directory")
    dirty = subprocess.check_output(["git", "status", "--porcelain"], cwd=args.source, text=True)
    if dirty.strip():
        raise ValueError("commit and verify the source before freezing a build")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.source, text=True).strip()
    files = {}
    for name, expected in EXPECTED_INPUT_SHA256.items():
        path = args.inputs / name
        if digest(path) != expected:
            raise ValueError(f"reusable input differs from the completed build: {name}")
        files[f"assets/{name}"] = path
    if digest(args.reference) != "43ad61c68603254afd8c2b07bb26499e518e0988a4a3c6a022394f44b797cb69":
        raise ValueError("reference means asset is not the verified completed 13.22 build")
    board = args.source / "rust/cribbage-shadow-engine/assets/board-win-matrix.bin"
    if digest(board) != "099715bc3aed5b296c39fb3edfd8fa30e0dad13239dede1c8963e344dfe8d679":
        raise ValueError("WP board asset differs from Model 13.215")
    files.update({"assets/model1322-reference-means.bin": args.reference,
                  "assets/board-win-matrix.bin": board,
                  "bin/build_model1322_corrections": args.source / "rust/target/release/build_model1322_corrections",
                  "bin/legacy-build_model1322_corrections": args.legacy_builder,
                  "scripts/model1323-correction.py": args.source / "scripts/model1323-correction.py"})
    for name, source in files.items():
        target = args.output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    subprocess.run(["git", "archive", "--format=tar", "--output", str(args.output / "source.tar"), revision], cwd=args.source, check=True)
    atomic_json(args.output / "runtime-manifest.json", {"schemaVersion": 1, "modelVersion": "13.23",
        "sourceRevision": revision, "offlineObjective": "unchanged legal-information net-points policy",
        "rebuildScope": "correction/aggregation only; joint distributions retained",
        "boardAssetSha256": digest(board), "files": {name: digest(args.output / name) for name in files},
        "sourceArchiveSha256": digest(args.output / "source.tar")})


def validate_runtime(runtime):
    manifest = json.loads((runtime / "runtime-manifest.json").read_text())
    if manifest.get("modelVersion") != "13.23":
        raise ValueError("invalid frozen runtime manifest")
    for name, expected in manifest["files"].items():
        if digest(runtime / name) != expected:
            raise ValueError(f"frozen runtime file changed: {name}")
    # The old asset independently records the exact five policy/input checksums.
    with (runtime / "assets/model1322-reference-means.bin").open("rb") as source:
        header = source.read(128)
    return {field: f"{value:016x}" for field, value in zip(CHECKSUMS, struct.unpack_from("<5Q", header, 40))}


def bind_output(runtime, output, tasks):
    output.mkdir(parents=True, exist_ok=True)
    path = output / "producer.json"
    expected = {"runtimeManifestSha256": digest(runtime / "runtime-manifest.json"),
                "tasks": [[name, list(bounds)] for name, bounds in tasks]}
    if path.exists():
        if json.loads(path.read_text()) != expected:
            raise ValueError("output producer/runtime or task ranges changed; refusing mixed-build resume")
    else:
        if any((output / name / "checkpoint.json").exists() or (output / name / "partial.bin").exists() for name, _ in tasks):
            raise ValueError("existing correction output has no producer identity")
        atomic_json(path, expected)


def command(runtime, output, bounds, joint=True):
    result = [str(runtime / "bin/build_model1322_corrections"), "build", "--output", str(output)]
    for flag, name in INPUTS.items():
        result += [flag, str(runtime / "assets" / name)]
    for flag, number in zip(["--dealer-start", "--dealer-count", "--pone-start", "--pone-count"], bounds):
        result += [flag, str(number)]
    result += ["--action-cache-limit", "250000", "--evidence-cache-outcome-limit", "300000",
               "--future-cache-limit", "3000000", "--verify-first-worlds", "32"]
    if joint:
        result += ["--joint-distributions"]
    if (output / "partial.bin").exists() or (output / "checkpoint.json").exists():
        result += ["--resume"]
    return result


def checkpoint(directory, bounds, expected_checksums):
    path = directory / "checkpoint.json"
    if not path.exists():
        return None
    value = json.loads(path.read_text())
    actual = tuple(value.get(key) for key in ["dealerStart", "dealerCount", "poneStart", "poneCount"])
    if value.get("modelVersion") != "13.23" or actual != bounds:
        raise ValueError(f"incompatible checkpoint: {directory}")
    if any(value.get(field) != expected for field, expected in expected_checksums.items()):
        raise ValueError(f"checkpoint input provenance changed: {directory}")
    partial = directory / "partial.bin"
    if partial.exists():
        if partial.stat().st_size < PREFIX_BYTES + 2 * ROWS * 4:
            raise ValueError(f"truncated binary checkpoint: {directory}")
        with partial.open("rb") as source:
            header = source.read(128)
        if len(header) != 128 or header[:8] != b"M1323C01":
            raise ValueError(f"invalid binary checkpoint: {directory}")
        version, rows, start, count, pone, pone_count, done = struct.unpack_from("<7I", header, 8)
        if (version, rows) != (1, ROWS) or (start, count, pone, pone_count) != bounds or done > count:
            raise ValueError(f"binary checkpoint range differs: {directory}")
        checksums = {field: f"{number:016x}" for field, number in zip(CHECKSUMS, struct.unpack_from("<5Q", header, 40))}
        if checksums != expected_checksums:
            raise ValueError(f"binary checkpoint provenance differs: {directory}")
        # Binary snapshot is authoritative if interruption preceded JSON update.
        value["completedDealerKeeps"] = done
        value["state"] = "complete" if done == count else "running"
        for field, number in zip(COUNTERS[:5], struct.unpack_from("<5Q", header, 80)):
            value[field] = number
        value["elapsedSeconds"], = struct.unpack_from("<d", header, 120)
    elif value.get("completedDealerKeeps") != 0 or value.get("state") == "complete":
        raise ValueError(f"missing binary checkpoint for committed work: {directory}")
    return value


def run_pool(runtime, output, workers, tasks):
    if not 1 <= workers <= 12:
        raise ValueError("workers must be between 1 and 12")
    expected_checksums = validate_runtime(runtime)
    bind_output(runtime, output, tasks)
    output.mkdir(parents=True, exist_ok=True)
    pending = []
    for name, bounds in tasks:
        value = checkpoint(output / name, bounds, expected_checksums)
        if not value or value["state"] != "complete" or value["completedDealerKeeps"] != bounds[1]:
            pending.append((name, bounds))
    running = {}
    started = time.monotonic()
    stopping = False
    peak_rss_kb = 0
    peak_worker_rss_kb = 0

    def stop(_signum=None, _frame=None):
        nonlocal stopping
        stopping = True
        for process in running:
            if process.poll() is None:
                process.terminate()

    def summary(complete=False):
        states = [checkpoint(output / name, bounds, expected_checksums) for name, bounds in tasks]
        states = [value for value in states if value]
        for field in CHECKSUMS:
            if len({value[field] for value in states}) > 1:
                raise ValueError(f"shards disagree on {field}")
        completed = sum(value["state"] == "complete" for value in states)
        if complete and completed != len(tasks):
            raise ValueError("worker exited without a complete checkpoint")
        value = {"schemaVersion": 1, "modelVersion": "13.23", "status": "complete" if complete else "running",
                 "workers": workers, "shards": len(tasks), "completedShards": completed,
                 "completedDealerKeeps": sum(v["completedDealerKeeps"] for v in states),
                 "elapsedSecondsThisInvocation": time.monotonic() - started,
                 "aggregateWorkerSeconds": sum(v["elapsedSeconds"] for v in states),
                 "peakWorkerRssKb": peak_worker_rss_kb, "peakAggregateRssKb": peak_rss_kb,
                 "activeWorkers": len(running), "pendingShards": len(pending)}
        value.update({field: sum(v.get(field, 0) for v in states) for field in COUNTERS})
        if states:
            value.update({field: states[0][field] for field in CHECKSUMS})
        atomic_json(output / "status.json", value)
        return value

    previous = {sig: signal.signal(sig, stop) for sig in [signal.SIGINT, signal.SIGTERM]}
    last_summary = 0.0
    try:
        while pending or running:
            while pending and len(running) < workers and not stopping:
                name, bounds = pending.pop(0)
                log = (output / f"{name}.log").open("ab", buffering=0)
                process = subprocess.Popen(command(runtime, output / name, bounds), stdout=log, stderr=subprocess.STDOUT)
                running[process] = (log, name)
            if stopping:
                raise InterruptedError("correction workers stopped")
            for process, (log, name) in list(running.items()):
                code = process.poll()
                if code is not None:
                    log.close()
                    del running[process]
                    if code:
                        raise RuntimeError(f"{name} failed with exit {code}; inspect {output / (name + '.log')}")
            if time.monotonic() - last_summary >= 5:
                if running:
                    usage = subprocess.run(["/bin/ps", "-o", "rss=", "-p", ",".join(str(p.pid) for p in running)], capture_output=True, text=True)
                    rss = [int(row) for row in usage.stdout.split()]
                    peak_rss_kb = max(peak_rss_kb, sum(rss))
                    peak_worker_rss_kb = max([peak_worker_rss_kb] + rss)
                summary()
                last_summary = time.monotonic()
            if running:
                time.sleep(0.5)
        return summary(complete=True)
    finally:
        stop()
        for process, (log, _) in running.items():
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            log.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def probe(args):
    # One identical tile per worker: every measurement has one saturated wave,
    # the same work per process and the same cache warmup. A fixed task count
    # would unfairly penalize core counts with an underfilled final wave.
    results = []
    for workers in [4, 8, 6, 10]:
        tasks = [(f"sample-{i:02}", (840, 1, 770, 36)) for i in range(workers)]
        directory = args.output / f"workers-{workers}"
        if directory.exists():
            raise ValueError("core measurements require fresh output, not resumed timing")
        result = run_pool(args.runtime, directory, workers, tasks)
        result["pairsPerSecond"] = result["compatiblePairs"] / result["elapsedSecondsThisInvocation"]
        results.append(result)
        atomic_json(args.output / "probe-progress.json", {"status": "running", "measurements": results})
        print(f"workers={workers} pairs/sec={result['pairsPerSecond']:.4f} peakWorkerMiB={result['peakWorkerRssKb']/1024:.1f}", flush=True)
    # Leave ample room for larger histogram shards, filesystem cache, and normal desktop use.
    eligible = [r for r in results if r["peakAggregateRssKb"] <= 10 * 1024 * 1024]
    if not eligible:
        raise ValueError("no measured concurrency fits the memory safety budget")
    fastest = max(r["pairsPerSecond"] for r in eligible)
    chosen = min((r for r in eligible if r["pairsPerSecond"] >= fastest * 0.97), key=lambda r: r["workers"])
    atomic_json(args.output / "core-selection.json", {"status": "complete", "selectedWorkers": chosen["workers"],
        "criterion": "fewest workers within 3% of best measured throughput, <=10 GiB aggregate sampled RSS",
        "scope": "representative correction microbenchmark; not a whole-build ETA or proof of global optimum",
        "measurements": results})


def smoke(args):
    bounds = (840, 1, 790, 12)
    args.output.mkdir(parents=True, exist_ok=True)
    validate_runtime(args.runtime)
    bind_output(args.runtime, args.output, [("joint", bounds)])
    joint_output = args.output / "joint"
    # Reproduce an interruption after the initial JSON but before any binary
    # checkpoint. Restart must neither reject it nor invent completed work.
    if not (joint_output / "checkpoint.json").exists():
        with (args.output / "interruption.log").open("ab") as log:
            process = subprocess.Popen(command(args.runtime, joint_output, bounds), stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 30
            try:
                while not (joint_output / "checkpoint.json").exists():
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("smoke did not reach its initial checkpoint")
                    time.sleep(0.01)
            finally:
                process.terminate()
                process.wait(timeout=5)
        if (joint_output / "partial.bin").exists():
            raise RuntimeError("smoke interruption occurred too late to test initial restart")
    run_pool(args.runtime, args.output, 1, [("joint", bounds)])
    old_output = args.output / "legacy"
    argv = command(args.runtime, old_output, bounds, joint=False)
    argv[0] = str(args.legacy_builder)
    with (args.output / "legacy.log").open("ab") as log:
        subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT, check=True)
    verify(args.output / "joint/partial.bin", old_output / "partial.bin", args.output / "verification.json", True)
    # Exercise binary checkpoint loading, not merely in-memory serialization.
    subprocess.run(command(args.runtime, args.output / "joint", bounds), check=True, stdout=subprocess.DEVNULL)
    verify(args.output / "joint/partial.bin", old_output / "partial.bin", args.output / "verification.json", True)


def verify(asset, reference, output, allow_partial=False):
    with asset.open("rb") as source, reference.open("rb") as old_source:
        with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data, mmap.mmap(old_source.fileno(), 0, access=mmap.ACCESS_READ) as old:
            if data[:8] != b"M1323C01" or old[:8] != b"M1322C01":
                raise ValueError("incorrect distribution/reference magic")
            if len(data) < PREFIX_BYTES or len(old) != PREFIX_BYTES:
                raise ValueError("truncated or incompatible asset")
            if data[8:80] != old[8:80]:
                raise ValueError("new and old ranges, version, row count, or input provenance differ")
            if not allow_partial and struct.unpack_from("<7I", data, 8) != (1, ROWS, 0, KEEPS, 0, KEEPS, KEEPS):
                raise ValueError("incomplete full-asset ranges")
            if data[128:PREFIX_BYTES] != old[128:PREFIX_BYTES]:
                raise ValueError("regenerated moments/weights or diagnostic lead masks differ from 13.22")
            offset = PREFIX_BYTES
            bins_total = nonempty = 0
            for row in range(2 * ROWS):
                count, = struct.unpack_from("<I", data, offset)
                offset += 4
                if count > 65536 or offset + 18 * count > len(data):
                    raise ValueError(f"invalid bin count at row {row}")
                moments = [0, 0, 0]
                previous = -1
                for _ in range(count):
                    key, = struct.unpack_from("<H", data, offset)
                    weight = int.from_bytes(data[offset + 2:offset + 18], "little")
                    offset += 18
                    if key <= previous or weight <= 0:
                        raise ValueError(f"invalid joint bin at row {row}")
                    previous = key
                    moments[0] += (key >> 8) * weight
                    moments[1] += (key & 255) * weight
                    moments[2] += weight
                expected = [int.from_bytes(data[128 + row * 48 + i * 16:128 + row * 48 + (i + 1) * 16], "little") for i in range(3)]
                if moments != expected or (not allow_partial and not count):
                    raise ValueError(f"distribution/moment mismatch at row {row}")
                bins_total += count
                nonempty += bool(count)
            if offset != len(data):
                raise ValueError("trailing distribution bytes")
    value = {"status": "complete", "modelVersion": "13.23", "rowsVerified": 2 * ROWS,
             "nonemptyRows": nonempty, "jointBins": bins_total, "exactLegacyMomentsMatch": True,
             "partial": allow_partial, "assetSha256": digest(asset), "referenceSha256": digest(reference),
             "bytes": asset.stat().st_size}
    atomic_json(output, value)
    print(f"verified rows={2*ROWS} bins={bins_total} exactLegacyMomentsMatch=true", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    part = sub.add_parser("freeze")
    for flag in ["source", "inputs", "reference", "legacy-builder", "output"]:
        part.add_argument(f"--{flag}", type=Path, required=True)
    for name in ["run", "probe", "smoke"]:
        part = sub.add_parser(name)
        part.add_argument("--runtime", type=Path, required=True)
        part.add_argument("--output", type=Path, required=True)
        if name == "smoke":
            part.add_argument("--legacy-builder", type=Path, required=True)
        if name == "run":
            group = part.add_mutually_exclusive_group(required=True)
            group.add_argument("--workers", type=int)
            group.add_argument("--core-selection", type=Path)
            part.add_argument("--shards", type=int, default=40)
    part = sub.add_parser("verify")
    part.add_argument("--asset", type=Path, required=True)
    part.add_argument("--reference", type=Path, required=True)
    part.add_argument("--output", type=Path, required=True)
    part.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    if args.command == "freeze":
        freeze(args)
    elif args.command == "probe":
        probe(args)
    elif args.command == "smoke":
        smoke(args)
    elif args.command == "verify":
        verify(args.asset, args.reference, args.output, args.allow_partial)
    else:
        workers = args.workers
        if args.core_selection:
            selection = json.loads(args.core_selection.read_text())
            if selection.get("status") != "complete":
                raise ValueError("core selection is incomplete")
            workers = selection["selectedWorkers"]
        if not workers <= args.shards <= 100:
            raise ValueError("shard count must be between workers and 100")
        tasks = [(f"shard-{i:02}", (i * KEEPS // args.shards, (i + 1) * KEEPS // args.shards - i * KEEPS // args.shards, 0, KEEPS)) for i in range(args.shards)]
        result = run_pool(args.runtime, args.output, workers, tasks)
        if result["compatiblePairs"] != 3274375 or result["completedDealerKeeps"] != KEEPS:
            raise ValueError("correction coverage is incomplete")


if __name__ == "__main__":
    main()
