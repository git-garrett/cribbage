#!/usr/bin/env python3
"""Prepare experimental score-banded beliefs and validate positions, not games.

The verified broad 20.3 snapshot supplies probabilities, not fictitious counts.
Only new seed groups may update it. Production dispatch is intentionally absent.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import gzip
import hashlib
import itertools
import json
import math
from pathlib import Path
import random
import re
import secrets
import sqlite3
import struct

import build_model203_hold as hold

ROOT = Path(__file__).resolve().parents[1]
ROLES = ('dealer', 'pone')
SPLITS = ('train', 'tune', 'test')
VERSIONS = frozenset(('13.23', '20.0', '20.1', '20.2', '20.3', '20.4', '20.5', '20.6', '20.7', '28.3'))
STRENGTHS = (1., 3., 10., 30., 100., 300., 1000., 3000., 10000., None)
DISCARD_SHA = 'efd7a4594a8c42fc0e332726d44e8ababf541b3eb80c4cbf8140b9629389dbad'
FIELDS = ('hand_number', 'dealer', 'start_left_score', 'start_right_score', 'cut_card',
          'left_dealt', 'right_dealt', 'left_keep', 'right_keep', 'peg_sequence')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_bytes(canonical(value) + b'\n')


def eligible(engine):
    return hold.model_version(engine) in VERSIONS


def split(seed):
    bucket = int(sha(('model203-opponent-discards-v1:' + str(seed)).encode())[:8], 16) % 10
    return 'tune' if bucket == 0 else 'test' if bucket == 1 else 'train'


def late(score):
    if type(score) is not int or not 0 <= score <= 120:
        raise ValueError('invalid start-of-hand score')
    return score >= 111


def posterior(prior, observed, strength):
    if set(observed) - set(prior) or any(type(n) is not int or n < 0 for n in observed.values()):
        raise ValueError('invalid observed support/counts')
    if strength is None or not observed:
        return dict(prior)
    if not math.isfinite(strength) or strength <= 0:
        raise ValueError('prior strength must be positive')
    n = sum(observed.values())
    return {key: (observed.get(key, 0) + strength * p) / (n + strength) for key, p in prior.items()}


def read_hold(data):
    magic, version, contexts, records, cb, rb = struct.unpack_from('<8s5I', data)
    if (magic, version, contexts, cb, rb, len(data)) != (b'M203HB01', 1, 1120, 22, 21, 28+contexts*22+records*21):
        raise ValueError('invalid broad hold asset')
    result = {}
    for i in range(contexts):
        role, *row = struct.unpack_from('<B13BII', data, 28+i*22)
        prefix, first, size = ''.join(map(str, row[:13])), row[13], row[14]
        weights = {}
        for j in range(first, first+size):
            *ranks, weight = struct.unpack_from('<13BQ', data, 28+contexts*22+j*21)
            weights[''.join(map(str, ranks))] = weight
        result[(ROLES[role], prefix)] = hold.normalized(weights)
    return result


def read_discards(data):
    magic, version, meta, roles, keeps, pairs, size = struct.unpack_from('<8s6I', data)
    if (magic, version, roles, keeps, pairs, size) != (b'M203OD01', 2, 2, 1820, 91, len(data)-64) or sha(data[64:]) != data[32:64].hex():
        raise ValueError('invalid broad discard asset')
    metadata = json.loads(data[64:64+meta])
    suits = data[64+meta:64+meta+2*(16+91*24)]
    pos = 64+meta+len(suits)
    result = {}
    for role in ROLES:
        for keep in hold.keys(4):
            values = struct.unpack_from('<91d', data, pos)
            pos += 91*8
            result[(role, keep)] = {pair: p for pair, p in zip(hold.keys(2), values) if p > 0}
    if pos != len(data):
        raise ValueError('trailing discard bytes')
    return result, suits, metadata


def checked_priors(root):
    assets = root/'rust/cribbage-shadow-engine/assets'
    hbytes = (assets/'model203-hold.bin').read_bytes()
    dbytes = (assets/'model203-opponent-discards.bin').read_bytes()
    metadata = json.loads((assets/'model203-hold.json').read_bytes())
    if sha(hbytes) != metadata['sha256'] or sha(dbytes) != DISCARD_SHA:
        raise ValueError('broad prior differs from reviewed snapshot')
    _,_,discard_metadata=read_discards(dbytes)
    # This audited snapshot excludes every 15.x/16.x actor, including inherited
    # evidence. Collect all recorded seeds, not just its training partition.
    prior_seeds, provenance = set(), {}
    for name in ('hold', 'opponent-discard', 'suit'):
        path = root/'training'/f'model203-{name}-evidence.json.gz'
        data = path.read_bytes()
        value = json.loads(gzip.decompress(data))
        if name == 'hold':
            hold.validate_evidence(value)
            if sha(data) != metadata['evidenceSha256']:
                raise ValueError('broad hold evidence differs')
        else:
            expected=(discard_metadata['evidenceSha256'] if name=='opponent-discard'
                      else discard_metadata['suitedSection']['evidenceSha256'])
            if sha(canonical(value)) != expected:
                raise ValueError('broad '+name+' evidence differs')
            for models in value['counts'].values():
                if any(hold.model_version(e) not in hold.STRONG_VERSIONS for e in models):
                    raise ValueError('excluded inherited actor')
        for source in value['sources']:
            prior_seeds.update(str(g['seed']) for g in source.get('includedGames', []))
        provenance[path.name] = sha(data)
    return hbytes, dbytes, prior_seeds, provenance


def run_provenance(db, engines):
    result=[]
    for run_id, raw in db.execute('SELECT run_id,metadata_json FROM ai_runs ORDER BY run_id'):
        metadata=json.loads(raw)
        frozen=metadata.get('frozenEngine') or {}
        record=dict(runId=run_id,sourceCommit=metadata.get('sourceCommit'),
                    runnerSha256=metadata.get('runnerSha256'),frozenModel=frozen.get('model'),
                    frozenSha256=frozen.get('sha256'),frozenSourceCommit=frozen.get('sourceCommit'),
                    metadataSha256=sha(raw.encode()))
        if [metadata.get('left'),metadata.get('right')]!=engines or (frozen and record['frozenModel'] not in engines):
            raise ValueError('run provenance differs from actor identities')
        required=[('sourceCommit',40),('runnerSha256',64)]
        if frozen: required.extend([('frozenSourceCommit',40),('frozenSha256',64)])
        for key,length in required:
            if not isinstance(record[key],str) or not re.fullmatch('[0-9a-f]{'+str(length)+'}',record[key]):
                raise ValueError('missing recorded source or executable identity')
        result.append(record)
    if not result:
        raise ValueError('missing run provenance')
    return result


def freeze_sources(config, output):
    frozen = []
    identity = output/'source-config.json'
    if identity.exists() and identity.read_bytes() != canonical(config):
        raise ValueError('use a new output directory for changed source selections')
    identity.write_bytes(canonical(config))
    folder = output/'sources'
    folder.mkdir(exist_ok=True)
    manifest=output/'manifest.json'
    previous={s['snapshot']:s for s in json.loads(manifest.read_bytes())['sourceSnapshots']} if manifest.exists() else {}
    for i, source in enumerate(config['sources']):
        path = Path(source['path']).resolve()
        destination = folder/f'{i:02}.sqlite'
        if not destination.exists():
            with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)) as db, closing(sqlite3.connect(destination)) as snapshot:
                db.backup(snapshot)
        snapshot_sha=hold.file_digest(destination)
        if destination.name in previous and previous[destination.name]['sha256'] != snapshot_sha:
            raise ValueError('frozen snapshot differs from its manifest')
        with closing(sqlite3.connect(destination)) as db:
            provenance=run_provenance(db,source['engines'])
        if provenance!=source['runProvenance']:
            raise ValueError('run provenance differs from reviewed selection')
        frozen.append(dict(originalPath=str(path), snapshot=destination.name,
                           sha256=snapshot_sha, engines=source['engines'],
                           runProvenance=provenance,
                           qualification=source['qualification']))
    return frozen


def extract(config, output, frozen, prior_seeds):
    counts = {s: {kind:defaultdict(Counter) for kind in
                  ('hold','discards','ordinary-hold','ordinary-discards')} for s in SPLITS}
    seen, identities, cases, games = set(), {}, [], []
    stats, by_model, bands = Counter(), Counter(), Counter()
    for source in frozen:
        path = output/'sources'/source['snapshot']
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)) as db:
            db.row_factory = sqlite3.Row
            qualified = {g['game_id']: dict(g) for g in db.execute(
                'SELECT * FROM compact_games WHERE included_in_tables=1 AND reproducible=1 '
                'AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) '
                "AND ended_at IS NOT NULL AND ended_at!=''")}
            registered_runs={p['runId'] for p in source['runProvenance']}
            normalized = bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compact_peg_plays'").fetchone())
            rows = db.execute('SELECT game_id,'+','.join(FIELDS)+' FROM compact_hands ORDER BY game_id,hand_number')
            for game_id, group in itertools.groupby(rows, lambda row: row['game_id']):
                game = qualified.get(game_id)
                if game is None:
                    continue
                if game['run_id'] not in registered_runs:
                    raise ValueError('game lacks qualified run provenance')
                engines = [game['left_engine'], game['right_engine']]
                if engines != source['engines']:
                    raise ValueError('source actor identities differ from qualification')
                seed = str(game['random_seed'])
                hands = [dict(h) for h in group]
                # Preserve actual stored histories for exact identity and then
                # reconstruct normalized plays only when a packed blob is absent.
                body = [engines, seed, game['final_left_score'], game['final_right_score'],
                        [[h[f].hex() if isinstance(h[f], bytes) else h[f] for f in FIELDS] for h in hands]]
                content = sha(canonical(body))
                identity = canonical([game['run_id'], game['matchup_id'], game['game_index'], game_id, engines])
                if identity in identities and identities[identity] != content:
                    raise ValueError('conflicting game identity')
                identities[identity] = content
                if seed in prior_seeds:
                    stats['priorSeedGamesExcluded'] += 1
                    continue
                if content in seen:
                    stats['duplicateGamesExcluded'] += 1
                    continue
                seen.add(content)
                partition = split(seed)
                games.append(dict(source=source['snapshot'], gameId=game_id, seed=seed,
                                  partition=partition, engines=engines, contentSha256=content))
                stats[partition+'Games'] += 1
                sequences = defaultdict(bytearray)
                if normalized and any(not h['peg_sequence'] for h in hands):
                    for play in db.execute('SELECT hand_number,action,player,card FROM compact_peg_plays WHERE game_id=? ORDER BY hand_number,sequence', (game_id,)):
                        if play['action'] == 0:
                            if play['player'] not in (0, 1) or play['card'] is None or not 0 <= play['card'] < 52:
                                raise ValueError('invalid normalized public play')
                            sequences[play['hand_number']] += bytes([0, play['player'], play['card'], 0, 0])
                for hand in hands:
                    try:
                        if hand['dealer'] not in (0, 1):
                            raise ValueError('dealer')
                        scores = [hand['start_left_score'], hand['start_right_score']]
                        for score in scores:
                            late(score)
                        dealt = [bytes(hand[name+'_dealt'] or b'') for name in ('left', 'right')]
                        kept = [bytes(hand[name+'_keep'] or b'') for name in ('left', 'right')]
                        physical = dealt[0]+dealt[1]+bytes([hand['cut_card']])
                        if len(physical) != 13 or len(set(physical)) != 13 or max(physical) >= 52:
                            raise ValueError('cards')
                        if not hand['peg_sequence']:
                            hand['peg_sequence'] = bytes(sequences[hand['hand_number']])
                        observations = [hold.observations(hand, side) for side in (0, 1)]
                    except (ValueError, TypeError):
                        stats['invalidHandsExcluded'] += 1
                        continue
                    for side, engine in enumerate(engines):
                        if not eligible(engine):
                            stats['excludedActorHands'] += 1
                            continue
                        role = ROLES[0] if hand['dealer'] == side else ROLES[1]
                        is_late = late(scores[side])
                        bands[(partition, role, 'late' if is_late else 'ordinary')] += 1
                        by_model[(engine, partition, 'late' if is_late else 'ordinary')] += 1
                        keep = hold.rank_key(kept[side])
                        pair = hold.rank_key(set(dealt[side])-set(kept[side]))
                        kind_prefix = '' if is_late else 'ordinary-'
                        counts[partition][kind_prefix+'discards'][(role, keep)][pair] += 1
                        for _, prefix, remaining in observations[side]:
                            counts[partition][kind_prefix+'hold'][(role, prefix)][remaining] += 1
                        if is_late and partition != 'train':
                            cases.append(dict(seed=seed, partition=partition, model=engine,
                                gameContentSha256=content, hand=hand['hand_number'], role=role,
                                actorStartScore=scores[side], opponentStartScore=scores[1-side],
                                ownSix=hold.rank_key(dealt[1-side]), cutRank=hand['cut_card']//4,
                                keep=keep, discard=pair,
                                hold=[dict(prefix=p, remaining=r) for _, p, r in observations[side]]))
        if hold.file_digest(path) != source['sha256']:
            raise ValueError('frozen source changed')
    encoded = {s: {kind: [{'role': r, 'context': k, 'counts': dict(row)}
                          for (r,k), row in sorted(rows.items())]
                   for kind,rows in kinds.items()} for s,kinds in counts.items()}
    evidence = dict(schemaVersion=1, threshold=111, sources=frozen, games=games,
                    statistics=dict(stats), counts=encoded, cases=cases,
                    modelCounts=[dict(model=e, partition=s, band=b, decisions=n) for (e,s,b),n in sorted(by_model.items())],
                    bands=[dict(partition=s,role=r,band=b,decisions=n) for (s,r,b),n in sorted(bands.items())])
    (output/'evidence.json.gz').write_bytes(gzip.compress(canonical(evidence), mtime=0))
    return evidence, counts


def select(priors, counts, kind):
    selected, audit = {}, []
    for role in ROLES:
        lengths = range(4) if kind.endswith('hold') else (4,)
        for length in lengths:
            target = {key: row for key,row in counts['tune'][kind].items()
                      if key[0] == role and sum(map(int,key[1])) == length}
            n = sum(sum(row.values()) for row in target.values())
            if not n:
                raise ValueError('no tuning evidence for '+kind+'/'+role+'/'+str(length))
            options = []
            for strength in STRENGTHS:
                total = 0.
                for key,row in target.items():
                    p = posterior(priors[key], counts['train'][kind].get(key, {}), strength)
                    total -= sum(value*math.log(p[truth]) for truth,value in row.items())
                options.append(dict(strength=strength, nll=total/n))
            winner = min(options, key=lambda o: (o['nll'], o['strength'] is not None))
            selected[(role,length)] = winner['strength']
            audit.append(dict(kind=kind, role=role, prefixLength=length, tuningObservations=n,
                              selected=winner, options=options))
    result = {key: posterior(q, counts['train'][kind].get(key, {}), selected[(key[0], sum(map(int,key[1])))])
              for key,q in priors.items()}
    return result, audit


def pooled_counts(counts):
    result={s:{kind:defaultdict(Counter) for kind in ('hold','discards')} for s in SPLITS}
    for s in SPLITS:
        for kind in ('hold','discards'):
            for source in (kind,'ordinary-'+kind):
                for key,row in counts[s][source].items(): result[s][kind][key].update(row)
    return result


def validate_rows(rows, kind):
    minimum = 1.
    for (role, context), row in rows.items():
        size = (4-sum(map(int,context))) if kind == 'hold' else 2
        expected = {key for key in hold.keys(size)
                    if all(int(a)+int(b)<=4 for a,b in zip(context,key))}
        if role not in ROLES or set(row) != expected or any(not math.isfinite(p) or p <= 0 for p in row.values()) or abs(math.fsum(row.values())-1) > 1e-12:
            raise ValueError('incomplete, impossible, or unnormalized '+kind+' support')
        minimum = min(minimum, min(row.values()))
    if len(rows) != (1120 if kind == 'hold' else 3640):
        raise ValueError('missing '+kind+' contexts')
    return dict(contexts=len(rows), positiveCells=sum(map(len,rows.values())), minimumProbability=minimum)


def pack_discards(rows, suits, metadata):
    payload = bytearray(canonical(metadata))
    meta_len = len(payload)
    payload.extend(suits)
    for role in ROLES:
        for keep in hold.keys(4):
            payload.extend(struct.pack('<91d', *(rows[(role,keep)].get(pair,0.) for pair in hold.keys(2))))
    return struct.pack('<8s6I', b'M203OD01', 2, meta_len, 2, 1820, 91, len(payload))+bytes.fromhex(sha(payload))+payload


def metrics(cases, broad_h, late_h, broad_d, late_d, physical=False):
    totals = defaultdict(lambda: [0, 0., 0., 0., 0.])
    clusters = defaultdict(lambda: defaultdict(lambda: [0,0.,0.]))
    for case in cases:
        if case['partition'] != 'test':
            continue
        for kind, observations, base, candidate in [
            ('discards', [(case['keep'],case['discard'])], broad_d,late_d),
            ('hold', [(h['prefix'],h['remaining']) for h in case['hold']], broad_h,late_h),
        ]:
            for context,truth in observations:
                key = (case['role'],context)
                q,p = base[key],candidate[key]
                if physical:
                    condition=conditioned_hold if kind=='hold' else conditioned_discard
                    q=condition(q,context,case['ownSix'],case['cutRank'])
                    p=condition(p,context,case['ownSix'],case['cutRank'])
                losses = [-math.log(q[truth]), -math.log(p[truth])]
                briers = [1-2*q[truth]+math.fsum(v*v for v in q.values()),
                          1-2*p[truth]+math.fsum(v*v for v in p.values())]
                groups = [(kind,'all'), (kind,case['role']), (kind,case['model'])]
                if kind == 'hold':
                    groups.append((kind,case['role']+'/prefix'+str(sum(map(int,context)))))
                for group in groups:
                    t=totals[group]; t[0]+=1; t[1]+=losses[0]; t[2]+=losses[1]; t[3]+=briers[0]; t[4]+=briers[1]
                    c=clusters[group][case['seed']]; c[0]+=1; c[1]+=losses[1]-losses[0]; c[2]+=briers[1]-briers[0]
    rng = random.Random(284)
    result = []
    for (kind,group), (n,q,p,bq,bp) in sorted(totals.items()):
        blocks=list(clusters[(kind,group)].values())
        draws=[]
        for _ in range(1000):
            sample=[rng.choice(blocks) for _ in blocks]
            mass=sum(row[0] for row in sample)
            draws.append(sum(row[1] for row in sample)/mass)
        draws.sort()
        result.append(dict(kind=kind,group=group,observations=n,seedGroups=len(blocks),
                           broadNll=q/n,candidateNll=p/n,nllDelta=(p-q)/n,
                           broadBrier=bq/n,candidateBrier=bp/n,nllDelta95=[draws[25],draws[974]]))
    return result


def conditioned_hold(row, prefix, own_six, cut):
    available=[4-int(p)-int(own)-(1 if r==cut else 0) for r,(p,own) in enumerate(zip(prefix,own_six))]
    if min(available) < 0:
        raise ValueError('incompatible known cards')
    weights={}
    for key,p in row.items():
        ranks=list(map(int,key))
        if any(n>a for n,a in zip(ranks,available)):
            continue
        ratio=math.prod(math.comb(a,n)/math.comb(4-int(pfx),n)
                        for a,n,pfx in zip(available,ranks,prefix))
        weights[key]=p*ratio
    if not weights or min(weights.values()) <= 0:
        raise ValueError('lost legal hold support')
    return hold.normalized(weights)


def conditioned_discard(row, keep, own_six, cut):
    available=[4-int(k)-int(own) for k,own in zip(keep,own_six)]
    if min(available)<0:
        raise ValueError('incompatible known cards')
    weights={}
    for key,p in row.items():
        ranks=list(map(int,key))
        if any(n>a for n,a in zip(ranks,available)):
            continue
        copies=available[cut]-ranks[cut]
        if copies <= 0:
            continue
        ratio=math.prod(math.comb(a,n)/math.comb(4-int(k),n)
                        for a,n,k in zip(available,ranks,keep))
        weights[key]=p*ratio*copies
    if not weights or min(weights.values()) <= 0:
        raise ValueError('lost legal discard support')
    return hold.normalized(weights)


def hypothetical_panel(cases, broad_h, late_h, broad_d, late_d, seed):
    # Rebased scores have no behavioral ground-truth labels. They test routing,
    # support and depletion; predictive accuracy uses actual held-out scores.
    rng=random.Random(seed)
    test=[c for c in cases if c['partition']=='test']
    chosen=[]
    for role in ROLES:
        pool=[c for c in test if c['role']==role]
        rng.shuffle(pool)
        chosen.extend(pool[:32])
    if len(chosen)!=64:
        raise ValueError('insufficient independent-position panel')
    scenarios=[]
    checks=0
    for case in chosen:
        for actor_score,other_score in [(110,120),(111,100),(115,111),(120,120)]:
            use_late=late(actor_score)
            hrows=late_h if use_late else broad_h
            drows=late_d if use_late else broad_d
            key=(case['role'],case['keep'])
            d=conditioned_discard(drows[key],case['keep'],case['ownSix'],case['cutRank'])
            if d.get(case['discard'],0)<=0:
                raise ValueError('observed discard lost physical support')
            hold_checks=[]
            for observation in case['hold']:
                p=conditioned_hold(hrows[(case['role'],observation['prefix'])],observation['prefix'],case['ownSix'],case['cutRank'])
                if p.get(observation['remaining'],0)<=0:
                    raise ValueError('observed remaining hand lost physical support')
                if abs(math.fsum(p.values())-1)>1e-12:
                    raise ValueError('unnormalized hypothetical hold')
                checks+=1
                hold_checks.append(dict(prefix=observation['prefix'],remaining=observation['remaining'],
                                        probability=p[observation['remaining']],support=len(p)))
            scenarios.append(dict(role=case['role'],actorStartScore=actor_score,
                opponentStartScore=other_score,regime='late' if use_late else 'broad',
                ownSix=case['ownSix'],keep=case['keep'],discard=case['discard'],cutRank=case['cutRank'],
                seed=case['seed'],sourceGame=case['gameContentSha256'],
                discardProbability=d[case['discard']],discardSupport=len(d),hold=hold_checks))
    return dict(seed=str(seed),scenarios=scenarios,scenarioCount=len(scenarios),
                holdChecks=checks,passed=True,
                scope='Probability/support and start-of-hand routing checks, not action-strength or a score-aware behavioral oracle')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--hypothetical-seed',type=int)
    args=parser.parse_args()
    builder_sha=hold.file_digest(Path(__file__))
    args.output.mkdir(parents=True,exist_ok=True)
    config=json.loads(args.sources.read_bytes())
    if config.get('schemaVersion')!=1 or not config.get('sources'):
        raise ValueError('missing qualified sources')
    hbytes,dbytes,prior_seeds,provenance=checked_priors(args.root)
    original_h=read_hold(hbytes)
    original_d,suits,metadata=read_discards(dbytes)
    frozen=freeze_sources(config,args.output)
    evidence,counts=extract(config,args.output,frozen,prior_seeds)
    # Keep the requested larger prior fixed. Fresh late observations enter its
    # update once. A separate all-score refresh control tests whether more
    # contemporary data alone explains any gain. Tune that control against the
    # same late tuning positions, so it is not handicapped by a different target.
    broad_h,broad_d=original_h,original_d
    late_h,hcal=select(broad_h,counts,'hold')
    late_d,dcal=select(broad_d,counts,'discards')
    pooled=pooled_counts(counts)
    pooled['tune']={kind:counts['tune'][kind] for kind in ('hold','discards')}
    pooled_h,phcal=select(original_h,pooled,'hold')
    pooled_d,pdcal=select(original_d,pooled,'discards')
    support={kind:validate_rows(rows,kind) for kind,rows in [('hold',late_h),('discards',late_d)]}
    control_support={label:validate_rows(rows,kind) for label,rows,kind in [
        ('broadHold',broad_h,'hold'),('broadDiscards',broad_d,'discards'),
        ('pooledHold',pooled_h,'hold'),('pooledDiscards',pooled_d,'discards')]}
    late_hbytes,error=hold.pack(late_h)
    common_meta=dict(metadata,modelVersion='28.4',originalPriorSha256=sha(dbytes),
                     priorSourceGames=metadata['sourceGames'],sourceGames=len(evidence['games']),
                     evidenceSha256=sha(canonical(evidence)))
    candidate_meta=dict(common_meta,regime='actor-start-score-111-120',
                        broadPriorSha256=sha(dbytes),calibration=dcal,
                        observationsBySplit={s:sum(sum(r.values()) for r in counts[s]['discards'].values()) for s in SPLITS},
                        prior='Dirichlet update of fixed broad probabilities using novel late training seed groups')
    late_dbytes=pack_discards(late_d,suits,candidate_meta)
    pooled_meta=dict(common_meta,regime='all-scores-pooled-control',calibration=pdcal,
                     observationsBySplit={s:sum(sum(r.values()) for r in pooled[s]['discards'].values()) for s in SPLITS},
                     prior='Dirichlet update of fixed broad probabilities using all novel training seed groups once')
    files={'broad-hold.bin':hbytes,'broad-discards.bin':dbytes,
           'late-hold.bin':late_hbytes,'late-discards.bin':late_dbytes,
           'pooled-control-hold.bin':hold.pack(pooled_h)[0],
           'pooled-control-discards.bin':pack_discards(pooled_d,suits,pooled_meta)}
    for name,data in files.items():
        (args.output/name).write_bytes(data)
    # Validate serialized probabilities, including integer hold quantization.
    late_h=read_hold(late_hbytes)
    late_d,_,_=read_discards(late_dbytes)
    broad_h=read_hold(files['broad-hold.bin'])
    broad_d,_,_=read_discards(files['broad-discards.bin'])
    pooled_h=read_hold(files['pooled-control-hold.bin'])
    pooled_d,_,_=read_discards(files['pooled-control-discards.bin'])
    assessment=metrics(evidence['cases'],original_h,late_h,original_d,late_d)
    pooled_assessment=metrics(evidence['cases'],pooled_h,late_h,pooled_d,late_d)
    physical_assessment=metrics(evidence['cases'],original_h,late_h,original_d,late_d,physical=True)
    physical_pooled=metrics(evidence['cases'],pooled_h,late_h,pooled_d,late_d,physical=True)
    seed_path=args.output/'hypothetical-seed.json'
    if args.hypothetical_seed is not None:
        hypothesis_seed=args.hypothetical_seed
    elif seed_path.exists():
        hypothesis_seed=int(json.loads(seed_path.read_bytes())['seed'])
    else:
        hypothesis_seed=secrets.randbits(128)
    if str(hypothesis_seed) in prior_seeds or any(str(hypothesis_seed)==g['seed'] for g in evidence['games']):
        raise ValueError('hypothetical seed overlaps evidence')
    write_json(seed_path,dict(seed=str(hypothesis_seed)))
    panel=hypothetical_panel(evidence['cases'],broad_h,late_h,broad_d,late_d,hypothesis_seed)
    write_json(args.output/'hypotheticals.json',panel)
    report=dict(schemaVersion=1,modelVersion='28.4',threshold=111,productionActivated=False,
                wholeGamesRun=0,statistics=evidence['statistics'],bands=evidence['bands'],models=evidence['modelCounts'],
                priorEvidence=provenance,priorSeedGroupsExcluded=len(prior_seeds),
                calibration=hcal+dcal,pooledCalibration=phcal+pdcal,
                support=support,controlSupport=control_support,holdQuantizationError=error,assessment=assessment,
                pooledComparison=pooled_assessment,
                physicalAssessment=physical_assessment,physicalPooledComparison=physical_pooled,
                hypotheticals={k:v for k,v in panel.items() if k!='scenarios'},
                limits=['Prior snapshot contains older all-game late observations; new updates exclude all recorded prior seed groups.',
                        'The broad prior remains byte-identical. Only the pooled control uses ordinary new observations; late updates and control are tuned on the same late tuning positions.',
                        'Suit and decline factors are unchanged.',
                        'Rebased hypothetical scores validate invariants, not behavioral accuracy or playing strength.',
                        'Late regime uses the subject player score at hand start, not its current pegging score; opponent-near-win remains pooled.'])
    write_json(args.output/'assessment.json',report)
    if hold.file_digest(Path(__file__))!=builder_sha:
        raise ValueError('builder changed during generation; rebuild from one frozen version')
    manifest=dict(schemaVersion=1,modelVersion='28.4',regimeScore='subject player start-of-hand score',lateMinimum=111,
                  assets={name:dict(sha256=sha(data),bytes=len(data)) for name,data in files.items()},
                  builderSha256=builder_sha,sourceConfigSha256=hold.file_digest(args.sources),
                  evidenceSha256=hold.file_digest(args.output/'evidence.json.gz'),
                  assessmentSha256=hold.file_digest(args.output/'assessment.json'),
                  hypotheticalsSha256=hold.file_digest(args.output/'hypotheticals.json'),
                  sourceSnapshots=frozen,wholeGameValidation='deferred',activation='disabled')
    write_json(args.output/'manifest.json',manifest)
    print(json.dumps(dict(statistics=report['statistics'],hypotheticals=report['hypotheticals'],
                          selected=[{k:r[k] for k in ('kind','role','prefixLength','selected')} for r in hcal+dcal],
                          test=[r for r in assessment if r['group'] in ROLES])))


if __name__=='__main__':
    main()
