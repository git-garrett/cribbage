#!/usr/bin/env python3
"""Add a verified evaluation recorder to an otherwise immutable running cycle.

The frozen controller still verifies its original config, Python sources,
training binary and generation lineage. Only reference-match workers use the
recorder binary. This explicit adapter avoids rewriting historical identities
or invalidating the rolling opening cache for a serialization-only change.
"""
import hashlib
import json
from pathlib import Path
import sys


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()


def verify(config_path, extension_path):
    config = json.loads(Path(config_path).read_text())
    extension = json.loads(Path(extension_path).read_text())
    if extension['schemaVersion'] != 1 or extension['configSha256'] != sha(config_path):
        raise ValueError('Evaluation extension config changed')
    if extension['trainingBinarySha256'] != sha(config['binary']):
        raise ValueError('Training binary changed')
    for path, digest in extension['files'].items():
        if sha(path) != digest: raise ValueError('Evaluation recorder file changed: '+path)
    if str(Path(__file__).resolve()) not in extension['files'] or extension['binary'] not in extension['files']:
        raise ValueError('Unpinned evaluation recorder')
    parity = json.loads(Path(extension['parity']).read_text())
    if extension['parity'] not in extension['files'] or parity['status'] != 'complete' or parity['games'] < 4:
        raise ValueError('Evaluation recorder parity is incomplete')
    if parity['binarySha256'] != sha(extension['binary']) or parity['trainingBinarySha256'] != sha(config['binary']):
        raise ValueError('Parity checked a different recorder')
    return config, extension


def worker_type(base, extension):
    class EvaluationWorker(base):
        def __init__(self, binary, root, reference=None):
            self.recording = reference is not None
            self.snapshots = [sha(Path(p)/'rust/cribbage-shadow-engine/assets/model29-generation.json')
                              for p in (root,reference)] if self.recording else []
            super().__init__(extension['binary'] if self.recording else binary,root,reference)

        def call(self, request):
            result = super().call(request)
            if self.recording:
                if result.get('benchmark',{}).get('schemaVersion') != 1:
                    raise ValueError('Evaluation worker omitted benchmark telemetry')
                result['benchmark'].update(recorderSha256=extension['files'][extension['binary']],
                    policyBinarySha256=extension['trainingBinarySha256'],snapshots=self.snapshots)
            return result
    return EvaluationWorker


def main():
    config, extension = verify(sys.argv[1],sys.argv[2])
    sys.path.insert(0,str(Path(config['repo'])/'experiments/model29'))
    import cycle
    # Keep the original cycle module and its identity checks intact. Its single
    # worker boundary is the only substitution; learning workers remain original.
    cycle.Worker = worker_type(cycle.Worker,extension)
    cycle.run(config)


if __name__ == '__main__': main()
