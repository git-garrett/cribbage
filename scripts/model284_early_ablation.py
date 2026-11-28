#!/usr/bin/env python3
"""Matched early-only/all-score belief experiment; no gameplay or inherited prior.

Physical support is neutral. Learned backoffs use each arm's training data only.
Both arms tune on the same early seed groups and test on unseen early seeds.
"""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import gzip
import json
import math
from pathlib import Path
import platform
import secrets
import sqlite3

import numpy as np

import build_model284_late_beliefs as b

h = b.hold
STRENGTHS = (.1, .3) + b.STRENGTHS
CHOOSE = np.array([[math.comb(n, k) if k <= n else 0 for k in range(5)] for n in range(5)], dtype=float)


def neutral_hold(prefix, opening=None):
    p = list(map(int, prefix))
    result = {}
    for key in h.keys(4-sum(p)):
        r = list(map(int, key))
        initial = [a+c for a,c in zip(p,r)]
        if max(initial)>4:
            continue
        if opening is None:
            result[key] = math.prod(math.comb(4-a,c) for a,c in zip(p,r))
        else:
            result[key] = opening[''.join(map(str,initial))] * math.prod(math.comb(a,c) for a,c in zip(initial,p))
    return h.normalized(result)


def discard_backoffs(training):
    # Same estimator as the broad 20.3 builder: 99% within-arm role marginal,
    # 1% physical floor; condition on the cards already in the four-card keep.
    result = {}
    for role in b.ROLES:
        marginal = Counter()
        for (r,_),row in training.items():
            if r==role:
                marginal.update(row)
        n = sum(marginal.values())
        if n<=0:
            raise ValueError('no role training evidence')
        broad = {}
        for pair in h.keys(2):
            physical = math.prod(math.comb(4,int(c)) for c in pair)
            broad[pair] = .99*marginal[pair]/n + .01*physical/1326
        for keep in h.keys(4):
            weights = {}
            for pair,probability in broad.items():
                if any(int(k)+int(d)>4 for k,d in zip(keep,pair)):
                    continue
                ratio = math.prod(math.comb(4-int(k),int(d))/math.comb(4,int(d)) for k,d in zip(keep,pair))
                weights[pair] = probability*ratio
            result[(role,keep)] = h.normalized(weights)
    return result


def fit_group(priors, training, tuning):
    n = sum(sum(tuning.get(key,{}).values()) for key in priors)
    if not n:
        raise ValueError('no early tuning observations')
    options = []
    for strength in STRENGTHS:
        loss = 0.
        for key,prior in priors.items():
            target = tuning.get(key,{})
            if not target:
                continue
            p = b.posterior(prior,training.get(key,{}),strength)
            loss -= sum(count*math.log(p[truth]) for truth,count in target.items())
        options.append(dict(strength=strength,nll=loss/n))
    selected = min(options,key=lambda row:(row['nll'],row['strength'] is not None))
    rows = {key:b.posterior(prior,training.get(key,{}),selected['strength']) for key,prior in priors.items()}
    return rows,dict(selected=selected,tuningObservations=n,options=options)


def fit_arm(training, tuning):
    holds,calibration = {},[]
    for role in b.ROLES:
        for size in range(4):
            opening = holds.get((role,h.ZERO))
            priors = {(role,prefix):neutral_hold(prefix,opening) for prefix in h.keys(size)}
            rows,audit = fit_group(priors,training['hold'],tuning['hold'])
            holds.update(rows)
            calibration.append(dict(kind='hold',role=role,prefixLength=size,**audit))
    priors = discard_backoffs(training['discards'])
    discards = {}
    for role in b.ROLES:
        rows,audit = fit_group({k:p for k,p in priors.items() if k[0]==role},training['discards'],tuning['discards'])
        discards.update(rows)
        calibration.append(dict(kind='discards',role=role,**audit))
    b.validate_rows(holds,'hold')
    b.validate_rows(discards,'discards')
    return holds,discards,calibration


def checked_corpus(root):
    manifest_bytes = (root/'manifest.json').read_bytes()
    pinned = b.ROOT/'docs/research/model284-late-beliefs-manifest.json'
    if manifest_bytes!=pinned.read_bytes():
        raise ValueError('corpus manifest differs from reviewed snapshot')
    manifest = json.loads(manifest_bytes)
    data = (root/'evidence.json.gz').read_bytes()
    if b.sha(data)!=manifest['evidenceSha256']:
        raise ValueError('corpus evidence identity differs')
    evidence = json.loads(gzip.decompress(data))
    if evidence['sources']!=manifest['sourceSnapshots']:
        raise ValueError('source identities differ')
    partitions = {}
    for game in evidence['games']:
        seed = game['seed']
        if game['partition']!=b.split(seed) or seed in partitions and partitions[seed]!=game['partition']:
            raise ValueError('seed group crosses partitions')
        if not all(b.eligible(engine) for engine in game['engines']):
            raise ValueError('excluded source actor')
        partitions[seed] = game['partition']
    counts = {s:{kind:{(row['role'],row['context']):Counter(row['counts']) for row in rows}
                 for kind,rows in value.items()} for s,value in evidence['counts'].items()}
    return manifest,evidence,counts


def early_test_cases(root, evidence, counts):
    cases = []
    observed = {kind:defaultdict(Counter) for kind in ('hold','discards')}
    for source in evidence['sources']:
        path = root/'sources'/source['snapshot']
        if h.file_digest(path)!=source['sha256']:
            raise ValueError('frozen source changed')
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
            db.row_factory = sqlite3.Row
            if b.run_provenance(db,source['engines'])!=source['runProvenance']:
                raise ValueError('source qualification changed')
            for game in evidence['games']:
                if game['source']!=source['snapshot'] or game['partition']!='test':
                    continue
                for hand in h.game_hands(db,game['gameId']):
                    dealt = [bytes(hand[name+'_dealt'] or b'') for name in ('left','right')]
                    kept = [bytes(hand[name+'_keep'] or b'') for name in ('left','right')]
                    physical = dealt[0]+dealt[1]+bytes([hand['cut_card']])
                    if len(physical)!=13 or len(set(physical))!=13 or max(physical)>=52:
                        raise ValueError('invalid held-out physical deal')
                    for side,engine in enumerate(game['engines']):
                        score = hand['start_left_score'] if side==0 else hand['start_right_score']
                        other_score = hand['start_right_score'] if side==0 else hand['start_left_score']
                        if b.late(score):
                            continue
                        observations = h.observations(hand,side)
                        role = observations[0][0]
                        keep = h.rank_key(kept[side])
                        discard = h.rank_key(set(dealt[side])-set(kept[side]))
                        observed['discards'][(role,keep)][discard]+=1
                        for _,prefix,remaining in observations:
                            observed['hold'][(role,prefix)][remaining]+=1
                        cases.append(dict(seed=game['seed'],model=engine,role=role,
                            actorStartScore=score,opponentStartScore=other_score,
                            ownSix=h.rank_key(dealt[1-side]),cutRank=hand['cut_card']//4,
                            keep=keep,discard=discard,
                            hold=[dict(prefix=p,remaining=r) for _,p,r in observations]))
    for kind in observed:
        if dict(observed[kind])!=counts['test']['ordinary-'+kind]:
            raise ValueError('reconstructed early test labels differ from frozen counts')
    return cases


def conditioned_batch(keys, context, cases, kind):
    ranks = np.array([list(map(int,key)) for key in keys],dtype=int)
    context = np.array(list(map(int,context)),dtype=int)
    own = np.array([list(map(int,case['ownSix'])) for case in cases],dtype=int)
    cut = np.array([case['cutRank'] for case in cases],dtype=int)
    available = 4-context-own
    if kind=='hold':
        available[np.arange(len(cases)),cut]-=1
    if np.any(available<0):
        raise ValueError('inconsistent known cards')
    result = np.ones((len(cases),len(keys)))
    for rank in range(13):
        result *= CHOOSE[available[:,rank,None],ranks[None,:,rank]]/CHOOSE[4-context[rank],ranks[None,:,rank]]
    if kind=='discards':
        result *= np.maximum(0,available[np.arange(len(cases)),cut,None]-ranks[:,cut].T)
    return result


def assess(cases, all_rows, early_rows, seed):
    groups = defaultdict(list)
    for case in cases:
        groups[('discards',case['role'],case['keep'])].append((case,case['discard']))
        for observation in case['hold']:
            groups[('hold',case['role'],observation['prefix'])].append((case,observation['remaining']))
    totals = defaultdict(lambda:np.zeros(5))
    clusters = defaultdict(lambda:defaultdict(lambda:np.zeros(3)))
    for (kind,role,context),observations in groups.items():
        q = all_rows[kind][(role,context)]
        p = early_rows[kind][(role,context)]
        keys = sorted(q)
        if set(p)!=set(keys):
            raise ValueError('arms differ in physical support')
        index = {key:i for i,key in enumerate(keys)}
        probabilities = [np.array([row[key] for key in keys]) for row in (q,p)]
        for offset in range(0,len(observations),128):
            chunk = observations[offset:offset+128]
            inputs = [case for case,_ in chunk]
            truths = np.array([index[truth] for _,truth in chunk])
            physical = conditioned_batch(keys,context,inputs,kind)
            for mode,weights in [('unconditioned',np.ones((len(chunk),len(keys)))),('conditioned',physical)]:
                scores = []
                for prior in probabilities:
                    w = weights*prior
                    mass = w.sum(axis=1)
                    if np.any(mass<=0) or not np.all(np.isfinite(mass)):
                        raise ValueError('invalid predictive mass')
                    distribution = w/mass[:,None]
                    actual = distribution[np.arange(len(chunk)),truths]
                    if np.any(actual<=0):
                        raise ValueError('observed outcome lost support')
                    scores.append((-np.log(actual),1-2*actual+np.einsum('ij,ij->i',distribution,distribution)))
                for i,(case,_) in enumerate(chunk):
                    labels = ['all',role,case['model'],role+'/prefix'+str(sum(map(int,context))) if kind=='hold' else role+'/given-keep']
                    if case['actorStartScore']>=101:
                        labels.extend(['101-110','101-110/'+role])
                    if case['opponentStartScore']<111:
                        labels.append('both-below111/'+role)
                    else:
                        labels.append('opponent111-120/'+role)
                    for label in labels:
                        key = (mode,kind,label)
                        a,c = scores[0][0][i],scores[1][0][i]
                        ba,bc = scores[0][1][i],scores[1][1][i]
                        totals[key] += [1,a,c,ba,bc]
                        clusters[key][case['seed']] += [1,c-a,bc-ba]
    rng = np.random.default_rng(seed)
    report = []
    for key,(n,a,c,ba,bc) in sorted(totals.items()):
        blocks = np.array(list(clusters[key].values()))
        draws = []
        for _ in range(20):
            samples = blocks[rng.integers(len(blocks),size=(100,len(blocks)))].sum(axis=1)
            draws.extend((samples[:,1:]/samples[:,0,None]).tolist())
        interval = np.quantile(draws,[.025,.975],axis=0)
        report.append(dict(conditioning=key[0],kind=key[1],group=key[2],observations=int(n),seedGroups=len(blocks),
            allScoreNll=a/n,earlyOnlyNll=c/n,nllDelta=(c-a)/n,nllDelta95=interval[:,0].tolist(),
            allScoreBrier=ba/n,earlyOnlyBrier=bc/n,brierDelta=(bc-ba)/n,brierDelta95=interval[:,1].tolist()))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--corpus',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    np.seterr(all='raise')
    args.output.mkdir(parents=True,exist_ok=True)
    builder_sha = h.file_digest(Path(__file__))
    manifest,evidence,counts = checked_corpus(args.corpus)
    identity = dict(parentManifestSha256=h.file_digest(args.corpus/'manifest.json'),
        builderSha256=builder_sha,dependencies={name:h.file_digest(b.ROOT/'scripts'/name) for name in
            ('build_model284_late_beliefs.py','build_model203_hold.py','learning_model_policy.py')},
        definition='subject score 0-110 at hand start; near boundary 101-110',
        fitting='physical opening prior; within-arm opening/role-marginal backoffs; identical early tuning targets',
        neutralDiscardFloor=.01,grid=STRENGTHS)
    identity_path = args.output/'experiment.json'
    if identity_path.exists():
        saved = json.loads(identity_path.read_bytes())
        if saved['protocol']!=json.loads(b.canonical(identity)):
            raise ValueError('use a new output for a changed experiment')
        seed = int(saved['bootstrapSeed'])
    else:
        seed = secrets.randbits(128)
        b.write_json(identity_path,dict(protocol=identity,bootstrapSeed=str(seed)))
    training = {arm:{kind:counts['train']['ordinary-'+kind] for kind in ('hold','discards')} for arm in ['earlyOnly']}
    training['allScores'] = b.pooled_counts(counts)['train']
    tuning = {kind:counts['tune']['ordinary-'+kind] for kind in ('hold','discards')}
    models,calibration,artifacts = {},{},{}
    for arm,data in training.items():
        holds,discards,audit = fit_arm(data,tuning)
        hold_bytes,error = h.pack(holds)
        (args.output/(arm+'-hold.bin')).write_bytes(hold_bytes)
        holds = b.read_hold(hold_bytes)
        discard_bytes = gzip.compress(b.canonical([dict(role=r,keep=k,probabilities=row) for (r,k),row in sorted(discards.items())]),mtime=0)
        (args.output/(arm+'-discards.json.gz')).write_bytes(discard_bytes)
        models[arm] = dict(hold=holds,discards=discards)
        calibration[arm] = dict(groups=audit,holdQuantizationError=error,
            support={kind:b.validate_rows(rows,kind) for kind,rows in models[arm].items()})
        artifacts[arm] = dict(holdSha256=b.sha(hold_bytes),discardSha256=b.sha(discard_bytes))
    cases = early_test_cases(args.corpus,evidence,counts)
    (args.output/'early-test-cases.json.gz').write_bytes(gzip.compress(b.canonical(cases),mtime=0))
    result = assess(cases,models['allScores'],models['earlyOnly'],seed)
    report = dict(schemaVersion=1,protocol=identity,bootstrapSeed=str(seed),
        environment=dict(python=platform.python_version(),numpy=np.__version__),
        trainingDecisions={arm:{role:sum(sum(row.values()) for (r,_),row in data['discards'].items() if r==role)
                               for role in b.ROLES} for arm,data in training.items()},
        testDecisions=dict(Counter(case['role'] for case in cases)),
        nearBoundaryDecisions=dict(Counter(case['role'] for case in cases if case['actorStartScore']>=101)),
        calibration=calibration,artifacts=artifacts,assessment=result,
        wholeGamesRun=0,productionActivated=False,
        limitations=['Matched new-data ablation, not a literal purge of every historical production observation.',
                     'Hold and rank-discard components only; no suit/decline priors are borrowed or evaluated.',
                     'Prediction differences are not win-rate differences. All intervals are per-comparison exploratory intervals.'])
    if builder_sha!=h.file_digest(Path(__file__)):
        raise ValueError('builder changed during execution')
    b.write_json(args.output/'assessment.json',report)
    print(json.dumps({k:report[k] for k in ['trainingDecisions','testDecisions','nearBoundaryDecisions']}))
    print(json.dumps([row for row in result if row['conditioning']=='conditioned' and row['group'] in
                     ('dealer','pone','101-110/dealer','101-110/pone')]))


if __name__=='__main__':
    main()
