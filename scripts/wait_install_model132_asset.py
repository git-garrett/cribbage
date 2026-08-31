#!/usr/bin/env python3
"""Wait for, verify, and atomically install the exhaustive Model 13.2 asset."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


EXPECTED_BYTES = 56 + (1_820 * 2 * 8) + (1_820 * 1_820 * 2)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except json.JSONDecodeError:
        return None


def fnv1a64(path: Path) -> str:
    value = 0xCBF29CE484222325
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            for byte in chunk:
                value ^= byte
                value = (value * 0x00000100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp"
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        shutil.copyfile(source, temporary)
        with temporary.open("rb") as copied:
            os.fsync(copied.fileno())
        os.replace(temporary, destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w") as temporary:
            json.dump(value, temporary, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def validate_ready(source_dir: Path) -> tuple[Path, dict] | None:
    status = read_json(source_dir / "status.json")
    manifest = read_json(source_dir / "manifest.json")
    if not status or not manifest:
        return None
    if status.get("status") != "complete" or manifest.get("status") != "complete":
        return None
    asset = source_dir / "model132-keep-pairs.bin"
    expected_fields = {
        "mode": "exhaustive",
        "canonicalKeepCount": 1_820,
        "completedDealerKeeps": 1_820,
        "assetBytes": EXPECTED_BYTES,
    }
    for key, expected in expected_fields.items():
        if status.get(key) != expected or manifest.get(key) != expected:
            raise ValueError(f"Model 13.2 {key} does not equal {expected!r}")
    if manifest.get("model") != "schell_table-peg_table-13.2":
        raise ValueError("Model 13.2 manifest has the wrong model ID")
    if not asset.is_file() or asset.stat().st_size != EXPECTED_BYTES:
        raise ValueError("Model 13.2 asset is absent or has the wrong size")
    checksum = fnv1a64(asset)
    if checksum != status.get("assetChecksum") or checksum != manifest.get("assetChecksum"):
        raise ValueError("Model 13.2 asset checksum does not match its manifests")
    return asset, manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--upstream-status", required=True, type=Path)
    parser.add_argument("--destination-assets", required=True, type=Path)
    parser.add_argument("--ready-status", required=True, type=Path)
    parser.add_argument("--poll-seconds", type=int, default=300)
    arguments = parser.parse_args()
    if arguments.poll_seconds <= 0:
        raise ValueError("poll seconds must be positive")

    while True:
        ready = validate_ready(arguments.source_dir)
        if ready:
            source_asset, manifest = ready
            destination_asset = arguments.destination_assets / source_asset.name
            destination_manifest = (
                arguments.destination_assets / "model132-keep-pairs.manifest.json"
            )
            atomic_copy(source_asset, destination_asset)
            atomic_copy(arguments.source_dir / "manifest.json", destination_manifest)
            installed = {
                "status": "complete",
                "installedAt": utc_now(),
                "source": str(source_asset),
                "destination": str(destination_asset),
                "assetBytes": destination_asset.stat().st_size,
                "assetChecksum": manifest["assetChecksum"],
                "assetSha256": sha256(destination_asset),
            }
            atomic_json(arguments.ready_status, installed)
            print(
                f"installed Model 13.2 asset sha256={installed['assetSha256']}",
                flush=True,
            )
            return 0

        upstream = read_json(arguments.upstream_status)
        if upstream and upstream.get("state") in {"failed", "stopped"}:
            raise RuntimeError(
                f"upstream Model 13.2 build is {upstream['state']}; refusing to wait"
            )
        print(f"{utc_now()} Model 13.2 asset is not complete; waiting", flush=True)
        time.sleep(arguments.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
