import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import build_model283_opening_assets as build
import receive_model283_opening as receive
from benchmark_confidence_stop import winner

POLICY = 'a' * 64
REL = 'cut11/pone0/dealer0-lead3.bin'


def shard(depth=2):
    body = b'opaque-native-verified-body'
    h = json.dumps(dict(format=4, policy=POLICY, cut=11, scores=[0, 0], lead=3,
                        dealerPlays=depth, rows=2, sha256=hashlib.sha256(body).hexdigest())).encode()
    return struct.pack('<I', len(h)) + h + body


class AssetPipelineTests(unittest.TestCase):
    def test_canonical_domain_prioritizes_first_hands_and_excludes_only_impossible_jack_boards(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'ranking.csv'; path.write_text('pone,dealer\n15,11\n0,0\n')
            rows = list(build.coordinates(path))
            self.assertEqual(len(rows), 13*121*121-121*2)
            self.assertEqual(len(rows), len(set(rows)))
            self.assertEqual(rows[:13], [(c, 0, 2 if c == 10 else 0) for c in range(13)])
            self.assertEqual(rows[13:26], [(c, 15, 11) for c in range(13)])
            self.assertFalse(any(c == 10 and d < 2 for c, p, d in rows))

    def test_receiver_rejects_deep_wrong_context_and_corruption(self):
        receive.inspect_shard(shard(), POLICY, REL)
        for data, policy, relative in [(shard(4), POLICY, REL), (shard(), 'b'*64, REL),
                (shard() + b'x', POLICY, REL), (shard(), POLICY, '../outside.bin')]:
            with self.assertRaises(ValueError): receive.inspect_shard(data, policy, relative)

    def test_receiver_refuses_root_filesystem_and_publishes_immutable_chunk(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); data = shard(); digest = hashlib.sha256(data).hexdigest()
            with self.assertRaises(ValueError): receive.receive(root, POLICY, REL, digest, data)
            with patch.object(receive.os.path, 'ismount', return_value=True):
                result = receive.receive(root, POLICY, REL, digest, data)
                target = Path(result['path']); self.assertEqual(target.read_bytes(), data)
                receive.receive(root, POLICY, REL, digest, data)
                target.write_bytes(b'bad')
                with self.assertRaises(ValueError): receive.receive(root, POLICY, REL, digest, data)

    def test_archive_is_verified_and_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d)/'source'; dest = Path(d)/'archive'/'chunk'
            src.write_bytes(b'full evidence'); digest = build.sha(src)
            build.archive_file(src, dest, digest); build.archive_file(src, dest, digest)
            self.assertEqual(dest.read_bytes(), src.read_bytes())
            dest.write_bytes(b'changed')
            with self.assertRaises(ValueError): build.archive_file(src, dest, digest)

    def test_sequential_stopping_requires_integrity_order_and_strict_boundary(self):
        report = dict(integrity='passed', orderedPairs=100, latest=dict(pairs=100, anytime95=[.51, .55]))
        self.assertEqual(winner(report), 'candidate')
        report['latest']['anytime95'] = [.45, .49]; self.assertEqual(winner(report), 'opponent')
        report['latest']['anytime95'] = [.5, .55]; self.assertIsNone(winner(report))
        report['latest']['pairs'] = 99
        with self.assertRaises(ValueError): winner(report)
        report['integrity'] = 'failed'; self.assertIsNone(winner(report))


if __name__ == '__main__': unittest.main()
