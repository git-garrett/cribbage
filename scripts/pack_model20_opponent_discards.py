#!/usr/bin/env python3
"""Losslessly consolidate Model 20's discard weights and empirical suit evidence."""

import argparse
import hashlib
import itertools
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "rust/cribbage-shadow-engine/assets"
SUIT_REVISION = "4e8611ca69e41849df37c39da9790bdb43249439"
SUIT_PATH = "web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json"
MAGIC = b"M20D0001"


def rank_keys(size):
    result = []
    for ranks in itertools.combinations_with_replacement(range(13), size):
        counts = [0] * 13
        for rank in ranks:
            counts[rank] += 1
        result.append("".join(map(str, counts)))
    return sorted(result)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def pack(discard_bytes, suit_bytes, legacy_bytes, source_name="model1322-opponent-discard-histograms.json"):
    discards = json.loads(discard_bytes)
    suits = json.loads(suit_bytes)
    if discards["schemaVersion"] != 1 or discards["modelVersion"] not in ("13.22", "20.0"):
        raise ValueError("unsupported conditional discard source")
    keeps, pairs = rank_keys(4), rank_keys(2)
    pair_ids = {key: index for index, key in enumerate(pairs)}
    # Retain provenance and cohort weights. Normalized rank weights are NOT counts.
    metadata = {
        "schemaVersion": 1,
        "rankWeights": "normalized cohort weights, not observation counts; raw counts retained in training evidence",
        "suitCounts": "independent historical observations; do not add to rank weights",
        "conditionalDiscards": {
            "asset": source_name,
            "sha256": digest(discard_bytes),
            **{key: value for key, value in discards.items()
               if key not in ("roles", "fallbackByRole")},
        },
        "suitedDiscards": {
            "asset": "empirical-discard-keep-14.8.bin",
            "sha256": digest(legacy_bytes),
            "countSource": SUIT_PATH,
            "countSourceCommit": SUIT_REVISION,
            "countSourceSha256": digest(suit_bytes),
            **{key: suits[key] for key in
               ("sourceGameCount", "sourceDiscardRows", "sourceModels", "filters")},
        },
    }
    encoded_metadata = json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()
    payload = bytearray(encoded_metadata)

    def row(weights):
        if not weights:
            payload.extend(struct.pack("<H", 0))
            return
        payload.extend(struct.pack("<H", len(weights)))
        for key, weight in sorted(weights.items()):
            if key not in pair_ids or not isinstance(weight, int) or not 0 < weight < 2**64:
                raise ValueError("invalid discard rank weight")
            payload.extend(struct.pack("<BQ", pair_ids[key], weight))

    if legacy_bytes[:8] != struct.pack("<4sHH", b"EDK1", 1, 2):
        raise ValueError("unsupported legacy suit asset")
    legacy_offset = 8
    for role_id, role in enumerate(("dealer", "pone")):
        source = suits["roles"][role]
        old_role, old_pairs, old_keeps = struct.unpack_from("<BHH", legacy_bytes, legacy_offset)
        legacy_offset += 5
        rates = (source["suitedDiscardRate"], source["distinctSuitedDiscardRate"])
        if (old_role, old_pairs) != (role_id, len(pairs)) or struct.unpack_from(
            "<dd", legacy_bytes, legacy_offset
        ) != rates:
            raise ValueError("historical suit source differs from installed legacy asset")
        legacy_offset += 16
        payload.extend(struct.pack("<dd", *rates))
        for key in pairs:
            entry = source["discards"][key]
            count, same, rate = entry["count"], entry["suitedCount"], entry["suitedRate"]
            if not 0 <= same <= count or not 0 <= rate <= 1:
                raise ValueError("invalid suit counts/rate")
            if rate != round(same / count, 8):
                raise ValueError("suit rate disagrees with original evidence")
            old_key = legacy_bytes[legacy_offset:legacy_offset + 13].decode()
            old_count, old_rate = struct.unpack_from("<Id", legacy_bytes, legacy_offset + 13)
            if (old_key, old_count, old_rate) != (key, count, rate):
                raise ValueError("historical suit rows differ from installed legacy asset")
            legacy_offset += 25
            payload.extend(struct.pack("<QQd", count, same, rate))
        legacy_offset += old_keeps * 17
        row(discards["fallbackByRole"][role])
        for keep in keeps:
            row(discards["roles"][role].get(keep))
    if legacy_offset != len(legacy_bytes):
        raise ValueError("unexpected trailing legacy bytes")
    header = struct.pack("<8s6I", MAGIC, 1, len(encoded_metadata), 2,
                         len(keeps), len(pairs), len(payload))
    return header + hashlib.sha256(payload).digest() + payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suit-source", type=Path,
                        help="original 14.8 JSON; defaults to its recorded Git revision")
    parser.add_argument("--output", type=Path, default=ASSETS / "model20-opponent-discards.bin")
    parser.add_argument("--evidence", type=Path,
                        default=ROOT / "training/model20-opponent-discard-evidence.json.gz")
    parser.add_argument("--check", action="store_true", help="verify reproducibility without writing")
    args = parser.parse_args()
    suit_bytes = args.suit_source.read_bytes() if args.suit_source else subprocess.check_output(
        ["git", "show", f"{SUIT_REVISION}:{SUIT_PATH}"], cwd=ROOT
    )
    from build_model20_discard_evidence import histograms, read_evidence
    discards = histograms(read_evidence(args.evidence))
    # Game indices and fingerprints live in the retained training evidence. Avoid
    # duplicating that audit ledger in the runtime asset's provenance header.
    for source in discards["sources"]:
        source.pop("includedGames", None)
    discards["evidenceSha256"] = digest(args.evidence.read_bytes())
    packed = pack(json.dumps(discards, sort_keys=True, separators=(",", ":")).encode(),
                  suit_bytes, (ASSETS / "empirical-discard-keep-14.8.bin").read_bytes(),
                  "training/model20-opponent-discard-evidence.json.gz")
    if args.check:
        if args.output.read_bytes() != packed:
            raise SystemExit("packed Model 20 discard asset is not reproducible")
    else:
        args.output.write_bytes(packed)
    print(f"Model 20 discard asset {'verified' if args.check else 'packed'}: "
          f"bytes={len(packed)} sha256={digest(packed)}")


if __name__ == "__main__":
    main()
