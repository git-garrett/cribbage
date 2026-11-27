#!/usr/bin/env python3
"""Supervised, nested-tuning search of last-early scores 100 through 120.

No games, inherited probabilities, production activation, or action tables.
Each player-hand has equal weight: half discard NLL, half mean hold-prefix NLL.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import gzip
import json
from pathlib import Path
import sqlite3

import numpy as np

import model284_early_ablation as a

b, h = a.b, a.h
KINDS = ('hold', 'discards')
BREAKS = tuple(range(100, 121))


def empty():
    return {kind: defaultdict(Counter) for kind in KINDS}


def fold(seed, protocol_seed):
    # One assignment for both orientations, roles and all hands of a seed.
    return 'smoothing' if int(b.sha(f'{protocol_seed}:smooth:{seed}'.encode())[:8], 16) % 2 == 0 else 'selection'


def encode(rows):
    return {kind: [dict(role=r, context=k, counts=dict(row)) for (r, k), row in sorted(values.items())]
            for kind, values in rows.items()}


def decode(rows):
    return {kind: {(row['role'], row['context']): Counter(row['counts']) for row in values}
            for kind, values in rows.items()}


def read_gz(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def write_gz(path, value):
    path.write_bytes(gzip.compress(b.canonical(value), mtime=0))


def aggregate(bins, low=0, high=120):
    result = empty()
    for score, rows in bins.items():
        if low <= int(score) <= high:
            for kind in KINDS:
                for key, row in rows[kind].items():
                    result[kind][key].update(row)
    return result


def pooled_roles(rows):
    result = empty()
    for kind in KINDS:
        shared = defaultdict(Counter)
        for (_, context), row in rows[kind].items():
            shared[context].update(row)
        for context, row in shared.items():
            for role in b.ROLES:
                result[kind][(role, context)] = Counter(row)
    return result


def prepare(root):
    protocol = json.loads((root/'protocol.json').read_bytes())
    corpus = root/'frozen/corpus'
    manifest, evidence, expected = a.checked_corpus(corpus)
    observed = {part: {kind: defaultdict(Counter) for kind in expected[part]} for part in b.SPLITS}
    counts = {part: defaultdict(empty) for part in ('train', 'smoothing')}
    cases = dict(selection=[], confirmation=[])
    games = defaultdict(list)
    seed_sets = defaultdict(set)
    for game in evidence['games']:
        games[game['source']].append(game)
    for source in evidence['sources']:
        path = corpus/'sources'/source['snapshot']
        if h.file_digest(path) != source['sha256']:
            raise ValueError('snapshot identity differs')
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)) as db:
            db.row_factory = sqlite3.Row
            if b.run_provenance(db, source['engines']) != source['runProvenance']:
                raise ValueError('source qualification differs')
            for game in games[source['snapshot']]:
                original = game['partition']
                part = ('train' if original == 'train' else 'confirmation' if original == 'test'
                        else fold(game['seed'], protocol['seed']))
                seed_sets[part].add(game['seed'])
                for hand in h.game_hands(db, game['gameId']):
                    dealt = [bytes(hand[name+'_dealt'] or b'') for name in ('left', 'right')]
                    kept = [bytes(hand[name+'_keep'] or b'') for name in ('left', 'right')]
                    physical = dealt[0]+dealt[1]+bytes([hand['cut_card']])
                    if len(physical) != 13 or len(set(physical)) != 13 or max(physical) >= 52:
                        raise ValueError('invalid physical hand')
                    for side, engine in enumerate(game['engines']):
                        score = hand['start_left_score'] if side == 0 else hand['start_right_score']
                        other = hand['start_right_score'] if side == 0 else hand['start_left_score']
                        is_late = b.late(score)
                        observations = h.observations(hand, side)
                        role = observations[0][0]
                        keep = h.rank_key(kept[side])
                        discard = h.rank_key(set(dealt[side])-set(kept[side]))
                        prefix = '' if is_late else 'ordinary-'
                        observed[original][prefix+'discards'][(role, keep)][discard] += 1
                        for _, played, remaining in observations:
                            observed[original][prefix+'hold'][(role, played)][remaining] += 1
                        if part in counts:
                            # Below 100 no requested boundary can separate cases.
                            rows = counts[part][str(max(score, 99))]
                            rows['discards'][(role, keep)][discard] += 1
                            for _, played, remaining in observations:
                                rows['hold'][(role, played)][remaining] += 1
                        else:
                            cases[part].append(dict(seed=game['seed'], model=engine, role=role,
                                actorStartScore=score, opponentStartScore=other,
                                ownSix=h.rank_key(dealt[1-side]), cutRank=hand['cut_card']//4,
                                keep=keep, discard=discard,
                                hold=[dict(prefix=p, remaining=r) for _, p, r in observations]))
    for part in b.SPLITS:
        for kind in expected[part]:
            if dict(observed[part][kind]) != expected[part][kind]:
                raise ValueError('score regrouping differs from frozen evidence')
    output = root/'output/prepared'
    output.mkdir(parents=True, exist_ok=True)
    for part, bins in counts.items():
        write_gz(output/(part+'.json.gz'), {score: encode(rows) for score, rows in bins.items()})
    for part, values in cases.items():
        write_gz(output/(part+'.json.gz'), values)
    parts = list(seed_sets)
    if any(seed_sets[left] & seed_sets[right] for i,left in enumerate(parts) for right in parts[i+1:]):
        raise ValueError('seed overlap across experiment partitions')
    b.write_json(output/'summary.json', dict(complete=True, parentEvidenceSha256=manifest['evidenceSha256'],
        cases={part: len(values) for part, values in cases.items()},
        seedGroups={part: len(seeds) for part, seeds in seed_sets.items()},
        files={p.name: h.file_digest(p) for p in output.glob('*.gz')}))


def prepared_data(root, name):
    folder = root/'output/prepared'
    summary = json.loads((folder/'summary.json').read_bytes())
    if h.file_digest(folder/name) != summary['files'][name]:
        raise ValueError('prepared input differs from its identity')
    return read_gz(folder/name)


def late_update(early, training, smoothing):
    result, audits = {}, []
    for kind in KINDS:
        result[kind] = {}
        for role in b.ROLES:
            for length in (range(4) if kind == 'hold' else (4,)):
                priors = {k: p for k, p in early[kind].items()
                          if k[0] == role and sum(map(int, k[1])) == length}
                n = sum(sum(smoothing[kind].get(k, {}).values()) for k in priors)
                if n:
                    rows, audit = a.fit_group(priors, training[kind], smoothing[kind])
                else:
                    rows, audit = priors, dict(selected=dict(strength=None), tuningObservations=0,
                                               reason='no smoothing observations; retain early prior')
                result[kind].update(rows)
                audits.append(dict(kind=kind, role=role, prefixLength=length, **audit))
        b.validate_rows(result[kind], kind)
    return result, audits


def save_profile(folder, early, late, last_early, calibration):
    folder.mkdir(parents=True, exist_ok=True)
    identities = {}
    for name, model in [('early', early), ('late', late)]:
        hold_bytes, error = h.pack(model['hold'])
        (folder/(name+'-hold.bin')).write_bytes(hold_bytes)
        model['hold'] = b.read_hold(hold_bytes)
        write_gz(folder/(name+'-discards.json.gz'),
                 [dict(role=r, keep=k, probabilities=p) for (r, k), p in sorted(model['discards'].items())])
        identities[name] = dict(holdQuantizationError=error,
            files={suffix: h.file_digest(folder/(name+suffix)) for suffix in ('-hold.bin', '-discards.json.gz')})
    return dict(lastEarlyScore=last_early, identities=identities, calibration=calibration)


def load_profile(folder):
    meta = json.loads((folder/'metadata.json').read_bytes())
    result = dict(lastEarlyScore=meta['lastEarlyScore'])
    for name in ('early', 'late'):
        for suffix, expected in meta['identities'][name]['files'].items():
            if h.file_digest(folder/(name+suffix)) != expected:
                raise ValueError('fitted profile differs from its identity')
        result[name] = dict(hold=b.read_hold((folder/(name+'-hold.bin')).read_bytes()),
                           discards={(r['role'], r['keep']): r['probabilities']
                                     for r in read_gz(folder/(name+'-discards.json.gz'))})
    return result


def predict(cases, profiles):
    # Columns: role, hand-start score, mean hold NLL, discard NLL,
    # mean hold Brier, discard Brier, equal-head composite NLL.
    result = np.zeros((len(cases), 7))
    groups = defaultdict(list)
    for index, case in enumerate(cases):
        result[index, :2] = [b.ROLES.index(case['role']), case['actorStartScore']]
        groups[('discards', case['role'], case['keep'])].append((index, case, case['discard']))
        for obs in case['hold']:
            groups[('hold', case['role'], obs['prefix'])].append((index, case, obs['remaining']))
    for (kind, role, context), observations in groups.items():
        profile = profiles[role]
        early, late = profile['early'][kind][(role, context)], profile['late'][kind][(role, context)]
        keys = sorted(early)
        if set(keys) != set(late):
            raise ValueError('regimes differ in legal support')
        key_index = {k: i for i, k in enumerate(keys)}
        priors = [np.array([row[k] for k in keys]) for row in (early, late)]
        for offset in range(0, len(observations), 128):
            chunk = observations[offset:offset+128]
            inputs = [case for _, case, _ in chunk]
            late_mask = np.array([case['actorStartScore'] > profile['lastEarlyScore'] for case in inputs])
            probabilities = np.where(late_mask[:, None], priors[1], priors[0])
            weights = a.conditioned_batch(keys, context, inputs, kind)*probabilities
            mass = weights.sum(axis=1)
            if not np.all(np.isfinite(mass)) or np.any(mass <= 0):
                raise ValueError('invalid predictive mass')
            p = weights/mass[:, None]
            actual = p[np.arange(len(chunk)), [key_index[truth] for _, _, truth in chunk]]
            if np.any(actual <= 0):
                raise ValueError('observed truth lost support')
            loss, brier = -np.log(actual), 1-2*actual+np.einsum('ij,ij->i', p, p)
            for j, (index, case, _) in enumerate(chunk):
                column = 2 if kind == 'hold' else 3
                divisor = len(case['hold']) if kind == 'hold' else 1
                result[index, column] += loss[j]/divisor
                result[index, column+2] += brier[j]/divisor
    result[:, 6] = (result[:, 2]+result[:, 3])/2
    return result


def fit(root, name):
    prepared = root/'output/prepared'
    train = {score: decode(rows) for score, rows in prepared_data(root,'train.json.gz').items()}
    smooth = {score: decode(rows) for score, rows in prepared_data(root,'smoothing.json.gz').items()}
    cut = 120 if name == 'role-pooled' else int(name)
    if cut not in BREAKS:
        raise ValueError('unsupported break')
    first, target = aggregate(train, high=cut), aggregate(smooth, high=cut)
    if name == 'role-pooled':
        first, target = pooled_roles(first), pooled_roles(target)
    holds, discards, audit = a.fit_arm(first, target)
    early = dict(hold=holds, discards=discards)
    # Late priors use the exact serialized early hold probabilities.
    early['hold'] = b.read_hold(h.pack(early['hold'])[0])
    if cut < 120:
        late, late_audit = late_update(early, aggregate(train, low=cut+1), aggregate(smooth, low=cut+1))
    else:
        late, late_audit = dict(early), []
    folder = root/'output/fits'/name
    metadata = save_profile(folder, early, late, cut, dict(early=audit, late=late_audit))
    cases = prepared_data(root,'selection.json.gz')
    values = predict(cases, {r: dict(early=early, late=late, lastEarlyScore=cut) for r in b.ROLES})
    np.savez_compressed(folder/'selection.npz', values=values)
    metadata.update(complete=True, selectionCasesSha256=h.file_digest(prepared/'selection.json.gz'),
                    selectionSha256=h.file_digest(folder/'selection.npz'))
    b.write_json(folder/'metadata.json', metadata)


def point(values, mask=None):
    if mask is None:
        mask = np.ones(len(values), dtype=bool)
    roles = [values[mask & (values[:, 0] == role), 6].mean() for role in (0, 1)]
    return [float(v) for v in roles]+[float(np.mean(roles))]


def select(root):
    cases = prepared_data(root,'selection.json.gz')
    values, curves = [], []
    for cut in BREAKS:
        folder = root/'output/fits'/str(cut)
        meta = json.loads((folder/'metadata.json').read_bytes())
        if h.file_digest(folder/'selection.npz') != meta['selectionSha256']:
            raise ValueError('selection identity differs')
        if h.file_digest(root/'output/prepared/selection.json.gz') != meta['selectionCasesSha256']:
            raise ValueError('selection scores refer to different cases')
        table = np.load(folder/'selection.npz', allow_pickle=False)['values']
        expected = np.array([[b.ROLES.index(c['role']),c['actorStartScore']] for c in cases])
        if len(table) != len(cases) or not np.array_equal(table[:,:2],expected):
            raise ValueError('selection case count differs')
        values.append(table)
        curves.append(dict(lastEarlyScore=cut, dealer=point(table)[0], pone=point(table)[1],
                           common=point(table)[2], score100to120=point(table, table[:, 1] >= 100)))
    scores = np.array([[c['dealer'], c['pone'], c['common']] for c in curves])
    # Prefer the no-split control on an exact tie.
    indices = [min(range(len(BREAKS)), key=lambda i: (scores[i, k], BREAKS[i] != 120, BREAKS[i])) for k in range(3)]
    seed_keys = sorted({case['seed'] for case in cases})
    seed_index = {seed: i for i, seed in enumerate(seed_keys)}
    counts = np.zeros((len(seed_keys), 2))
    loss = np.zeros((len(BREAKS), len(seed_keys), 2))
    for j, case in enumerate(cases):
        s, r = seed_index[case['seed']], b.ROLES.index(case['role'])
        counts[s, r] += 1
        for i, table in enumerate(values):
            loss[i, s, r] += table[j, 6]
    rng = np.random.default_rng(int(json.loads((root/'protocol.json').read_bytes())['seed']))
    draws = []
    for _ in range(2000):
        sample = rng.integers(len(seed_keys), size=len(seed_keys))
        means = loss[:, sample].sum(axis=1)/counts[sample].sum(axis=0)
        draws.append(np.column_stack([means, means.mean(axis=1)]))
    draws = np.array(draws)
    uncertainty = {}
    for k, label in enumerate(('dealer', 'pone', 'common')):
        best = indices[k]
        delta = draws[:, :, k]-draws[:, best, k, None]
        intervals = np.quantile(delta, [.025, .975], axis=0)
        preference = [len(BREAKS)-1]+list(range(len(BREAKS)-1))
        winners = np.bincount(np.array(preference)[draws[:, preference, k].argmin(axis=1)], minlength=len(BREAKS))
        uncertainty[label] = dict(best=BREAKS[best],
            exploratoryIntervals=[dict(lastEarlyScore=cut, delta=float(scores[i, k]-scores[best, k]),
                delta95=intervals[:, i].tolist(), bootstrapBestFraction=float(winners[i]/len(draws))) for i, cut in enumerate(BREAKS)])
    result = dict(complete=True, objective='equal roles; per player-hand half discard NLL + half mean hold-prefix NLL; all scores fixed',
                  best=dict(dealer=BREAKS[indices[0]], pone=BREAKS[indices[1]], common=BREAKS[indices[2]]),
                  curves=curves, uncertainty=uncertainty, selectionSeedGroups=len(seed_keys),
                  note='Selection intervals are exploratory and do not certify a unique exact optimum.')
    b.write_json(root/'output/selection.json', result)


def paired_report(cases, baseline, candidate, seed):
    rng = np.random.default_rng(seed)
    reports = []
    for window, low, high in [('all', 0, 120), ('0-99', 0, 99), ('100-120', 100, 120), ('100-110', 100, 110), ('111-120', 111, 120)]:
        for role in (0, 1, None):
            mask = (baseline[:, 1] >= low) & (baseline[:, 1] <= high)
            if role is not None:
                mask &= baseline[:, 0] == role
            groups = defaultdict(lambda: np.zeros(6))
            for i in np.flatnonzero(mask):
                groups[cases[i]['seed']] += np.r_[1, candidate[i, [6, 2, 3, 4, 5]]-baseline[i, [6, 2, 3, 4, 5]]]
            blocks = np.array(list(groups.values()))
            draws = []
            for _ in range(2000):
                total = blocks[rng.integers(len(blocks), size=len(blocks))].sum(axis=0)
                draws.append(total[1:]/total[0])
            interval = np.quantile(draws, [.025, .975], axis=0)
            delta = (candidate[mask][:, [6, 2, 3, 4, 5]]-baseline[mask][:, [6, 2, 3, 4, 5]]).mean(axis=0)
            reports.append(dict(window=window, role='both' if role is None else b.ROLES[role], playerHands=int(mask.sum()), seedGroups=len(blocks),
                metrics={name: dict(delta=float(delta[j]), delta95=interval[:, j].tolist())
                         for j, name in enumerate(('compositeNll', 'holdNll', 'discardNll', 'holdBrier', 'discardBrier'))}))
    return reports


def confirm(root):
    selection = json.loads((root/'output/selection.json').read_bytes())
    cases = prepared_data(root,'confirmation.json.gz')
    base = load_profile(root/'output/fits/120')
    pooled = load_profile(root/'output/fits/role-pooled')
    common = load_profile(root/'output/fits'/str(selection['best']['common']))
    separate = {role: load_profile(root/'output/fits'/str(selection['best'][role])) for role in b.ROLES}
    values = dict(baseline=predict(cases, {r: base for r in b.ROLES}),
                  rolePooled=predict(cases, {r: pooled for r in b.ROLES}),
                  common=predict(cases, {r: common for r in b.ROLES}),
                  separate=predict(cases, separate))
    seed = int(json.loads((root/'protocol.json').read_bytes())['seed'])
    comparisons = {name: paired_report(cases, values['baseline'], values[name], seed) for name in ('common', 'separate')}
    comparisons['roleSeparation'] = paired_report(cases, values['rolePooled'], values['baseline'], seed)
    comparisons['separateVsCommon'] = paired_report(cases, values['common'], values['separate'], seed)
    result = dict(complete=True, selected=selection['best'], comparisons=comparisons,
                  playerHands=len(cases), wholeGamesRun=0, productionActivated=False,
                  limitation='Test seeds excluded from fitting and selection, but this corpus was examined in earlier 111/early-only pilots; this is not new blind evidence.')
    b.write_json(root/'output/confirmation.json', result)


def finish(root):
    selection = json.loads((root/'output/selection.json').read_bytes())
    confirmation = json.loads((root/'output/confirmation.json').read_bytes())
    for name in [str(cut) for cut in BREAKS]+['role-pooled']:
        load_profile(root/'output/fits'/name)
    result = dict(complete=True, protocol=json.loads((root/'protocol.json').read_bytes()),
                  selection=selection, confirmation=confirmation,
                  inputSummary=json.loads((root/'output/prepared/summary.json').read_bytes()))
    b.write_json(root/'output/report.json', result)
    lines = ['Score segmentation experiment', 'Break = last early score; 120 = no split.',
             'Selected on tuning data: '+json.dumps(selection['best'])]
    for name, rows in confirmation['comparisons'].items():
        for row in rows:
            if row['window'] == 'all':
                lines.append(name+' '+row['role']+': '+json.dumps(row['metrics']['compositeNll']))
    (root/'output/report.txt').write_text('\n'.join(lines)+'\n')


def verify(root, directory=None):
    output = directory or root/'output'
    report = json.loads((output/'report.json').read_bytes())
    if not report['complete'] or not report['confirmation']['complete']:
        raise ValueError('experiment incomplete')
    protocol = json.loads((root/'protocol.json').read_bytes())
    if report['protocol'] != protocol:
        raise ValueError('report protocol differs')
    for name in [str(cut) for cut in BREAKS]+['role-pooled']:
        folder = output/'fits'/name
        load_profile(folder)
        meta = json.loads((folder/'metadata.json').read_bytes())
        if h.file_digest(folder/'selection.npz') != meta['selectionSha256']:
            raise ValueError('fitted selection output differs')
    summary = json.loads((output/'prepared/summary.json').read_bytes())
    for name, expected in summary['files'].items():
        if h.file_digest(output/'prepared'/name) != expected:
            raise ValueError('prepared data differs')
    marker = dict(complete=True, reportSha256=h.file_digest(output/'report.json'))
    if directory is None:
        b.write_json(output/'verified.json', marker)
    elif json.loads((output/'verified.json').read_bytes()) != marker:
        raise ValueError('durable verification marker differs')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'fit', 'select', 'confirm', 'finish', 'verify'])
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--name')
    parser.add_argument('--directory',type=Path)
    args = parser.parse_args()
    np.seterr(all='raise')
    protocol = json.loads((args.root/'protocol.json').read_bytes())
    for name, expected in protocol.get('frozenFiles',{}).items():
        if h.file_digest(args.root/'frozen'/name) != expected:
            raise ValueError('frozen code/configuration differs')
    if args.stage == 'fit':
        fit(args.root, args.name)
    elif args.stage == 'verify':
        verify(args.root,args.directory)
    else:
        globals()[args.stage](args.root)
    print(args.stage+' complete'+(' '+args.name if args.name else ''))


if __name__ == '__main__':
    main()
