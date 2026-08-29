#!/usr/bin/env python3

import struct
import tempfile
import unittest
from pathlib import Path

from merge_model132_pair_shards import HEADER_BYTES, MAGIC, RECORD_BYTES, VERSION, merge


def write_shard(path: Path, keep_count: int, start: int, rows: list[list[int]]) -> None:
    prior = bytes(range(keep_count * 2 * 8))
    outcomes = b"".join(
        struct.pack("<H", value) for row in rows for value in row
    )
    pairs = sum(value != 0xFFFF for row in rows for value in row)
    outcome_offset = HEADER_BYTES + len(prior)
    header = MAGIC + struct.pack(
        "<6I3Q",
        VERSION,
        keep_count,
        start,
        len(rows),
        RECORD_BYTES,
        1,
        HEADER_BYTES,
        outcome_offset,
        pairs,
    )
    path.parent.mkdir(parents=True)
    path.write_bytes(header + prior + outcomes)


class MergeModel132PairShardsTest(unittest.TestCase):
    def test_merges_contiguous_rows_and_pair_count(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "shard-00" / "model132-keep-pairs.bin"
            second = root / "shard-01" / "model132-keep-pairs.bin"
            write_shard(first, 3, 0, [[1, 0xFFFF, 2], [3, 4, 0xFFFF]])
            write_shard(second, 3, 2, [[5, 6, 7]])

            result = merge([second, first], root / "merged", 3)
            data = (root / "merged" / "model132-keep-pairs.bin").read_bytes()

            self.assertEqual(result["pairOutcomes"], 7)
            self.assertEqual(struct.unpack_from("<2I", data, 16), (0, 3))
            outcome_offset = struct.unpack_from("<Q", data, 40)[0]
            self.assertEqual(
                [value for (value,) in struct.iter_unpack("<H", data[outcome_offset:])],
                [1, 0xFFFF, 2, 3, 4, 0xFFFF, 5, 6, 7],
            )

    def test_rejects_gap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "shard-00" / "model132-keep-pairs.bin"
            second = root / "shard-01" / "model132-keep-pairs.bin"
            write_shard(first, 3, 0, [[1, 2, 3]])
            write_shard(second, 3, 2, [[4, 5, 6]])
            with self.assertRaisesRegex(ValueError, "coverage jumps"):
                merge([first, second], root / "merged", 3)


if __name__ == "__main__":
    unittest.main()
