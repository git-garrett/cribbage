#!/usr/bin/env python3
"""Read-only decline-factor audit; candidate rates never replace runtime assets.

Select complete seeds globally (including paired games and repeated matchups),
remove their raw counts from training, tune on one seed bucket, evaluate another.
The frozen 13.23/13.215 validation split remains a separate diagnostic.
"""
import argparse
from collections import Counter, defaultdict
import copy
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sqlite3

import build_model203_decline_factors as b

SALT = 'model203-decline-audit-v1:'
STRENGTHS = (0, 1, 10, 100, 1000, 10000)


def family(engine):
    version = b.model_version(engine)
    return version.split('.')[0] if version else 'human'


def bucket(seed):
    return int.from_bytes(hashlib.sha256((SALT + str(seed)).encode()).digest()[:8], 'big') % 10


def merge(items):
    rows = b.empty_counts()
    for value in items:
        b.add_counts(rows, value)
    return rows


def posterior(rows, parent=None, strength=0, alpha=.5):
    """Fractional pseudo-counts: local data plus a leave-group-out prior."""
    parent_ppm = b.probabilities(parent, 0) if parent is not None else None
    result = []
    for i, (a, d, _) in enumerate(rows):
        group = rows[i // 3 * 3:i // 3 * 3 + 3]
        n = a + d
        pooled_n = sum(x + y for x, y, _ in group)
        pooled_p = (sum(y for _, y, _ in group) + .5) / (pooled_n + 1)
        q = parent_ppm[i] / 1e6 if parent_ppm else pooled_p
        p = (d + alpha + strength * q) / (n + 2 * alpha + strength) if n else q
        result.append(max(1, min(999999, round(p * 1e6))))
    return result


def classifiers(hand, engines, stats):
    """Count private/public safe-category differences on valid held opportunities.

    Also compare the refreshed event extractor with the frozen category function
    on identical legal histories, independent of the legacy database decoder.
    """
    import build_model1322_decline_factors as old
    remaining = [Counter(c // 4 for c in hand[p + '_keep']) for p in ('left', 'right')]
    known = [Counter(c // 4 for c in list(hand[p + '_dealt']) + [hand['cut_card']]) for p in ('left', 'right')]
    public, played, series, go = [Counter(), Counter()], [0, 0], [], None
    old_rows = old.empty_counts()
    for action, actor, card, before, after, engine in hand['plays']:
        if action == 2:
            series, go = [], None
            continue
        if before == 0 and series:
            series, go = [], None
        if action == 1:
            go = actor
            continue
        actual = card // 4
        if b.eligible(engine or engines[actor]):
            old.observe_action(old_rows, [remaining[actor][r] for r in range(13)],
                sum(remaining[1-actor].values()),
                [known[actor][r] + public[1-actor][r] for r in range(13)],
                series, before, actual, played[actor] + 1, go == 1-actor)
            if played[actor] < 3 and sum(remaining[1-actor].values()):
                categories = b.completions(tuple(series))
                competing = categories[actual] is not None or after in (15, 31)
                for candidate, category in enumerate(categories):
                    if (category not in (2,3) or before + b.VALUES[candidate] > 31
                            or not remaining[actor][candidate] or (actual != candidate and competing)):
                        continue
                    common = go == 1-actor or before + 2*b.VALUES[candidate] > 31
                    private_safe = common or known[actor][candidate] + public[1-actor][candidate] >= 4
                    public_safe = common or public[0][candidate] + public[1][candidate] + int(hand['cut_card']//4 == candidate) >= 3
                    stats['heldPairRoyalOpportunities'] += 1
                    stats['privateSafe'] += int(private_safe)
                    stats['publicSafe'] += int(public_safe)
                    stats['privateOnlySafe'] += int(private_safe and not public_safe)
                    stats['publicOnlySafe'] += int(public_safe and not private_safe)
        remaining[actor][actual] -= 1
        public[actor][actual] += 1
        played[actor] += 1
        series.append(actual)
        if after == 31:
            series, go = [], None
    expected = [[old_rows[c][o][f] for f in ('accepted','declinesWithCardHeld','declinesWithoutCardHeld')]
                for c in b.CATEGORIES for o in b.ORDINALS]
    actual = b.empty_counts()
    for actor, engine, cell, outcome in b.hand_events(hand):
        if b.eligible(engine or engines[actor]):actual[cell][outcome] += 1
    if actual != expected:
        raise AssertionError('refreshed versus frozen category extraction differs')
    stats['categoryParityHands'] += 1


def extract(value):
    # Values are raw counts by seed and actor, allowing seed-cluster uncertainty.
    records = {}
    stats = Counter()
    for source in value['sources']:
        selected = [g for g in source['includedGames'] if bucket(g['random_seed']) < 2]
        if not selected:
            continue
        path = Path(source['path'])
        if Path(str(path)+'-wal').exists() and Path(str(path)+'-wal').stat().st_size:
            raise ValueError('mutable source: '+str(path))
        before = (path.stat().st_size, path.stat().st_mtime_ns)
        with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            normalized = bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='compact_peg_plays'").fetchone())
            for game in selected:
                seed = str(game['random_seed'])
                record = records.setdefault(seed, {'split': bucket(seed), 'games': 0, 'models': {}})
                record['games'] += 1
                engines = [game['left_engine'], game['right_engine']]
                for hand in b.game_hands(db, game['game_id'], normalized, engines):
                    try:
                        events = b.hand_events(hand)
                    except ValueError:
                        stats['invalidHands'] += 1
                        continue
                    stats['validHands'] += 1
                    # Bounded diagnostic sample, taken from every source.
                    if int(hashlib.sha256((str(game['game_id'])+':'+str(hand['hand_number'])).encode()).hexdigest()[:8],16) % 20 == 0:
                        classifiers(hand, engines, stats)
                    for actor, engine, cell, outcome in events:
                        engine = engine or engines[actor]
                        if b.eligible(engine):
                            record['models'].setdefault(engine, b.empty_counts())[cell][outcome] += 1
        if before != (path.stat().st_size, path.stat().st_mtime_ns):
            raise ValueError('source changed: '+str(path))
    train = copy.deepcopy(value['countsByModel'])
    for record in records.values():
        for engine, rows in record['models'].items():
            for target, removed in zip(train[engine], rows):
                for i in range(3):target[i] -= removed[i]
    if any(n < 0 for rows in train.values() for row in rows for n in row):
        raise ValueError('holdout subtraction is inconsistent with retained evidence')
    return {'schemaVersion':1, 'salt':SALT, 'evidenceSha256':b.digest(b.canonical(value)),
            'sourceHashes':[s['sha256'] for s in value['sources']], 'train':train,
            'records':records,'stats':dict(stats)}


def prediction(train, mode, strength=0, alpha=.5):
    all_rows = merge(train.values())
    if mode == 'pooled':
        return {k:posterior(all_rows, alpha=alpha) for k in train}
    if mode == 'modernTable':
        local = merge(v for k,v in train.items() if family(k)=='20')
        parent = merge(v for k,v in train.items() if family(k)!='20')
        return {k:posterior(local,parent,strength) for k in train}
    result = {}
    for k in train:
        match = (lambda x: family(x)==family(k)) if mode == 'family' else (lambda x: x==k)
        local = merge(v for key,v in train.items() if match(key))
        parent = merge(v for key,v in train.items() if not match(key))
        result[k] = posterior(local,parent,strength)
    return result


def metrics(rows_by_model, predictions):
    groups = defaultdict(list)
    for k, rows in rows_by_model.items():
        n = sum(a+d for a,d,_ in rows)
        if n: groups[family(k)].append((n,b.loss(rows,predictions[k])))
    by_family = {k:{'opportunities':sum(n for n,_ in values),
                       'nll':sum(n*x for n,x in values)/sum(n for n,_ in values)}
                 for k,values in groups.items()}
    n = sum(v['opportunities'] for v in by_family.values())
    return {'families':by_family, 'nll':sum(v['opportunities']*v['nll'] for v in by_family.values())/n,
            'equalFamilyNll':sum(v['nll'] for v in by_family.values())/len(by_family)}


def evaluate(audit):
    train = audit['train']
    splits = [defaultdict(b.empty_counts),defaultdict(b.empty_counts)]
    seed_games = [Counter(),Counter()]
    for seed,record in sorted(audit['records'].items()):
        for k,rows in sorted(record['models'].items()):b.add_counts(splits[record['split']][k],rows)
        seed_games[record['split']]['seeds'] += 1
        seed_games[record['split']]['games'] += record['games']
    options = []
    for mode in ('pooled','family','model','modernTable'):
        for strength in ((0,) if mode=='pooled' else STRENGTHS):
            p = prediction(train,mode,strength)
            options.append({'mode':mode,'strength':strength,'tuning':metrics(splits[0],p)})
    chosen = {}
    for mode in ('pooled','family','model','modernTable'):
        candidates=[o for o in options if o['mode']==mode]
        # Current-20 generic table is intentionally tuned only to that target
        # family. Family/model predictors are tuned with equal family weights.
        key=(lambda o:o['tuning']['families']['20']['nll']) if mode=='modernTable' else (lambda o:o['tuning']['equalFamilyNll'])
        selected=min(candidates,key=key)
        p=prediction(train,mode,selected['strength'])
        chosen[mode]={'strength':selected['strength'],'validation':metrics(splits[1],p)}
    bootstrap={}
    baseline=prediction(train,'pooled')
    for mode in ('family','model','modernTable'):
        candidate=prediction(train,mode,chosen[mode]['strength'])
        contributions=[]
        for _,record in sorted(audit['records'].items()):
            if record['split']!=1:continue
            n, delta = 0,0.
            for k,rows in sorted(record['models'].items()):
                if mode=='modernTable' and family(k)!='20':continue
                count=sum(a+d for a,d,_ in rows)
                if count:
                    n+=count;delta+=count*(b.loss(rows,candidate[k])-b.loss(rows,baseline[k]))
            if n:contributions.append((n,delta))
        rng=random.Random(203)
        draws=[]
        for _ in range(2000):
            sample=rng.choices(contributions,k=len(contributions))
            draws.append(sum(d for _,d in sample)/sum(n for n,_ in sample))
        draws.sort()
        bootstrap[mode]={'seedClusters':len(contributions),'deltaNll95Percentile':[draws[49],draws[1949]],
                         'scope':'20 family' if mode=='modernTable' else 'all families'}
    return {'split':{'salt':SALT,'modulo':10,'tuningBucket':0,'validationBucket':1,
                     'seedsAndGames':[dict(v) for v in seed_games]},'options':options,
            'chosen':chosen,'bootstrap':bootstrap,'diagnostics':audit['stats']}


def original_split(value, chosen_strength):
    calibration=json.loads((b.ROOT/'training/model203-decline-broad-calibration.json').read_text())
    splits,_,_=b.heldout(Path(calibration['database']))
    rows=merge(value['countsByModel'].values())
    old=json.loads(b.LEGACY.read_text())['factors']
    old_ppm=[max(1,min(999999,old[c]['byCardOrdinal'][o]['multiplierPpm']
        if old[c]['byCardOrdinal'][o]['multiplierPpm'] is not None else old[c]['multiplierPpm']))
        for c in b.CATEGORIES for o in b.ORDINALS]
    new_ppm=b.probabilities(rows,0)
    candidates=prediction(value['countsByModel'],'family',chosen_strength)
    modern=candidates['schell_table-peg_table-20.0']
    ablations={name:{'tuningNll':b.loss(splits[0],p),'validationNll':b.loss(splits[1],p)}
               for name,p in [('oldFloored',old_ppm),('refreshedUnsmoothed',posterior(rows,alpha=0)),
                              ('refreshedJeffreys',new_ppm),('current20Profile',modern)]}
    decomposition=[]
    for i,(a,d,_) in enumerate(splits[1]):
        if not a+d:continue
        old_p,new_p=old_ppm[i]/1e6,new_ppm[i]/1e6
        extra=-a*math.log((1-new_p)/(1-old_p))-d*math.log(new_p/old_p)
        decomposition.append({'category':b.CATEGORIES[i//3],'ordinal':b.ORDINALS[i%3],
            'opportunities':a+d,'declines':d,'observedProbability':d/(a+d),
            'oldProbability':old_p,'refreshedProbability':new_p,'extraTotalNll':extra})
    prior_grid=[{'alpha':a,'beta':a,'tuningNll':b.loss(splits[0],posterior(rows,alpha=a)),
                  'validationNll':b.loss(splits[1],posterior(rows,alpha=a))}
                for a in (0,.01,.1,.5,1,5,50,500)]
    pair_rates=[]
    for k,r in value['countsByModel'].items():
        a,d,_=r[6]
        pair_rates.append({'model':k,'opportunities':a+d,'declines':d,'rate':d/(a+d) if a+d else None})
    return {'ablations':ablations,'decomposition':decomposition,'symmetricPriorGrid':prior_grid,
            'firstPairRatesByModel':pair_rates,'validationOpportunities':sum(a+d for a,d,_ in splits[1]),
            'candidateFamilyProfiles':{f:{c:candidates[next(k for k in candidates if family(k)==f)][i*3:i*3+3]
                                        for i,c in enumerate(b.CATEGORIES)} for f in ('9','13','20')}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    value=json.loads(gzip.decompress((b.ROOT/'training/model203-decline-evidence.json.gz').read_bytes()))
    if args.cache.exists():
        audit=json.loads(gzip.decompress(args.cache.read_bytes()))
        if audit['evidenceSha256']!=b.digest(b.canonical(value)) or audit['salt']!=SALT:
            raise ValueError('stale audit cache')
    else:
        audit=extract(value)
        args.cache.parent.mkdir(parents=True,exist_ok=True)
        args.cache.write_bytes(gzip.compress(b.canonical(audit),mtime=0))
    report=evaluate(audit)
    report['evidenceSha256']=audit['evidenceSha256']
    report['auditCountsSha256']=b.file_digest(args.cache)
    report['originalSplit']=original_split(value,report['chosen']['family']['strength'])
    report['scope']='Research only; known-family conditioning is not implemented in the runtime. No asset replacement or playing-strength claim.'
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'splits':report['split'],'chosen':report['chosen'],
                      'bootstrap':report['bootstrap'],'diagnostics':report['diagnostics']}))


if __name__=='__main__':main()
