#!/usr/bin/env python3
"""Assess a hold refresh and adopt cohort reweighting only after held-out gains.

Model validation is blocked by paired deal seed; human validation is blocked by
game. Human labels used to assess weighting are removed from the comparison
prior. All original raw evidence remains available for future analyses.
"""
import argparse
from collections import Counter
import gzip
import json
from pathlib import Path
import sqlite3
import struct

import numpy as np

import build_model203_hold as h
import build_model132_keep_prior as historical


CONTEXTS = [(role,prefix) for role in h.ROLES for n in range(4) for prefix in h.keys(n)]
CONTEXT_INDEX = {c:i for i,c in enumerate(CONTEXTS)}
CELLS = [(role,prefix,hand) for role,prefix in CONTEXTS for hand in h.keys(4-sum(h.counts(prefix))) if h.physically_valid(prefix,hand)]
CELL_INDEX = {c:i for i,c in enumerate(CELLS)}
OFFSETS = np.cumsum([0]+[sum(h.physically_valid(p,x) for x in h.keys(4-sum(h.counts(p)))) for _,p in CONTEXTS])[:-1]
LENGTHS = np.array([sum(h.counts(p)) for _,p in CONTEXTS])


def vector(rows):
    return np.array([rows[r,p][hand] for r,p,hand in CELLS])


def read_binary(path):
    data = path.read_bytes()
    if data[:8] != h.MAGIC: raise ValueError('wrong hold binary')
    _,contexts,_,cb,rb = struct.unpack_from('<IIIII',data,8)
    base = 28+contexts*cb
    rows = {}
    for i in range(contexts):
        role,*record = struct.unpack_from('<B13BII',data,28+i*cb)
        prefix = ''.join(map(str,record[:13]));first,length=record[13:]
        row = {}
        for j in range(first,first+length):
            *hand,weight=struct.unpack_from('<13BQ',data,base+j*rb)
            row[''.join(map(str,hand))]=weight
        rows[h.ROLES[role],prefix] = h.normalized(row)
    return vector(rows)


def recover_cohorts(prior):
    cohorts = {c:{r:Counter() for r in h.ROLES} for c in historical.COHORTS}
    humans = {}
    for source in prior['sources']:
        path=Path(source['path'])
        if h.file_digest(path) != source['sha256']: raise ValueError('historical source changed')
        if source['adapter']=='compact-benchmark':
            historical.tally_compact_database(path,cohorts)
        else:
            # This frozen source has completed uploads only. Match the original
            # published tally exactly before trusting recovered human labels.
            with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
                tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                for table,column,wrapped in [('game_uploads','events_json',False),('cribbage_completed_game_uploads','payload_json',True)]:
                    if table not in tables: continue
                    for game,encoded in db.execute('SELECT game_id,'+column+' FROM '+table):
                        payload=json.loads(encoded);events=payload.get('events',[]) if wrapped else payload
                        for event in events:
                            parsed=historical.human_keep_from_event(event)
                            if parsed:
                                number,role,keep=parsed
                                historical.record_human_keep(humans,game,number,role,keep)
            for role,keep in humans.values(): cohorts['human'][role][keep]+=1
    recovered={r:Counter() for r in h.ROLES}
    for roles in cohorts.values():
        for role,row in roles.items(): recovered[role].update(historical.normalized_counts(row))
    if recovered != prior['roles']: raise ValueError('recovered cohorts do not reproduce the frozen prior')
    return cohorts,humans


def human_split(game):
    bucket=int(h.digest(('model203-hold-human-v1:'+game).encode())[:8],16)%5
    return 'tune' if bucket==0 else 'test' if bucket==1 else 'train'


def cohort_prior(cohorts, humans, human_weight):
    human_counts={r:Counter() for r in h.ROLES}
    for (game,_),(role,keep) in humans.items():
        if human_split(game)=='train': human_counts[role][keep]+=1
    result={'version':1,'roles':{}}
    for role in h.ROLES:
        row=Counter()
        for cohort in ('model-9.x','model-13.x','human'):
            weight=human_weight if cohort=='human' else 1.
            counts=human_counts[role] if cohort=='human' else cohorts[cohort][role]
            row.update({k:v*weight for k,v in h.normalized(counts).items()})
        result['roles'][role]=dict(row)
    return result


def model_cases(paths, group):
    cases=[];sources=[]
    for path in paths:
        before=h.file_digest(path)
        with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
            db.row_factory=sqlite3.Row
            games=list(db.execute('SELECT * FROM compact_games WHERE game_index<1000 AND included_in_tables=1 AND reproducible=1 '
                'AND winner IN (0,1) AND (final_left_score>=121 OR final_right_score>=121) ORDER BY game_index'))
            if len(games)!=1000: raise ValueError('expected 1000 reserved games per orientation')
            for game in games:
                partition='tune' if game['game_index']<500 else 'test'
                for hand in h.game_hands(db,game['game_id']):
                    for side,engine in enumerate((game['left_engine'],game['right_engine'])):
                        if not h.eligible(engine): continue
                        try: observations=h.observations(hand,side)
                        except ValueError: continue
                        for role,prefix,keep in observations:
                            cases.append([group,partition,str(game['random_seed']),CONTEXT_INDEX[role,prefix],CELL_INDEX[role,prefix,keep]])
        if h.file_digest(path)!=before: raise ValueError('validation source changed')
        sources.append({'path':str(path),'sha256':before,'games':1000})
    return cases,sources


def scores(p,cases):
    indices=np.array([c[4] for c in cases]);contexts=np.array([c[3] for c in cases])
    actual=p[indices]
    if not np.all(actual>0): raise ValueError('lost positive held-out support')
    squares=np.add.reduceat(p*p,OFFSETS)
    return np.array([-np.log(actual),1.-2.*actual+squares[contexts]]).T


def summarize(values,cases):
    result={}
    for group in ('13.x','20.x','human'):
        for partition in ('tune','test'):
            mask=np.array([c[0]==group and c[1]==partition for c in cases])
            selected=values[mask]
            result[group+'/'+partition]={'observations':len(selected),'nll':float(selected[:,0].mean()),'brier':float(selected[:,1].mean())}
            for n in range(4):
                sub=mask & np.array([LENGTHS[c[3]]==n for c in cases])
                if sub.any(): result[group+'/'+partition+'/prefix'+str(n)]={'observations':int(sub.sum()),'nll':float(values[sub,0].mean()),'brier':float(values[sub,1].mean())}
    return result


def compare(a,b,cases):
    result={};rng=np.random.default_rng(203)
    for group in ('13.x','20.x','human'):
        clusters={}
        for c,delta in zip(cases,a-b):
            if c[0]!=group or c[1]!='test': continue
            row=clusters.setdefault(c[2],np.zeros(3));row[0]+=1;row[1:]+=delta
        array=np.array(list(clusters.values()))
        draws=np.array([array[rng.integers(len(array),size=len(array))].sum(axis=0) for _ in range(2000)])
        total=array.sum(axis=0)
        result[group]={'clusters':len(array),'observations':int(total[0]),'nllDelta':float(total[1]/total[0]),'brierDelta':float(total[2]/total[0]),
            'nllDelta95':np.quantile(draws[:,1]/draws[:,0],[.025,.975]).tolist(),'brierDelta95':np.quantile(draws[:,2]/draws[:,0],[.025,.975]).tolist()}
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',type=Path,required=True)
    parser.add_argument('--original-asset',type=Path,required=True)
    parser.add_argument('--original-evidence',type=Path,required=True)
    parser.add_argument('--prior',type=Path,required=True)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--modern-database',type=Path,action='append',required=True)
    parser.add_argument('--historical-database',type=Path,action='append',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    value=json.loads(gzip.decompress(args.evidence.read_bytes()));h.validate_evidence(value)
    prior=json.loads(args.prior.read_bytes());config=json.loads(args.config.read_bytes())
    strengths=config['smoothingStrengthByPrefixLength'];physical=config['physicalPriorMixture']
    cohorts,humans=recover_cohorts(prior)
    cases,sources=model_cases(args.historical_database,'13.x')
    more,extra=model_cases(args.modern_database,'20.x');cases+=more;sources+=extra
    # Verify all model holdout seeds were reserved before import.
    reserved=set(value['reservedValidationSeeds'])
    if any(c[2] not in reserved for c in cases): raise ValueError('unreserved model validation seed')
    imported={str(g['seed']) for s in value['sources'] for g in s.get('includedGames',[])}
    if imported & {c[2] for c in cases}: raise ValueError('validation seed leaked into imported training')
    for (game,_),(role,keep) in sorted(humans.items()):
        partition=human_split(game)
        if partition!='train': cases.append(['human',partition,h.digest(game.encode()),CONTEXT_INDEX[role,h.ZERO],CELL_INDEX[role,h.ZERO,keep]])
    (out/'cases.json.gz').write_bytes(gzip.compress(h.canonical({'sources':sources,'cases':cases}),mtime=0))
    (out/'cohorts.json').write_bytes(h.canonical({'counts':cohorts,'sources':prior['sources'],
        'humans':[[h.digest(game.encode()),number,role,keep,human_split(game)] for (game,number),(role,keep) in sorted(humans.items())]})+b'\n')
    fit=lambda older,p:vector(h.distributions(value,p,strengths,physical,older))
    old=scores(read_binary(args.original_asset),cases)
    unweighted=scores(fit(1.,prior),cases)
    fair_prior=cohort_prior(cohorts,humans,1.)
    fair=scores(fit(1.,fair_prior),cases)
    original_value=json.loads(gzip.decompress(args.original_evidence.read_bytes()))
    h.validate_evidence(original_value)
    original_fair=scores(vector(h.distributions(original_value,fair_prior,strengths,physical)),cases)
    fair_summary=summarize(fair,cases)
    options=[];candidates={}
    for older in (1.,.5,.25,.1):
        for human_weight in (1.,.5,.1,0.):
            candidate_prior=cohort_prior(cohorts,humans,human_weight)
            values=scores(fit(older,candidate_prior),cases)
            summary=summarize(values,cases)
            item={'olderModelWeight':older,'humanCohortRelativeWeight':human_weight,
                'tuningNllByGroup':{g:summary[g+'/tune']['nll'] for g in ('13.x','20.x','human')}}
            item['eligibleOnTuning']=item['tuningNllByGroup']['human']<=fair_summary['human/tune']['nll']
            item['objective']=(item['tuningNllByGroup']['13.x']+item['tuningNllByGroup']['20.x'])/2.
            options.append(item);candidates[older,human_weight]=(values,candidate_prior)
            print(json.dumps(item),flush=True)
    selected=min((o for o in options if o['eligibleOnTuning']),key=lambda o:o['objective'])
    candidate,candidate_prior=candidates[selected['olderModelWeight'],selected['humanCohortRelativeWeight']]
    # Models compare directly with the refreshed asset. Human labels are held
    # out of BOTH comparison priors, avoiding the installed prior's leakage.
    control=unweighted.copy()
    human_mask=np.array([c[0]=='human' for c in cases]);control[human_mask]=fair[human_mask]
    difference=compare(candidate,control,cases)
    clear=all(r['nllDelta95'][1]<0 and r['brierDelta']<=0 for r in difference.values())
    changed=(selected['olderModelWeight'],selected['humanCohortRelativeWeight'])!=(1.,1.)
    adopt=clear and changed
    selected_summary=summarize(candidate,cases)
    # An aggregate gain must not conceal worse mean NLL at any model prefix.
    controls=summarize(control,cases)
    prefix_safe=all(selected_summary[k]['nll']<=controls[k]['nll'] for k in controls if '/test/prefix' in k)
    adopt=adopt and prefix_safe
    chosen_prior=candidate_prior if adopt else prior
    chosen_config=dict(config)
    chosen_config['olderModelEvidenceWeight']=selected['olderModelWeight'] if adopt else 1.
    chosen_prior_bytes=h.canonical(chosen_prior)+b'\n' if adopt else args.prior.read_bytes()
    chosen_config['openingBackoffSha256']=h.digest(chosen_prior_bytes)
    refresh_control=old.copy();refresh_values=unweighted.copy()
    refresh_control[human_mask]=original_fair[human_mask]
    refresh_values[human_mask]=fair[human_mask]
    report={'schemaVersion':1,'oldAssetSha256':h.file_digest(args.original_asset),'evidenceSha256':h.file_digest(args.evidence),
        'sourceGames':len(value['games']),'validationSources':sources,'smoothingStrengthsUnchanged':strengths,
        'humanPartitionHands':dict(Counter(human_split(g) for g,_ in humans)),
        'options':options,'selectedOnTuning':selected,'weightingAdopted':adopt,'clearAcrossGroups':clear,'noWorsePrefixMean':prefix_safe,
        'acceptanceRule':'Tune on equal-weight 13.x/20.x NLL with no worse human tuning NLL. Adopt only if held-out NLL paired 95% upper bound <0 in all three groups, Brier mean no worse, and no model-prefix mean NLL worsens.',
        'metrics':{'original':summarize(old,cases),'refreshed':summarize(unweighted,cases),'humanFairOriginal':summarize(original_fair,cases),'humanFairControl':fair_summary,'candidate':selected_summary},
        'candidateVersusControl':difference,'refreshVersusOriginal':compare(refresh_values,refresh_control,cases),
        'limitations':'Model metrics are unconditional role/prefix predictions, not playing strength. Historical aggregates lack per-seed records. Original/refreshed human metrics are in-sample; human comparisons use humanFairOriginal/humanFairControl with test games removed from both priors.'}
    for name,obj in [('assessment.json',report),('chosen-config.json',chosen_config)]:
        (out/name).write_bytes(h.canonical(obj)+b'\n')
    (out/'chosen-prior.json').write_bytes(chosen_prior_bytes)
    print(json.dumps({'weightingAdopted':adopt,'candidateVersusControl':difference,'refreshVersusOriginal':report['refreshVersusOriginal']}),flush=True)


if __name__=='__main__': main()
