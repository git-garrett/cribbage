#!/usr/bin/env python3
"""Package selected role/regime beliefs and assess matched early role controls."""
import argparse
import json
from pathlib import Path
import struct

import numpy as np

import model284_score_segments as s

b, h, a = s.b, s.h, s.a
CUTS = dict(dealer=109, pone=111)


def combine_hold_roles(dealer_bytes, pone_bytes):
    """Copy selected integer records; a second quantization can change weights."""
    directory, records = bytearray(), bytearray()
    contexts = first = 0
    for wanted, body in enumerate((dealer_bytes, pone_bytes)):
        magic, version, count, _, cb, rb = struct.unpack_from('<8s5I', body)
        if (magic, version, cb, rb) != (b'M203HB01', 1, 22, 21):
            raise ValueError('unsupported hold format')
        for i in range(count):
            role, *entry = struct.unpack_from('<B13BII', body, 28+i*cb)
            if role != wanted:
                continue
            prefix, offset, size = entry[:13], entry[13], entry[14]
            blob = body[28+count*cb+offset*rb:28+count*cb+(offset+size)*rb]
            if len(blob) != size*rb:
                raise ValueError('truncated hold records')
            directory.extend(struct.pack('<B13BII', role, *prefix, first, size))
            records.extend(blob)
            first += size
            contexts += 1
    return b'M203HB01'+struct.pack('<5I', 1, contexts, first, 22, 21)+directory+records


def early_role_control(sweep, output):
    train = {k: s.decode(v) for k, v in s.prepared_data(sweep, 'train.json.gz').items()}
    smooth = {k: s.decode(v) for k, v in s.prepared_data(sweep, 'smoothing.json.gz').items()}
    cases = s.prepared_data(sweep, 'confirmation.json.gz')
    results = []
    for role, cut in CUTS.items():
        selected = s.load_profile(sweep/'output/fits'/str(cut))
        pooled_h, pooled_d, calibration = a.fit_arm(
            s.pooled_roles(s.aggregate(train, high=cut)),
            s.pooled_roles(s.aggregate(smooth, high=cut)))
        pooled = dict(hold=b.read_hold(h.pack(pooled_h)[0]), discards=pooled_d)
        folder = output/('early-pooled-'+role)
        meta = s.save_profile(folder, pooled, pooled, cut, calibration)
        b.write_json(folder/'metadata.json', meta)
        subset = [c for c in cases if c['role'] == role and c['actorStartScore'] <= cut]
        candidate = s.predict(subset, {r: selected for r in b.ROLES})
        control = s.predict(subset, {r: dict(early=pooled, late=pooled, lastEarlyScore=cut) for r in b.ROLES})
        for label, low, high in [('early', 0, cut), ('0-99', 0, 99)]:
            indices = [i for i, c in enumerate(subset) if low <= c['actorStartScore'] <= high]
            blocks = {}
            for i in indices:
                block = blocks.setdefault(subset[i]['seed'], np.zeros(4))
                block += np.r_[1, candidate[i, [6, 2, 3]] - control[i, [6, 2, 3]]]
            rows = np.array(list(blocks.values()))
            rng = np.random.default_rng(284109111)
            draws = []
            for _ in range(2000):
                total = rows[rng.integers(len(rows), size=len(rows))].sum(axis=0)
                draws.append(total[1:]/total[0])
            interval = np.quantile(draws, [.025, .975], axis=0)
            delta = (candidate[indices][:, [6, 2, 3]] - control[indices][:, [6, 2, 3]]).mean(axis=0)
            results.append(dict(role=role, window=label, lastEarlyScore=cut,
                playerHands=len(indices), seedGroups=len(rows),
                metrics={name: dict(delta=float(delta[j]), delta95=interval[:, j].tolist())
                    for j, name in enumerate(('compositeNll', 'holdNll', 'discardNll'))}))
    b.write_json(output/'early-role-assessment.json', dict(complete=True, results=results,
        comparison='role-separated minus role-pooled; matched early training/smoothing score ranges',
        limitation='Reuses prior confirmation corpus; predictive evidence, not wins.'))


def package(sweep, output, model_root):
    selection = json.loads((sweep/'output/selection.json').read_bytes())
    if any(selection['best'][role] != cut for role, cut in CUTS.items()):
        raise ValueError('selected cutoffs differ from the frozen experiment')
    selected = {r: s.load_profile(sweep/'output/fits'/str(cut)) for r, cut in CUTS.items()}
    dpath = model_root/'rust/cribbage-shadow-engine/assets/model203-opponent-discards.bin'
    dbytes = dpath.read_bytes()
    if b.sha(dbytes) != 'efd7a4594a8c42fc0e332726d44e8ababf541b3eb80c4cbf8140b9629389dbad':
        raise ValueError('suit snapshot identity differs')
    _, suits, original = b.read_discards(dbytes)
    profiles = []
    for index in range(4):
        combined = {kind: {} for kind in s.KINDS}
        for role, bit in [('dealer', 1), ('pone', 2)]:
            regime = 'late' if index & bit else 'early'
            for kind in s.KINDS:
                combined[kind].update({key: row for key, row in selected[role][regime][kind].items() if key[0] == role})
        for kind in s.KINDS:
            b.validate_rows(combined[kind], kind)
        metadata = dict(schemaVersion=2, modelVersion='28.4', suitedSection=original['suitedSection'],
            segmentationSelectionSha256=h.file_digest(sweep/'output/selection.json'),
            dealerLastEarly=109, poneLastEarly=111, profileIndex=index, suitPriorSha256=b.sha(dbytes),
            prior='neutral foundation; early role fit, late update; unchanged verified suit evidence')
        hold_sources = [(sweep/'output/fits'/str(CUTS[role])/
                         (('late' if index & bit else 'early')+'-hold.bin')).read_bytes()
                        for role, bit in [('dealer', 1), ('pone', 2)]]
        payloads = dict(hold=combine_hold_roles(*hold_sources),
                        discards=b.pack_discards(combined['discards'], suits, metadata))
        profile = dict(index=index, dealerLate=bool(index & 1), poneLate=bool(index & 2))
        for kind, body in payloads.items():
            name = f'profile-{index}-{kind}.bin'
            (output/name).write_bytes(body)
            profile[kind] = dict(file=name, sha256=b.sha(body), bytes=len(body))
        # Packing must retain the exact probabilities used to select the cutoffs.
        if b.read_hold(payloads['hold']) != combined['hold']:
            raise ValueError('hold repacking changed selected probabilities')
        if b.read_discards(payloads['discards'])[0] != combined['discards']:
            raise ValueError('discard repacking changed selected probabilities')
        profiles.append(profile)
    b.write_json(output/'manifest.json', dict(schemaVersion=1, modelVersion='28.4',
        dealerLastEarly=109, poneLastEarly=111, regimeScore='hand-start', profiles=profiles,
        selectionSha256=h.file_digest(sweep/'output/selection.json'),
        parentReportSha256=h.file_digest(sweep/'output/report.json'),
        suitPriorSha256=b.sha(dbytes), productionActivated=False))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sweep', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--model-root', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    early_role_control(args.sweep, args.output)
    package(args.sweep, args.output, args.model_root)
    b.write_json(args.output/'prepared.json', dict(complete=True,
        manifestSha256=h.file_digest(args.output/'manifest.json'),
        earlyRoleAssessmentSha256=h.file_digest(args.output/'early-role-assessment.json')))
    print('Matched early role controls assessed; four selected profiles packed and verified.')


if __name__ == '__main__':
    main()
