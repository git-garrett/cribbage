#!/usr/bin/env python3
"""Seed-held-out conditional discard calibration and indexed Model 20.3 asset.

Requires numpy. Raw counts and exact game provenance are retained separately from
runtime probabilities. Hold-out seeds stay excluded on subsequent refreshes.
"""
import argparse
from collections import Counter
import gzip
import itertools
import json
from pathlib import Path
import sqlite3
import struct

import numpy as np

from build_model203_hold import STRONG_VERSIONS, canonical, digest, file_digest, keys, rank_key
from build_model203_crib import HAND_FIELDS, actor_discard
from learning_model_policy import model_version

ROLES = ('dealer', 'pone')
KEEPS, PAIRS = keys(4), keys(2)
KI, DI = {k: i for i, k in enumerate(KEEPS)}, {k: i for i, k in enumerate(PAIRS)}
K = np.array([list(map(int, k)) for k in KEEPS])
D = np.array([list(map(int, d)) for d in PAIRS])
A, B = np.array([[r for r, n in enumerate(d) for _ in range(n)] for d in D]).T
BASE = np.where(A == B, (4-K[:, A])*(3-K[:, A])/2, (4-K[:, A])*(4-K[:, B]))
LEGAL = BASE > 0
FULL = np.where(A == B, 6., 16.)
MAGIC = b'M203OD01'
SPLIT_RULE = 'sha256(model203-opponent-discards-v1:stored_seed) first 8 hex modulo 10; 0 tune, 1 test, else train'


def split(seed):
    bucket = int(digest(('model203-opponent-discards-v1:' + str(seed)).encode())[:8], 16) % 10
    return 'tune' if bucket == 0 else 'test' if bucket == 1 else 'train'


def eligible(engine):
    return model_version(engine) in STRONG_VERSIONS


def empty():
    return dict(schemaVersion=1, splitRule=SPLIT_RULE, counts={}, heldout=[], games={}, sources=[])


def validate(value):
    if value['schemaVersion'] != 1 or value['splitRule'] != SPLIT_RULE:
        raise ValueError('unsupported conditional discard evidence')
    for partition, models in value['counts'].items():
        if partition not in ('train', 'tune', 'test'):
            raise ValueError('unknown partition')
        for engine, roles in models.items():
            if not eligible(engine):
                raise ValueError('ineligible inherited actor: ' + engine)
            for role, rows in roles.items():
                if role not in ROLES:
                    raise ValueError('invalid role')
                for keep, row in rows.items():
                    for pair, n in row.items():
                        if keep not in KI or pair not in DI or not LEGAL[KI[keep], DI[pair]] or type(n) is not int or n <= 0:
                            raise ValueError('invalid inherited count')


def ingest(value, path, baseline_contents=frozenset()):
    path = path.resolve()
    wal = Path(str(path) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('supply an immutable SQLite backup')
    sha = file_digest(path)
    if any(s['sha256'] == sha for s in value['sources']):
        return
    stats, models, imported = Counter(), Counter(), []
    contents = set(value['games'].values())
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        games = {g['game_id']: dict(g) for g in db.execute(
            'SELECT * FROM compact_games WHERE included_in_tables=1 AND reproducible=1 '
            'AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) '
            "AND ended_at IS NOT NULL AND ended_at!=''")}
        rows = db.execute('SELECT game_id,' + ','.join(HAND_FIELDS) + ' FROM compact_hands ORDER BY game_id,hand_number')
        for game_id, group in itertools.groupby(rows, lambda h: h['game_id']):
            hands = [dict(h) for h in group]
            game = games.get(game_id)
            if not game:
                stats['incompleteOrExcludedGames'] += 1
                continue
            engines = [game['left_engine'], game['right_engine']]
            if not any(map(eligible, engines)):
                stats['ineligibleGames'] += 1
                continue
            seed = str(game['random_seed'])
            partition = split(seed)
            identity = digest(canonical([game['run_id'], game['matchup_id'], game['game_index'], game_id, *engines]))
            content = digest(canonical([engines, seed, game['final_left_score'], game['final_right_score'],
                [[h[f].hex() if isinstance(h[f], bytes) else h[f] for f in HAND_FIELDS] for h in hands]]))
            if identity in value['games'] and value['games'][identity] != content:
                raise ValueError('conflicting completed game: ' + game_id)
            if identity in value['games'] or content in contents:
                stats['duplicateGames'] += 1
                continue
            added = 0
            for hand in hands:
                for side, engine in enumerate(engines):
                    if not eligible(engine):
                        stats['ineligibleActorDecisions'] += 1
                        continue
                    name, other = ('left', 'right') if side == 0 else ('right', 'left')
                    try:
                        role, pair = actor_discard(hand, side)
                        own = bytes(hand[other + '_dealt'] or b'')
                        cards = bytes(hand[name + '_dealt']) + own + bytes([hand['cut_card']])
                        if len(own) != 6 or len(set(cards)) != 13 or max(cards) >= 52:
                            raise ValueError('overlapping/invalid cards')
                        keep = rank_key(hand[name + '_keep'])
                    except (ValueError, TypeError):
                        stats['invalidActorHands'] += 1
                        continue
                    row = value['counts'].setdefault(partition, {}).setdefault(engine, {}).setdefault(role, {}).setdefault(keep, {})
                    row[pair] = row.get(pair, 0) + 1
                    if partition == 'train' and content in baseline_contents:
                        historical = value.setdefault('historicalTrainCounts', {}).setdefault(engine, {}).setdefault(role, {}).setdefault(keep, {})
                        historical[pair] = historical.get(pair, 0) + 1
                    if partition != 'train':
                        value['heldout'].append([seed, engine, ROLES.index(role), KI[keep], DI[pair], rank_key(own), hand['cut_card']//4])
                    models[engine] += 1
                    stats[partition + 'Decisions'] += 1
                    added += 1
            if added:
                value['games'][identity] = content
                contents.add(content)
                stats[partition + 'Games'] += 1
                imported.append(dict(gameId=game_id, runId=game['run_id'], matchupId=game['matchup_id'],
                    gameIndex=game['game_index'], seed=seed, engines=engines, partition=partition))
    if file_digest(path) != sha:
        raise ValueError('source changed while reading')
    value['sources'].append(dict(path=str(path), sha256=sha, statistics=dict(stats), observationsByModel=dict(models), includedGames=imported))
    print(json.dumps(dict(source=str(path), statistics=dict(stats))), flush=True)


def counts(value, partition='train', older_weight=1.):
    result = np.zeros((2, 1820, 91))
    for engine, roles in value['counts'].get(partition, {}).items():
        weight = older_weight if int(model_version(engine).split('.')[0]) < 13 else 1.
        for role, rows in roles.items():
            for keep, row in rows.items():
                for pair, n in row.items():
                    result[ROLES.index(role), KI[keep], DI[pair]] += weight * n
    return result


def probabilities(n, strength):
    # Broad role behavior, conditioned on the four kept cards, with a 1% physical
    # floor. This is the Dirichlet base measure, not extra observed games.
    marginal = n.sum(axis=0)
    broad = .99 * marginal / marginal.sum() + .01 * FULL / 1326
    prior = broad[None, :] * BASE / FULL
    prior /= prior.sum(axis=1, keepdims=True)
    return (n + strength * prior) / (n.sum(axis=1, keepdims=True) + strength)


def calibrate(value):
    tune = counts(value, 'tune')
    options = [[], []]
    for older_weight in (0., .1, .25, .5, 1.):
        n = counts(value, older_weight=older_weight)
        for role in range(2):
            # Tune against modern (13/14/20) play; audit older actors separately.
            target = counts(value, 'tune', older_weight=0.)[role]
            if not target.sum():
                target = tune[role]
            for strength in (.1, 1., 3., 10., 30., 100., 300., 1000.):
                p = probabilities(n[role], strength)
                loss = -(target[LEGAL] * np.log(p[LEGAL])).sum()/target.sum()
                options[role].append(dict(olderWeight=older_weight, strength=strength, tuningNll=float(loss)))
    selected = [min(o, key=lambda r: r['tuningNll']) for o in options]
    result = np.array([probabilities(counts(value, older_weight=s['olderWeight'])[r], s['strength']) for r, s in enumerate(selected)])
    return result, dict(selectionTarget='13.x/14.x/20.x tuning seeds; test seeds never used for selection', selected=selected, options=options)


def legacy(path):
    data = path.read_bytes()
    magic, version, meta, roles, keeps, pairs, size = struct.unpack_from('<8s6I', data)
    if (magic, version, roles, keeps, pairs, len(data)-64) != (b'M20D0001', 1, 2, 1820, 91, size) or digest(data[64:]) != data[32:64].hex():
        raise ValueError('invalid legacy binary')
    pos = 64 + meta
    result, suits = np.zeros((2, 1820, 91)), []
    def row():
        nonlocal pos
        length, = struct.unpack_from('<H', data, pos); pos += 2
        values = np.zeros(91)
        for _ in range(length):
            pair, weight = struct.unpack_from('<BQ', data, pos); pos += 9
            values[pair] = weight
        return values
    for role in range(2):
        suits.append(data[pos:pos+16+91*24]); pos += 16+91*24
        fallback = row()
        for keep in range(1820):
            values = row()
            result[role, keep] = (values if values.sum() else fallback) * LEGAL[keep]
    if pos != len(data):
        raise ValueError('trailing legacy bytes')
    return result, b''.join(suits)


def pack(p, suits, metadata):
    if p.shape != (2, 1820, 91) or not np.all(np.isfinite(p)) or not np.all(p[:, LEGAL] > 0) or np.any(p[:, ~LEGAL]) or not np.allclose(p.sum(axis=2), 1., rtol=0., atol=1e-12):
        raise ValueError('incomplete or unnormalized discard probabilities')
    meta = canonical(metadata)
    payload = meta + suits + p.astype('<f8').tobytes()
    return struct.pack('<8s6I', MAGIC, metadata['schemaVersion'], len(meta), 2, 1820, 91, len(payload)) + bytes.fromhex(digest(payload)) + payload


def historical_train_only(value):
    subset = {'counts': {'train': value['historicalTrainCounts']}}
    modern = counts(subset, older_weight=0.)
    older = counts(subset) - modern
    result = np.zeros_like(modern)
    fallback = np.zeros((2,91))
    for cohort in (modern, older):
        total = cohort.sum(axis=2, keepdims=True)
        result += np.rint(np.divide(cohort*1e9, total, out=np.zeros_like(cohort), where=total>0))
        marginal = cohort.sum(axis=1)
        fallback += np.rint(marginal * 1e9 / marginal.sum(axis=1,keepdims=True))
    for role in range(2):
        missing = result[role].sum(axis=1) == 0
        result[role,missing] = fallback[role][None,:] * LEGAL[missing]
    return result


def assess(value, candidate, old, selected):
    # Updated unsmoothed rows use the same cohort weights to isolate smoothing.
    raw = np.array([counts(value, older_weight=s['olderWeight'])[r] for r, s in enumerate(selected)])
    for role in range(2):
        empty_rows = raw[role].sum(axis=1) == 0
        raw[role, empty_rows] = raw[role].sum(axis=0)[None, :] * LEGAL[empty_rows]
    historical = historical_train_only(value)
    labels = ('old', 'historicalTrainOnly', 'updatedRaw', 'smoothed')
    metrics, clusters = {}, {}
    cases = [h for h in value['heldout'] if split(h[0]) == 'test']
    for offset in range(0, len(cases), 2048):
        chunk = cases[offset:offset+2048]
        role, keep, truth, cut = np.array([[c[2], c[3], c[4], c[6]] for c in chunk]).T
        available = 4 - K[keep] - np.array([list(map(int, c[5])) for c in chunk])
        combinations = np.where(A == B, available[:, A]*(available[:, A]-1)/2, available[:, A]*available[:, B])
        copies = np.maximum(0, available[np.arange(len(chunk)), cut, None] - D[:, cut].T)
        ratio = np.divide(combinations, BASE[keep], out=np.zeros_like(combinations, dtype=float), where=BASE[keep]>0)
        scores = []
        for label, table in zip(labels, (old, historical, raw, candidate)):
            w = table[role, keep] * ratio
            if label in ('old', 'historicalTrainOnly'):
                w = np.floor(w + .5)  # Match the frozen integer-rounding path.
            w *= copies
            empty_rows = w.sum(axis=1) == 0
            if np.any(empty_rows):
                # Existing 20.3 emergency whole-row fallback: remove cut, then
                # enumerate physically possible pairs. No per-cell rescue.
                remaining = available[empty_rows].copy()
                remaining[np.arange(len(remaining)), cut[empty_rows]] -= 1
                w[empty_rows] = np.where(A == B, remaining[:, A]*(remaining[:, A]-1)/2, remaining[:, A]*remaining[:, B])
            p = w / w.sum(axis=1, keepdims=True)
            actual = p[np.arange(len(chunk)), truth]
            loss = -np.log(np.maximum(actual, 1e-15))
            brier = 1 - 2*actual + (p*p).sum(axis=1)
            scores.append((actual, loss, brier))
        for i, case in enumerate(chunk):
            seed, engine = case[:2]
            family = 'modern' if int(model_version(engine).split('.')[0]) >= 13 else 'older'
            for group in ('all', family, model_version(engine), family + '/' + ROLES[case[2]]):
                sums = metrics.setdefault(group, {label: [0, 0, 0., 0.] for label in labels})
                for label, (p, loss, brier) in zip(sums, scores):
                    s = sums[label]; s[0] += 1; s[1] += int(p[i] == 0); s[2] += float(loss[i]); s[3] += float(brier[i])
            for comparison in range(3):
                for group in (family, model_version(engine)):
                    c = clusters.setdefault(group + '/vs-' + labels[comparison], {}).setdefault(seed, [0., 0., 0.])
                    c[0] += 1; c[1] += float(scores[3][1][i]-scores[comparison][1][i]); c[2] += float(scores[3][2][i]-scores[comparison][2][i])
    report = {}
    for group, models in metrics.items():
        report[group] = {label: dict(observations=n, zeroActualSupport=z, nll=None if z else loss/n,
            clippedNll=loss/n, brier=b/n) for label, (n,z,loss,b) in models.items()}
    rng = np.random.default_rng(203)
    intervals = {}
    for group, seeds in clusters.items():
        data = np.array(list(seeds.values()))
        draws = np.array([data[rng.integers(len(data), size=len(data))].sum(axis=0) for _ in range(2000)])
        intervals[group] = dict(independentSeedClusters=len(data),
            nllDelta95=np.quantile(draws[:,1]/draws[:,0], [.025,.975]).tolist(),
            brierDelta95=np.quantile(draws[:,2]/draws[:,0], [.025,.975]).tolist())
    return dict(metrics=report, pairedSeedBootstrap=intervals, nllFloorForComparisons=1e-15,
        caveat='Historical asset overlaps older/13.x held-out seeds; 20.1 and 20.2 games postdate it. Infinite raw NLL is reported as null. Clipped comparisons use the explicit 1e-15 floor.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--legacy', type=Path, required=True)
    parser.add_argument('--baseline-evidence', type=Path, required=True)
    parser.add_argument('--suit-evidence', type=Path, default=Path(__file__).resolve().parents[1] / 'training/model203-suit-evidence.json.gz')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    value = json.loads(gzip.decompress(args.evidence.read_bytes())) if args.evidence.exists() else empty()
    validate(value)
    baseline = json.loads(gzip.decompress(args.baseline_evidence.read_bytes()))
    if any(not eligible(engine) for engine in baseline['countsByModel']):
        raise ValueError('ineligible baseline actor')
    baseline_contents = set(baseline['games'].values())
    value['baselineEvidenceSha256'] = file_digest(args.baseline_evidence)
    if args.sources:
        for path in json.loads(args.sources.read_bytes()):
            ingest(value, Path(path), baseline_contents)
    validate(value)
    encoded = canonical(value)
    old, suits = legacy(args.legacy)
    p, calibration = calibrate(value)
    report = dict(schemaVersion=1, modelVersion='20.3', evidenceSha256=digest(encoded),
        builderSha256=file_digest(Path(__file__)), baselineEvidenceSha256=value['baselineEvidenceSha256'],
        sourceGames=len(value['games']), sources=len(value['sources']), splitRule=SPLIT_RULE,
        observationsBySplit={s: int(counts(value,s).sum()) for s in ('train','tune','test')},
        models={model_version(e): int(sum(sum(sum(row.values()) for row in rows.values()) for rows in roles.values()))
            for e,roles in value['counts']['train'].items()}, calibration=calibration,
        coverage={role: dict(observedCells=int(np.count_nonzero(counts(value)[r])), legalCells=int(LEGAL.sum()),
                            positiveRuntimeCells=int(np.count_nonzero(p[r]))) for r,role in enumerate(ROLES)},
        assessment=assess(value,p,old,calibration['selected']))
    metadata = dict(schemaVersion=1, modelVersion='20.3', evidenceSha256=report['evidenceSha256'],
        legacySha256=file_digest(args.legacy), sourceGames=report['sourceGames'],
        observationsBySplit=report['observationsBySplit'], calibration=calibration['selected'],
        prior='99% role marginal + 1% physical; conditioned on keep; raw-count Dirichlet update',
        suitedSection='unchanged from legacySha256', splitRule=SPLIT_RULE)
    # A conditional-rank rebuild must preserve the independently refreshed suit
    # evidence rather than silently restoring the historical suit section.
    from build_model203_suit_evidence import section
    suits, suit_metadata = section(json.loads(gzip.decompress(args.suit_evidence.read_bytes())))
    metadata.update(schemaVersion=2, suitedSection=suit_metadata)
    report['suitedSection'] = suit_metadata
    data = pack(p,suits,metadata)
    report['assetSha256'] = digest(data)
    report['assetBytes'] = len(data)
    outputs = {args.evidence: gzip.compress(encoded, mtime=0), args.output: data, args.report: canonical(report)+b'\n'}
    for path, data in outputs.items():
        if args.check:
            if path.read_bytes() != data:
                raise ValueError('not reproducible: ' + str(path))
        else:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
    print(json.dumps({k: report[k] for k in ('sourceGames','observationsBySplit','coverage','assetBytes','assetSha256')}))


if __name__ == '__main__':
    main()
