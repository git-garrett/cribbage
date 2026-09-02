#!/usr/bin/env python3
"""Independently verify a merged Model 13.22 correction asset."""

from __future__ import annotations

import argparse
import json
import mmap
import os
import struct
import tempfile
from pathlib import Path


MAGIC = b"M1322C01"
VERSION = 1
KEEP_COUNT = 1820
ROLE_ROWS = 165_295
RANKS = 13
HEADER_BYTES = 128
ACCUMULATOR_BYTES = 48
EXPECTED_BYTES = HEADER_BYTES + 2 * ROLE_ROWS * ACCUMULATOR_BYTES + ROLE_ROWS * RANKS * 2


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


def fnv1a64(path: Path) -> str:
    value = 0xCBF29CE484222325
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            for byte in chunk:
                value ^= byte
                value = (value * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{value:016x}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    actual_size = args.asset.stat().st_size
    if actual_size != EXPECTED_BYTES:
        raise ValueError(f"asset has {actual_size} bytes; expected {EXPECTED_BYTES}")

    with args.asset.open("rb") as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
        if data[:8] != MAGIC:
            raise ValueError("invalid Model 13.22 correction magic")
        version, rows, dealer_start, dealer_count, pone_start, pone_count, completed = struct.unpack_from(
            "<7I", data, 8
        )
        if (version, rows) != (VERSION, ROLE_ROWS):
            raise ValueError("invalid Model 13.22 correction version or row count")
        if (dealer_start, dealer_count, pone_start, pone_count, completed) != (
            0,
            KEEP_COUNT,
            0,
            KEEP_COUNT,
            KEEP_COUNT,
        ):
            raise ValueError("merged Model 13.22 correction ranges are incomplete")

        for role in range(2):
            role_offset = HEADER_BYTES + role * ROLE_ROWS * ACCUMULATOR_BYTES
            for row in range(ROLE_ROWS):
                weight = int.from_bytes(
                    data[
                        role_offset + row * ACCUMULATOR_BYTES + 32 :
                        role_offset + row * ACCUMULATOR_BYTES + 48
                    ],
                    "little",
                )
                if weight == 0:
                    raise ValueError(f"role {role} row {row} has zero weight")

        lead_offset = HEADER_BYTES + 2 * ROLE_ROWS * ACCUMULATOR_BYTES
        for row in range(ROLE_ROWS):
            union = 0
            for rank in range(RANKS):
                (mask,) = struct.unpack_from("<H", data, lead_offset + (row * RANKS + rank) * 2)
                if mask & ~0x1FFF:
                    raise ValueError(f"row {row} rank {rank} has an invalid cut bit")
                if union & mask:
                    raise ValueError(f"row {row} has overlapping pone lead masks")
                union |= mask
            if union.bit_count() not in (12, 13):
                raise ValueError(f"row {row} has incomplete pone lead cut coverage")

    checksum = fnv1a64(args.asset)
    expected_manifest = {
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "status": "complete",
        "dealerKeeps": KEEP_COUNT,
        "poneKeeps": KEEP_COUNT,
        "roleRows": ROLE_ROWS,
        "bytes": EXPECTED_BYTES,
        "outputChecksum": checksum,
        "durableObservationActionTable": False,
    }
    for field, expected in expected_manifest.items():
        if manifest.get(field) != expected:
            raise ValueError(f"manifest {field} is {manifest.get(field)!r}; expected {expected!r}")

    result = {
        "schemaVersion": 1,
        "modelVersion": "13.22",
        "status": "complete",
        "asset": str(args.asset),
        "bytes": actual_size,
        "outputChecksum": checksum,
        "dealerRowsWithWeight": ROLE_ROWS,
        "poneRowsWithWeight": ROLE_ROWS,
        "poneLeadRowsVerified": ROLE_ROWS,
        "durableObservationActionTable": False,
    }
    atomic_json(args.output, result)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
