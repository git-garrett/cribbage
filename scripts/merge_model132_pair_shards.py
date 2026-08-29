#!/usr/bin/env python3
"""Merge contiguous Model 13.2 keep-pair shards into one exact asset."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path


MAGIC = b"M132P001"
VERSION = 1
HEADER_BYTES = 56
RECORD_BYTES = 2


@dataclass(frozen=True)
class Shard:
    path: Path
    keep_count: int
    dealer_start: int
    dealer_count: int
    flags: int
    prior: bytes
    outcomes: bytes
    pair_count: int


def read_shard(path: Path) -> Shard:
    data = path.read_bytes()
    if len(data) < HEADER_BYTES or data[:8] != MAGIC:
        raise ValueError(f"{path} has an invalid Model 13.2 header")
    version, keep_count, dealer_start, dealer_count, record_bytes, flags = struct.unpack_from(
        "<6I", data, 8
    )
    prior_offset, outcome_offset, pair_count = struct.unpack_from("<3Q", data, 32)
    expected_outcome_offset = HEADER_BYTES + keep_count * 2 * 8
    expected_size = expected_outcome_offset + dealer_count * keep_count * RECORD_BYTES
    if (
        version != VERSION
        or record_bytes != RECORD_BYTES
        or flags != 1
        or prior_offset != HEADER_BYTES
        or outcome_offset != expected_outcome_offset
        or len(data) != expected_size
    ):
        raise ValueError(f"{path} has unsupported or inconsistent Model 13.2 metadata")
    outcomes = data[outcome_offset:]
    actual_pairs = sum(
        value != 0xFFFF for (value,) in struct.iter_unpack("<H", outcomes)
    )
    if actual_pairs != pair_count:
        raise ValueError(
            f"{path} declares {pair_count} outcomes but contains {actual_pairs}"
        )
    return Shard(
        path=path,
        keep_count=keep_count,
        dealer_start=dealer_start,
        dealer_count=dealer_count,
        flags=flags,
        prior=data[prior_offset:outcome_offset],
        outcomes=outcomes,
        pair_count=pair_count,
    )


def fnv1a64(path: Path) -> str:
    value = 0xCBF29CE484222325
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            for byte in chunk:
                value ^= byte
                value = (value * 0x00000100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def atomic_write(path: Path, chunks: list[bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "wb") as destination:
            for chunk in chunks:
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def atomic_json(path: Path, value: dict) -> None:
    atomic_write(path, [(json.dumps(value, indent=2, sort_keys=True) + "\n").encode()])


def merge(shard_paths: list[Path], output_dir: Path, expected_keep_count: int) -> dict:
    shards = sorted((read_shard(path) for path in shard_paths), key=lambda shard: shard.dealer_start)
    if not shards:
        raise ValueError("no Model 13.2 shards were supplied")
    first = shards[0]
    if first.keep_count != expected_keep_count:
        raise ValueError(
            f"shards contain {first.keep_count} keeps; expected {expected_keep_count}"
        )
    cursor = 0
    for shard in shards:
        if shard.keep_count != first.keep_count or shard.prior != first.prior:
            raise ValueError("Model 13.2 shards do not share identical keep priors")
        if shard.dealer_start != cursor:
            raise ValueError(
                f"Model 13.2 shard coverage jumps from {cursor} to {shard.dealer_start}"
            )
        cursor += shard.dealer_count
    if cursor != expected_keep_count:
        raise ValueError(
            f"Model 13.2 shards cover {cursor} dealer keeps; expected {expected_keep_count}"
        )

    pair_count = sum(shard.pair_count for shard in shards)
    prior_offset = HEADER_BYTES
    outcome_offset = HEADER_BYTES + expected_keep_count * 2 * 8
    header = MAGIC + struct.pack(
        "<6I3Q",
        VERSION,
        expected_keep_count,
        0,
        expected_keep_count,
        RECORD_BYTES,
        1,
        prior_offset,
        outcome_offset,
        pair_count,
    )
    asset_path = output_dir / "model132-keep-pairs.bin"
    atomic_write(asset_path, [header, first.prior, *(shard.outcomes for shard in shards)])
    expected_bytes = outcome_offset + expected_keep_count * expected_keep_count * RECORD_BYTES
    if asset_path.stat().st_size != expected_bytes:
        raise ValueError(
            f"merged Model 13.2 asset has {asset_path.stat().st_size} bytes; expected {expected_bytes}"
        )
    checksum = fnv1a64(asset_path)
    status = {
        "status": "complete",
        "mode": "exhaustive",
        "workers": len(shards),
        "canonicalKeepCount": expected_keep_count,
        "completedDealerKeeps": expected_keep_count,
        "pairOutcomes": pair_count,
        "asset": str(asset_path),
        "assetBytes": expected_bytes,
        "assetChecksum": checksum,
        "shards": [str(shard.path.parent) for shard in shards],
    }
    atomic_json(output_dir / "status.json", status)
    atomic_json(
        output_dir / "manifest.json",
        {
            **status,
            "version": 3,
            "model": "schell_table-peg_table-13.2",
            "rowIdentity": "ordered dealer four-card rank keep, pone four-card rank keep",
            "merge": "contiguous deterministic dealer-keep shards",
            "ownDiscardConditioning": (
                "runtime removes the selected two crib discards when reweighting opponent keeps"
            ),
        },
    )
    return status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shard", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--expected-keep-count", required=True, type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = merge(args.shard, args.output, args.expected_keep_count)
    print(
        f"state=complete workers={result['workers']} pairs={result['pairOutcomes']} "
        f"asset={result['asset']} checksum={result['assetChecksum']}"
    )


if __name__ == "__main__":
    main()
