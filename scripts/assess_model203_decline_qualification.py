#!/usr/bin/env python3
"""Held-out decline counts and legal observations for a runtime posterior ablation."""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sqlite3

import build_model203_decline_factors as b
from analyze_model203_decline_factors import bucket


def rank_counts(cards):
    counts = Counter(c // 4 for c in cards)
    return [counts[r] for r in range(13)]


def cases(hand, engines, source_sha):
    remaining = [set(hand[p+'_keep']) for p in ('left','right')]
    discards = [set(hand[p+'_dealt'])-remaining[i] for i,p in enumerate(('left','right'))]
    played, history, series, count, go, last = [[],[]], [], [], 0, None, None
    for action,actor,card,before,after,engine in hand['plays']:
        if action == 2 or (before == 0 and series):
            if not history or history[-1][0] != 2:history.append((2,None,None))
            series,count,go,last=[],0,None,None
        if action == 2:continue
        if (b.qualified(engines[1-actor],source_sha) and 0<len(played[1-actor])<4
                and remaining[actor] and remaining[1-actor]):
            relative = lambda seat: None if seat is None else int(seat != actor)
            encoded = [28 if a==2 else (26+relative(s) if a==1 else r+13*relative(s)) for a,s,r in history]
            yield {'opponent': engines[1-actor], 'dealer': hand['dealer']==actor,
                   'ownRemaining':rank_counts(remaining[actor]), 'ownPlayed':rank_counts(played[actor]),
                   'opponentPlayed':rank_counts(played[1-actor]), 'ownDiscards':rank_counts(discards[actor]),
                   'turnRank':hand['cut_card']//4, 'series':series.copy(), 'count':count,
                   'go':relative(go), 'last':relative(last), 'history':encoded,
                   'truth':rank_counts(remaining[1-actor])}
        if action == 1:
            history.append((1,actor,None));go=actor
            continue
        history.append((0,actor,card//4));last=actor
        remaining[actor].remove(card);played[actor].append(card)
        series.append(card//4);count=after
        if count==31:
            history.append((2,None,None));series,count,go,last=[],0,None,None


def extract(output, fixtures):
    raw=json.loads(gzip.decompress((b.ROOT/'training/model203-decline-evidence.json.gz').read_bytes()))
    cal=json.loads((b.ROOT/'training/model203-decline-broad-calibration.json').read_text())
    records={}; stats=Counter();seen=set()
    # Original reserved games were never in the broad ledger, so add them from
    # the immutable calibration DB. Broad audit seeds are listed in the ledger.
    sources=[(s,False) for s in raw['sources'] if s['includedGames']]
    original=Path(cal['database'])
    sources.append(({'path':str(original),'sha256':b.file_digest(original)},True))
    with fixtures.open('w') as out:
        for source,is_original in sources:
            sha=source['sha256'];path=Path(source['path'])
            if Path(str(path)+'-wal').exists() and Path(str(path)+'-wal').stat().st_size:
                raise ValueError('mutable source')
            with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
                db.row_factory=sqlite3.Row
                normalized=bool(db.execute("SELECT 1 FROM sqlite_master WHERE name='compact_peg_plays'").fetchone())
                selected=(list(b.completed_games(db,'AND game_index>=500 AND game_index<1000')) if is_original
                          else [g for g in source['includedGames'] if bucket(g['random_seed'])==1])
                for game in selected:
                    engines=[game['left_engine'],game['right_engine']]
                    if not any(b.qualified(e,sha) for e in engines):continue
                    identity=(sha,game['game_id'])
                    if identity in seen:raise ValueError('duplicate heldout game')
                    seen.add(identity)
                    seed=str(game['random_seed']);group='original' if is_original else 'broad'
                    record=records.setdefault(group+':'+seed,{'seed':seed,'group':group,'games':0,'models':{}})
                    record['games']+=1
                    sample=is_original or int(hashlib.sha256(('posterior:'+seed).encode()).hexdigest()[:8],16)%8==0
                    for hand in b.game_hands(db,game['game_id'],normalized,engines):
                        try:events=b.hand_events(hand)
                        except ValueError:stats['invalidHands']+=1;continue
                        stats['validHands']+=1
                        for actor,override,cell,outcome in events:
                            engine=override or engines[actor]
                            if b.qualified(engine,sha):record['models'].setdefault(engine,b.empty_counts())[cell][outcome]+=1
                        # Refuse mixed-policy hands for the posterior diagnostic.
                        if sample and all(a!=0 or e==engines[s] for a,s,c,x,y,e in hand['plays']):
                            for index,case in enumerate(cases(hand,engines,sha)):
                                case.update({'group':group,'seed':seed,'id':game['game_id']+':'+str(hand['hand_number'])+':'+str(index)})
                                out.write(json.dumps(case,separators=(',',':'))+'\n');stats['posteriorCases']+=1
    output.write_text(json.dumps({'records':records,'stats':dict(stats)},sort_keys=True))
    print(json.dumps(stats))


def score(records, assets):
    factors=[]
    for path in assets:
        data=json.loads(path.read_text());old=data['schemaVersion']==3
        factors.append([max(1,min(999999,data['factors'][c]['byCardOrdinal'][o]['multiplierPpm']
            if data['factors'][c]['byCardOrdinal'][o]['multiplierPpm'] is not None else data['factors'][c]['multiplierPpm']))
            for c in b.CATEGORIES for o in b.ORDINALS] if old else [p for c in b.CATEGORIES for p in data['factors'][c]])
    totals={};clusters=defaultdict(list)
    for key,record in sorted(records.items()):
        by_family=defaultdict(b.empty_counts)
        for model,rows in record['models'].items():b.add_counts(by_family[b.model_version(model).split('.')[0]],rows)
        combined=b.empty_counts()
        for rows in by_family.values():b.add_counts(combined,rows)
        by_family['all']=combined
        for family,rows in by_family.items():
            n=sum(a+d for a,d,_ in rows)
            if not n:continue
            label=record['group']+':'+family
            losses=[b.loss(rows,p) for p in factors]
            total=totals.setdefault(label,{'opportunities':0,'totalLoss':[0.]*len(factors)})
            total['opportunities']+=n
            for i,x in enumerate(losses):total['totalLoss'][i]+=n*x
            clusters[label].append((n,[n*(losses[-1]-x) for x in losses[:-1]]))
    result={}
    for label,total in totals.items():
        result[label]={'opportunities':total['opportunities'],'nll':[x/total['opportunities'] for x in total['totalLoss']], 'delta95':[]}
        data=clusters[label]
        for i in range(len(factors)-1):
            rng=random.Random(203);draws=[]
            for _ in range(2000):
                sample=rng.choices(data,k=len(data));draws.append(sum(d[i] for n,d in sample)/sum(n for n,d in sample))
            draws.sort();result[label]['delta95'].append([draws[49],draws[1949]])
    return result


def posterior_report(path):
    totals = {}
    clusters = defaultdict(dict)
    for line in path.open():
        r = json.loads(line)
        family = b.model_version(r['opponent']).split('.')[0]
        probabilities = r['probabilities']
        if any(not 0 < p <= 1 for p in probabilities):
            raise ValueError('actual hand assigned zero/invalid probability')
        losses = [-math.log(p) for p in probabilities]
        for label in (r['group']+':'+family, r['group']+':all'):
            total = totals.setdefault(label, {'positions':0, 'affectedPositions':0,
                                              'loss':[0.]*3, 'brier':[0.]*3})
            total['positions'] += 1
            total['affectedPositions'] += int(max(probabilities)-min(probabilities)>1e-13)
            row = clusters[label].setdefault(r['seed'], [0, 0., 0.])
            row[0] += 1
            for i in range(3):
                total['loss'][i] += losses[i]
                total['brier'][i] += r['brier'][i]
                if i < 2:row[i+1] += losses[2]-losses[i]
    for label,total in totals.items():
        n=total['positions']
        total['nll']=[x/n for x in total.pop('loss')]
        total['brier']=[x/n for x in total['brier']]
        total['zeroProbabilityObservations']=0
        data=[row for seed,row in sorted(clusters[label].items())]
        total['seedClusters']=len(data);total['delta95']=[]
        for i in range(1,3):
            rng=random.Random(203);draws=[]
            for _ in range(2000):
                sample=rng.choices(data,k=len(data));draws.append(sum(r[i] for r in sample)/sum(r[0] for r in sample))
            draws.sort();total['delta95'].append([draws[49],draws[1949]])
    return totals


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--counts',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True)
    p.add_argument('--factors',type=Path,nargs='+');p.add_argument('--output',type=Path)
    p.add_argument('--posteriors',type=Path);p.add_argument('--check',action='store_true')
    a=p.parse_args()
    if not a.counts.exists() or not a.fixtures.exists():extract(a.counts,a.fixtures)
    if a.factors:
        data=json.loads(a.counts.read_text());result={'assets':[str(x) for x in a.factors],
              'hashes':[b.file_digest(x) for x in a.factors],'stats':data['stats'],'declinePrediction':score(data['records'],a.factors)}
        result['inputHashes']={str(p):b.file_digest(p) for p in (a.counts,a.fixtures)}
        if a.posteriors:
            result['posteriorPrediction']=posterior_report(a.posteriors)
            result['inputHashes'][str(a.posteriors)]=b.file_digest(a.posteriors)
        result['scope']='Decline-factor ablation in Model 20.3; all other assets fixed. Entire seeds excluded from decline fitting. Additional audit seeds were not excluded from every other historical asset. No playing-strength claim.'
        a.output.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n');print(json.dumps(result['declinePrediction']))
        if a.check:
            for metric in ('declinePrediction','posteriorPrediction'):
                for group in ('original:all','broad:all'):
                    values=result[metric][group]['nll']
                    if values[2] > min(values[:2]):
                        raise SystemExit('prediction regression: '+metric+' '+group)


if __name__=='__main__':main()
