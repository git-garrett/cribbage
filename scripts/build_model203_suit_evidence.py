#!/usr/bin/env python3
"""Refresh only 20.3's suited-discard section; retain raw evidence and seed splits.

Historical counts have no game ledger. Only games ending strictly after the
historical export are appended. Beta strengths are chosen on tuning seeds;
reserved test seeds are never folded back into runtime counts.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import itertools
import json
from pathlib import Path
import sqlite3
import struct

import numpy as np

from build_model203_hold import canonical, digest, file_digest
from build_model203_crib import HAND_FIELDS, actor_discard, timestamp
from build_model203_opponent_discards import (
    A, B, DI, PAIRS, ROLES, SPLIT_RULE, eligible, legacy, pack, split,
)
from learning_model_policy import model_version

DISTINCT = A != B
CUTOFF = '2026-07-02T18:52:50.939Z'
LEGACY_SOURCE = dict(revision='4e8611ca69e41849df37c39da9790bdb43249439',
    path='web/src/models/rank-crib-discard/empirical-discard-keep-14.8.json',
    sha256='bf273e7de4ad0bfa91fe085d6a20641f75b962ba923c813ef79fc0a7a203d308',
    sourceGames=211303, observations=2079994, generatedAt=CUTOFF,
    models=['7.0','8.0','9.0','10.0','11.0','11.1','12.0','13.0','13.1',
            '14.0','14.1','14.2','14.3','14.4','14.5','14.6'])


def empty(legacy_path):
    _, section = legacy(legacy_path)
    n = np.zeros((2, 91, 2), dtype=np.int64)
    for role in range(2):
        for pair in range(91):
            n[role, pair] = struct.unpack_from('<QQ', section, role*2200+16+pair*24)
    if int(n[:, :, 0].sum()) != LEGACY_SOURCE['observations']:
        raise ValueError('unexpected historical suit counts')
    return dict(schemaVersion=1, splitRule=SPLIT_RULE,
        baseline=dict(**LEGACY_SOURCE, packedAssetSha256=file_digest(legacy_path), counts=n.tolist()),
        counts={}, heldout=[], games={}, sources=[])


def validate(value):
    if value['schemaVersion'] != 1 or value['splitRule'] != SPLIT_RULE:
        raise ValueError('unsupported suit evidence')
    if any(value['baseline'].get(k) != v for k, v in LEGACY_SOURCE.items()):
        raise ValueError('unexpected historical suit provenance')
    arrays = [value['baseline']['counts']]
    for partition, models in value['counts'].items():
        if partition not in ('train', 'tune', 'test'):
            raise ValueError('invalid evidence partition')
        for engine, n in models.items():
            if not eligible(engine):
                raise ValueError('ineligible inherited actor: ' + engine)
            arrays.append(n)
    for n in arrays:
        a = np.asarray(n)
        if a.shape != (2, 91, 2) or a.dtype.kind not in 'iu' or np.any(a < 0) or np.any(a[:,:,1] > a[:,:,0]) or np.any(a[:,~DISTINCT,1]):
            raise ValueError('invalid suit observation counts')


def ingest(value, path, original_path=None):
    path = path.resolve()
    wal = Path(str(path) + '-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('supply an immutable SQLite backup')
    sha = file_digest(path)
    if any(s['sha256'] == sha for s in value['sources']):
        return
    stats, models, imported = Counter(), Counter(), []
    contents = set(value['games'].values())
    cutoff = timestamp(value['baseline']['generatedAt'])
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
            try:
                ended = timestamp(game['ended_at'])
                newer = ended > cutoff
            except (ValueError, TypeError):
                newer = False
            if not newer:
                stats['beforeHistoricalExportOrInvalidDate'] += 1
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
                        own, other_cards = bytes(hand[name+'_dealt']), bytes(hand[other+'_dealt'] or b'')
                        cards = own + other_cards + bytes([hand['cut_card']])
                        if len(other_cards) != 6 or len(set(cards)) != 13 or max(cards) >= 52:
                            raise ValueError('overlapping/invalid cards')
                        discard = sorted(set(own) - set(hand[name+'_keep']))
                        suited = int(discard[0] % 4 == discard[1] % 4)
                    except (ValueError, TypeError):
                        stats['invalidActorHands'] += 1
                        continue
                    r, d = ROLES.index(role), DI[pair]
                    model_counts = value['counts'].setdefault(partition, {})
                    if engine not in model_counts:
                        model_counts[engine] = np.zeros((2,91,2), dtype=np.int64).tolist()
                    n = model_counts[engine]
                    n[r][d][0] += 1
                    n[r][d][1] += suited
                    if partition != 'train':
                        value['heldout'].append([seed, engine, r, d, suited])
                    models[engine] += 1
                    stats[partition+'Decisions'] += 1
                    added += 1
            if added:
                value['games'][identity] = content
                contents.add(content)
                stats[partition+'Games'] += 1
                imported.append(dict(gameId=game_id, runId=game['run_id'], matchupId=game['matchup_id'],
                    gameIndex=game['game_index'], seed=seed, engines=engines, partition=partition))
    if file_digest(path) != sha:
        raise ValueError('source changed while reading')
    value['sources'].append(dict(path=str(path), originalPath=str(original_path or path), sha256=sha,
        statistics=dict(stats), observationsByModel=dict(models), includedGames=imported))
    print(json.dumps(dict(source=str(path), statistics=dict(stats))), flush=True)


def counts(value, partition='train', modern_only=False):
    n = np.zeros((2,91,2), dtype=np.int64)
    for engine, rows in value['counts'].get(partition, {}).items():
        if not modern_only or int(model_version(engine).split('.')[0]) >= 13:
            n += np.asarray(rows, dtype=np.int64)
    return n


def rates(n, strength):
    # Beta prior centered on the role's observed distinct-rank suited rate.
    # Beta(1,3) at this broad level gives a physical 1/4 prior if no data exist.
    prior = float((n[DISTINCT,1].sum()+1)/(n[DISTINCT,0].sum()+4))
    p = np.zeros(91)
    p[DISTINCT] = np.divide(n[DISTINCT,1]+strength*prior, n[DISTINCT,0]+strength,
        out=np.full(78, prior), where=n[DISTINCT,0]+strength > 0)
    return p, prior


def metrics(n, p):
    total, yes = n[:,0], n[:,1]
    safe = np.clip(p, 1e-15, 1-1e-15)
    return dict(observations=int(total.sum()),
        nll=float(-(yes*np.log(safe)+(total-yes)*np.log1p(-safe)).sum()/total.sum()),
        brier=float((yes*(1-p)**2+(total-yes)*p**2).sum()/total.sum()))


def paired_change(rows, p, reference):
    clusters = defaultdict(list)
    for seed, _, r, d, yes in rows:
        if DISTINCT[d]:
            a, b = np.clip([p[r,d], reference[r,d]], 1e-15, 1-1e-15)
            clusters[seed].append(float(-np.log(a if yes else 1-a)+np.log(b if yes else 1-b)))
    if len(clusters) < 2:
        return dict(value=None, interval95=None, seeds=len(clusters))
    per_seed = np.array([[sum(v),len(v)] for v in clusters.values()])
    delta = per_seed[:,0].sum()/per_seed[:,1].sum()
    residual = per_seed[:,0]-delta*per_seed[:,1]
    se = np.sqrt(len(per_seed)/(len(per_seed)-1)*np.sum(residual**2))/per_seed[:,1].sum()
    return dict(value=float(delta), interval95=[float(delta-1.96*se),float(delta+1.96*se)], seeds=len(per_seed))


def calibrate(value):
    n = np.asarray(value['baseline']['counts']) + counts(value)
    target = counts(value, 'tune', modern_only=True)
    selected, options, candidates, p = [], [], [], []
    raw = np.asarray([rates(rows, 0)[0] for rows in n])
    for role in range(2):
        if not target[role,:,0].sum():
            raise ValueError('need modern tuning games for each role')
        choices = []
        for strength in (0., 1., 3., 10., 30., 100., 300., 1000., 3000., 10000., 30000., 100000.):
            probability, prior = rates(n[role], strength)
            choices.append(dict(strength=strength, priorMean=prior, **metrics(target[role], probability)))
        best = min(choices, key=lambda c: c['nll'])
        candidate = raw.copy()
        candidate[role] = rates(n[role], best['strength'])[0]
        tuning_rows = [h for h in value['heldout'] if h[2] == role and split(h[0]) == 'tune'
                       and int(model_version(h[1]).split('.')[0]) >= 13]
        change = paired_change(tuning_rows, candidate, raw)
        # All current cells are dense. Require evidence of benefit before
        # replacing their empirical rates with a nonzero-strength prior.
        use_prior = change['interval95'] is not None and change['interval95'][1] < 0
        selected.append(best if use_prior else choices[0])
        candidates.append(dict(**best, distinctRankNllChange=change, accepted=use_prior))
        options.append(choices)
        p.append(rates(n[role], selected[-1]['strength'])[0])
    return n, np.asarray(p), dict(selectionTarget='13.x/14.x/20.x tuning seeds only',
        selectionRule='Minimum tuning NLL; enable smoothing only if paired seed-cluster 95% interval improves on strength zero',
        selected=selected, bestTuningCandidates=candidates, options=options)


def section(value):
    validate(value)
    n, p, calibration = calibrate(value)
    data = bytearray()
    for role in range(2):
        overall = n[role,:,1].sum()/n[role,:,0].sum()
        data.extend(struct.pack('<dd', overall, calibration['selected'][role]['priorMean']))
        for pair in range(91):
            data.extend(struct.pack('<QQd', *n[role,pair], p[role,pair]))
    meta = dict(evidenceSha256=digest(canonical(value)), sourceGames=len(value['games']),
        baseline=LEGACY_SOURCE, observationsBySplit={s:int(counts(value,s)[:,:,0].sum()) for s in ('train','tune','test')},
        prior='Beta centered on role distinct-rank suited rate; broad Beta(1,3); structural same-rank zero',
        calibration=calibration['selected'], splitRule=SPLIT_RULE)
    return bytes(data), meta


def read_asset(path):
    data = path.read_bytes()
    magic, version, m, roles, keeps, pairs, size = struct.unpack_from('<8s6I',data)
    if magic != b'M203OD01' or version not in (1,2) or (roles,keeps,pairs,len(data)-64) != (2,1820,91,size) or digest(data[64:]) != data[32:64].hex():
        raise ValueError('invalid Model 20.3 base asset')
    return json.loads(data[64:64+m]), data[64+m:64+m+4400], data[64+m+4400:]


def assess(value, p, old):
    n = np.asarray(value['baseline']['counts']) + counts(value)
    raw = np.asarray([rates(rows,0)[0] for rows in n])
    report = {}
    for cohort in ('all','modern','20.x'):
        rows = [h for h in value['heldout'] if split(h[0]) == 'test'
                and (cohort=='all' or (int(model_version(h[1]).split('.')[0]) >= 13 if cohort=='modern' else model_version(h[1]).startswith('20.')))]
        target = np.zeros((2,91,2),dtype=np.int64)
        for seed, _, r, d, yes in rows:
            target[r,d] += [1,yes]
        if not rows:
            continue
        # Cluster-robust SE accounts for repeated hands and both orientations at
        # a seed. It cannot audit historical seeds absent from the old ledger.
        report[cohort] = dict(byRole={role:{label:metrics(target[r],probs[r]) for label,probs in
                [('old',old),('updatedRaw',raw),('candidate',p)]} for r,role in enumerate(ROLES)},
            distinctRankNllChange=paired_change(rows,p,old))
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for arg in ('evidence','legacy','base-asset','output','report'):
        parser.add_argument('--'+arg,type=Path,required=True)
    parser.add_argument('--sources',type=Path)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    value=json.loads(gzip.decompress(args.evidence.read_bytes())) if args.evidence.exists() else empty(args.legacy)
    validate(value)
    if args.sources:
        for source in json.loads(args.sources.read_bytes()):
            if isinstance(source,str): ingest(value,Path(source))
            else: ingest(value,Path(source['path']),source['originalPath'])
    suit_bytes, suit_meta=section(value)
    metadata, _, rank_bytes=read_asset(args.base_asset)
    _, legacy_suits=legacy(args.legacy)
    old=np.array([[struct.unpack_from('<d',legacy_suits,r*2200+16+d*24+16)[0] for d in range(91)] for r in range(2)])
    n,p,calibration=calibrate(value)
    metadata.update(schemaVersion=2,suitedSection=suit_meta)
    probabilities=np.frombuffer(rank_bytes,dtype='<f8').reshape((2,1820,91))
    data=pack(probabilities,suit_bytes,metadata)
    report=dict(schemaVersion=1,modelVersion='20.3',builderSha256=file_digest(Path(__file__)),
        assetSha256=digest(data),assetBytes=len(data),evidenceSha256=suit_meta['evidenceSha256'],
        conditionalPayloadSha256=digest(rank_bytes),baseline=LEGACY_SOURCE,sourceGames=len(value['games']),
        observationsBySplit=suit_meta['observationsBySplit'],sources=len(value['sources']),
        observationsByModel={e:int(sum(np.asarray(value['counts'].get(s,{}).get(e,np.zeros((2,91,2),dtype=np.int64)))[:,:,0].sum() for s in ('train','tune','test'))) for e in sorted(set().union(*(v.keys() for v in value['counts'].values())))},
        calibration=calibration,
        coverage={role:dict(totalObservations=int(n[r,:,0].sum()),distinctRankRows=int(DISTINCT.sum()),
            minDistinctRankObservations=int(n[r,DISTINCT,0].min()),zeroOrOneDistinctRankRates=int(np.sum((p[r,DISTINCT]<=0)|(p[r,DISTINCT]>=1)))) for r,role in enumerate(ROLES)},
        assessment=assess(value,p,old),
        limitations=['Historical aggregate lacks game IDs/seeds: exclude new games ended on/before its export time; older-policy seed overlap cannot be audited.',
            'Prediction assessment is not a gameplay win-rate benchmark.'])
    outputs={args.evidence:gzip.compress(canonical(value),mtime=0),args.output:data,args.report:canonical(report)+b'\n'}
    for path,blob in outputs.items():
        if args.check:
            if path.read_bytes()!=blob: raise ValueError('not reproducible: '+str(path))
        else:
            path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(blob)
    print(json.dumps({k:report[k] for k in ('sourceGames','observationsBySplit','coverage','assetSha256')}))


if __name__=='__main__': main()
