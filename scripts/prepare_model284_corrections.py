#!/usr/bin/env python3
"""Audit retained clean evidence and export normalized correction-builder inputs."""
import argparse
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import struct

from build_model203_hold import STRONG_VERSIONS, validate_evidence
from build_model203_decline_factors import validate as validate_decline_evidence

ROOT = Path(__file__).resolve().parents[1]
SCALE = 10**12
ROLES = ('dealer', 'pone')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def fnv(data):
    value = 14695981039346656037
    for byte in data:
        value = ((value ^ byte) * 1099511628211) & ((1 << 64) - 1)
    return f'{value:016x}'


def rank_keys(size):
    result = []
    for ranks in itertools.combinations_with_replacement(range(13), size):
        row = [ranks.count(rank) for rank in range(13)]
        if max(row) <= 4:
            result.append(''.join(map(str, row)))
    return sorted(result)


def apportion(probabilities):
    """Positive support with exactly equal row mass; fail on lost precision."""
    total = math.fsum(probabilities.values())
    if not probabilities or not math.isfinite(total) or total <= 0:
        raise ValueError('invalid probability row')
    scaled = {key: probability / total * SCALE for key, probability in probabilities.items()}
    if any(not math.isfinite(p) or p <= 0 for p in scaled.values()):
        raise ValueError('nonpositive legal probability')
    weights = {key: math.floor(p) for key, p in scaled.items()}
    remainder = SCALE - sum(weights.values())
    if not 0 <= remainder <= len(weights):
        raise ValueError('invalid apportionment remainder')
    order = sorted(weights, key=lambda key: (-(scaled[key] - weights[key]), key))
    for key in order[:remainder]:
        weights[key] += 1
    if min(weights.values()) <= 0:
        raise ValueError('integer conversion would erase legal support')
    return weights


def evidence(root, name):
    data = (root / 'training' / name).read_bytes()
    return json.loads(gzip.decompress(data)), sha(data)


def reject_excluded(models):
    if not models or any(str(model).removeprefix('schell_table-peg_table-')
                         not in STRONG_VERSIONS for model in models):
        raise ValueError('missing or excluded evidence models')


def prepare(root, output):
    assets = root / 'rust/cribbage-shadow-engine/assets'
    hold_evidence, hold_evidence_sha = evidence(root, 'model203-hold-evidence.json.gz')
    validate_evidence(hold_evidence)
    hold_meta = json.loads((assets / 'model203-hold.json').read_bytes())
    hold = (assets / 'model203-hold.bin').read_bytes()
    if sha(hold) != hold_meta['sha256'] or hold_evidence_sha != hold_meta['evidenceSha256']:
        raise ValueError('hold source identity mismatch')
    reject_excluded(hold_meta['approvedStrongVersions'])
    magic, version, directories, records, entry_size, record_size = struct.unpack_from('<8s5I', hold)
    if (magic, version, directories, entry_size, record_size, len(hold)) != (
            b'M203HB01', 1, 1120, 22, 21, 28 + directories * 22 + records * 21):
        raise ValueError('invalid complete hold asset')
    keeps, pairs = rank_keys(4), rank_keys(2)
    roles = {}
    record_start = 28 + directories * 22
    for i in range(directories):
        role, *fields = struct.unpack_from('<B13BII', hold, 28 + i * 22)
        prefix, first, count = fields[:13], fields[13], fields[14]
        if sum(prefix) == 0:
            rows = {}
            for j in range(first, first + count):
                *ranks, weight = struct.unpack_from('<13BQ', hold, record_start + j * 21)
                rows[''.join(map(str, ranks))] = weight
            if set(rows) != set(keeps) or min(rows.values()) <= 0:
                raise ValueError('incomplete opening support')
            roles[ROLES[role]] = rows
    if set(roles) != set(ROLES):
        raise ValueError('missing opening role')
    if min(weight for row in roles.values() for weight in row.values()) < 256:
        raise ValueError('known-card conditioning could erase a keep weight')
    prior = canonical(dict(version=1, roles=roles))

    discards = (assets / 'model203-opponent-discards.bin').read_bytes()
    magic, version, meta_size, role_count, keep_count, pair_count, payload_size = struct.unpack_from('<8s6I', discards)
    if ((magic, version, role_count, keep_count, pair_count, payload_size) !=
            (b'M203OD01', 2, 2, 1820, 91, len(discards) - 64)
            or sha(discards[64:]) != discards[32:64].hex()):
        raise ValueError('invalid conditional discard asset')
    discard_meta = json.loads(discards[64:64 + meta_size])
    discard_evidence, discard_evidence_sha = evidence(root, 'model203-opponent-discard-evidence.json.gz')
    discard_evidence_sha = sha(canonical(discard_evidence).rstrip(b'\n'))
    if discard_evidence_sha != discard_meta['evidenceSha256']:
        raise ValueError('discard evidence identity mismatch')
    reject_excluded(discard_evidence['counts']['train'])
    baseline, baseline_sha = evidence(root, 'model20-opponent-discard-evidence.json.gz')
    if baseline_sha != discard_evidence['baselineEvidenceSha256']:
        raise ValueError('discard baseline identity mismatch')
    reject_excluded(baseline['countsByModel'])
    offset = 64 + meta_size + 2 * (16 + 91 * 24)
    histogram = dict(schemaVersion=1, modelVersion='20.0', roles={}, fallbackByRole={})
    max_error = 0.0
    minimum_weight = SCALE
    for role in ROLES:
        histogram['roles'][role] = {}
        histogram['fallbackByRole'][role] = {}
        for keep in keeps:
            values = struct.unpack_from('<91d', discards, offset)
            offset += 91 * 8
            legal = {pair for pair in pairs if all(int(a) + int(b) <= 4 for a, b in zip(keep, pair))}
            row = dict(zip(pairs, values))
            if (any(not math.isfinite(p) or p < 0 for p in values)
                    or {key for key, p in row.items() if p > 0} != legal
                    or abs(math.fsum(values) - 1) > 1e-12):
                raise ValueError('incomplete or unnormalized discard support')
            weights = apportion({key: row[key] for key in legal})
            minimum_weight = min(minimum_weight, min(weights.values()))
            max_error = max(max_error, max(abs(weights[key] / SCALE - row[key]) for key in weights))
            histogram['roles'][role][keep] = weights
    if offset != len(discards):
        raise ValueError('trailing conditional data')
    # Every physical combination ratio is >= 1/16 for two-card discards.
    if minimum_weight < 16:
        raise ValueError('known-card conditioning could round legal discard support to zero')

    factors = (assets / 'model203-decline-factors.json').read_bytes()
    factor_meta = json.loads(factors)
    decline, decline_sha = evidence(root, 'model203-decline-qualified-evidence.json.gz')
    validate_decline_evidence(decline, assets / 'model1322-decline-factors.json')
    decline_sha = sha(canonical(decline).rstrip(b'\n'))
    reject_excluded(decline['countsByModel'])
    if (factor_meta['evidenceSha256'] != decline_sha
            or factor_meta['selectionPolicy'] != decline['selectionPolicy']['id']
            or any(p <= 0 or p >= 1_000_000 for row in factor_meta['factors'].values() for p in row)):
        raise ValueError('invalid qualified decline evidence')
    # Additional attribution for the correction builder's provenance gate.
    factor_meta['modelCohort'] = dict(includedModels=sorted(decline['countsByModel']))
    exports = {'beliefs.bin': hold, 'factors.json': canonical(factor_meta),
               'keep-prior.json': prior, 'discard-histograms.json': canonical(histogram)}
    output.mkdir(parents=True, exist_ok=True)
    for name, data in exports.items():
        (output / name).write_bytes(data)
    assessment = json.loads((root / 'training/model203-opponent-discard-assessment.json').read_bytes())
    report = dict(schemaVersion=1, modelVersion='28.4',
                  inputChecksums=[fnv(exports[name]) for name in exports] + ['0000000000000000'],
                  inputs={name: {'sha256': sha(data), 'bytes': len(data)} for name, data in exports.items()},
                  qualifiedDeclineFactors=factor_meta,
                  evidenceSha256=dict(hold=hold_evidence_sha, discards=discard_evidence_sha, decline=decline_sha),
                  holdGames=hold_meta['newCompletedGames'], holdHandsByModel=hold_meta['newActorHandsByModel'],
                  strong13PlusHoldHands=sum(n for model, n in hold_meta['newActorHandsByModel'].items()
                                           if int(model.split('-')[-1].split('.')[0]) >= 13),
                  discardGames=assessment['sourceGames'], discardTrainingObservations=assessment['observationsBySplit']['train'],
                  discardTrainingByModel=assessment['models'], declineGames=len(decline['games']),
                  strong13PlusDiscardObservations=sum(n for model, n in assessment['models'].items()
                                                      if int(model.split('.')[0]) >= 13),
                  declineHeldOpportunities=sum(row[0] + row[1] for rows in decline['countsByModel'].values() for row in rows),
                  declineModels=sorted(decline['countsByModel']),
                  openingSupportPerRole={role: len(roles[role]) for role in ROLES},
                  positiveDiscardCellsPerRole=165295, maximumQuantizationError=max_error,
                  minimumDiscardWeight=minimum_weight,
                  scope='Adequate aggregate evidence for a test candidate; sparse cells use smoothing. No strength certification.',
                  buildCost='Historical full build about four days on six workers; expanded support may take longer. Not launched.')
    (output / 'inputs.json').write_bytes(canonical(report))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.root, args.output)
    print(json.dumps({key: result[key] for key in ('holdGames', 'discardGames', 'declineGames',
                                                'maximumQuantizationError', 'minimumDiscardWeight')}))
