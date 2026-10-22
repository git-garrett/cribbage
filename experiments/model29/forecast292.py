"""Joint pegging points, before WP valuation; exact cards, learned board regions.

Censored hands contribute only lower-bound likelihoods, never a fictitious
completed total. The likelihood approximation discards scoring-event order.
"""
import collections
import hashlib
import json
import lzma
import math
from pathlib import Path
from forecast import key
from formats import canonical, replace

FILE = 'model292-pegging.json.xz'
PRIOR = 32.
MIN_LEAF = 128
MAX_LEAVES = 8


def empty():
    return dict(schema_version=1,prior_mass=PRIOR,regions=[{},{}],contexts={},rows={},region_history=[],stats={})


def read(path):
    return json.loads(lzma.decompress(Path(path).read_bytes()))


def write(path, data):
    replace(Path(path),lzma.compress(canonical(data),preset=1))


def region(tree, scores):
    while 'axis' in tree:
        tree=tree['left'] if scores[tree['axis']]<=tree['cut'] else tree['right']
    return tree.get('id',0)


def identify(tree, start=0):
    if 'axis' not in tree:
        tree['id']=start
        return start+1
    return identify(tree['right'],identify(tree['left'],start))


def add(data, cohort, outcome, worlds):
    record=outcome.get('scoring')
    identity=key(cohort['own'],outcome['discard'],[0,0],cohort['dealer']==0)
    if cohort['model']!='29.2' or not cohort.get('sourceRoot') or not isinstance(record,dict) or record.get('context')!=identity:
        raise ValueError('missing attributable 29.2 scoring forecast')
    prior=record['prior']
    if not prior or any(len(b)!=3 or any(not math.isfinite(v) for v in b) or b[0]<0 or b[1]<0 or b[2]<=0 for b in prior) or abs(sum(b[2] for b in prior)-1)>1e-9:
        raise ValueError('invalid legacy joint prior')
    start=outcome['postCutStart'];end=outcome['pegEnd']
    if len(start)!=2 or len(end)!=2 or any(type(v)is not int or not 0<=v<=121 for v in start+end) or any(b<a for a,b in zip(start,end)):
        raise ValueError('invalid pegging observation')
    if max(start)>=121:
        data['stats']['heelsOnly']=data['stats'].get('heelsOnly',0)+1
        return
    complete=outcome.get('pegComplete')
    if type(complete)is not bool or (complete and max(end)>=121) or (not complete and max(end)<121):
        raise ValueError('invalid complete/censored pegging marker')
    points=[b-a for a,b in zip(start,end)]
    row=data['contexts'].setdefault(identity,dict(prior=prior,role=cohort['dealer'],cells={}))
    if row['prior']!=prior or row['role']!=cohort['dealer']:
        raise ValueError('exact-context prior changed')
    # Actual source board retained, so boundary changes can reaggregate all
    # evidence, without pretending old observations originated on another board.
    cell=','.join(map(str,[*cohort['start'],int(complete),*points]))
    row['cells'][cell]=row['cells'].get(cell,0)+1
    world=(cohort['sourceGame'],cohort['hand'],cohort['actor'])
    item=worlds.setdefault(world,dict(scores=cohort['start'],role=cohort['dealer'],values=[],complete=True))
    item['complete'] &= complete
    means=[sum(b[i]*b[2] for b in prior) for i in (0,1)]
    item['values'].append([points[i]-means[i] for i in (0,1)])


def posterior(prior, observations, mass=PRIOR):
    """Six deterministic EM steps for an interval-censored multinomial.

    Both recorded point totals are lower bounds if pegging stopped at 121.
    Prior support and completed modern observations supply possible full totals.
    Unsupported partial observations are retained but cannot invent new totals.
    """
    base={(a,b):mass*p for a,b,p in prior}
    censored=[];full=0
    for complete,a,b,n in observations:
        if complete:
            base[a,b]=base.get((a,b),0.)+n;full+=n
        else:censored.append((a,b,n))
    p=dict(base);unsupported=0
    compatible=[]
    for a,b,n in censored:
        support=[v for v in base if v[0]>=a and v[1]>=b]
        if support:compatible.append((support,n))
        else:unsupported+=n
    for _ in range(6):
        result=dict(base)
        for support,n in compatible:
            total=sum(p[v] for v in support)
            for v in support:result[v]+=n*p[v]/total
        p=result
    total=sum(p.values())
    return [[a,b,w/total] for (a,b),w in sorted(p.items())],full,sum(n for _,n in compatible),unsupported


def mean(rows):
    return [sum(r[1][i] for r in rows)/len(rows) for i in (0,1)]


def loss(rows, center):
    return sum(sum((y[i]-center[i])**2 for i in (0,1)) for _,y in rows)


def fit(rows, leaves=MAX_LEAVES):
    center=mean(rows) if rows else [0.,0.]
    node={'mean':center}
    if leaves<2 or len(rows)<2*MIN_LEAF:return node
    best=None;before=loss(rows,center)
    for axis in (0,1):
        for cut in range(9,120,10):
            left=[r for r in rows if r[0][axis]<=cut];right=[r for r in rows if r[0][axis]>cut]
            if min(len(left),len(right))<MIN_LEAF:continue
            score=loss(left,mean(left))+loss(right,mean(right))
            if best is None or score<best[0]:best=(score,axis,cut,left,right)
    if best is None or best[0]>=before*.98:return node
    _,axis,cut,left,right=best
    return dict(mean=center,axis=axis,cut=cut,left=fit(left,leaves//2),right=fit(right,leaves-leaves//2))


def prediction(tree,scores):
    while 'axis' in tree:tree=tree['left'] if scores[tree['axis']]<=tree['cut'] else tree['right']
    return tree.get('mean',[0.,0.])


def refit(tree,rows):
    out={'mean':mean(rows) if rows else tree.get('mean',[0.,0.])}
    if 'axis' in tree:
        a,c=tree['axis'],tree['cut']
        out.update(axis=a,cut=c,left=refit(tree['left'],[r for r in rows if r[0][a]<=c]),right=refit(tree['right'],[r for r in rows if r[0][a]>c]))
    return out


def finish(data,worlds):
    # One role/hand/world contributes one boundary-training target, regardless
    # of whether 1 or 15 discards were tried. Entire source games are held out.
    history=data['region_history'];fresh=[[],[]];held=[[],[]]
    for world,item in worlds.items():
        if not item['complete']:continue
        y=[sum(v[i] for v in item['values'])/len(item['values']) for i in (0,1)]
        record=[item['scores'],y]
        fold=int.from_bytes(hashlib.sha256(world[0].encode()).digest()[:4],'little')%5
        (held if fold==0 else fresh)[item['role']].append(record)
    accepted=0
    for role in (0,1):
        train=[r for k,r in history if k==role]+fresh[role]
        candidate=fit(train);old=refit(data['regions'][role],train)
        checks=held[role]
        def error(tree):return sum(sum((y[i]-prediction(tree,x)[i])**2 for i in (0,1)) for x,y in checks)
        if len(checks)>=64 and error(candidate)<.98*error(old):
            data['regions'][role]=candidate;accepted+=1
        identify(data['regions'][role])
        history.extend([role,r] for r in fresh[role]+held[role])
    rows={};full=censored=unsupported=0
    for identity,context in data['contexts'].items():
        groups=collections.defaultdict(collections.Counter)
        for cell,n in context['cells'].items():
            a,b,complete,mine,other=map(int,cell.split(','))
            groups[region(data['regions'][context['role']],[a,b])][complete,mine,other]+=n
        for label,counts in groups.items():
            bins,n,c,u=posterior(context['prior'],[(*v,count) for v,count in counts.items()],data['prior_mass'])
            rows[f'{identity}|{label}']=bins
            full+=n;censored+=c;unsupported+=u
    data['rows']=rows
    data['stats'].update(completeSamples=full,censoredSamples=censored,unsupportedCensoredSamples=unsupported,
        exactContexts=len(data['contexts']),regionRows=len(rows),regions=[identify(t) for t in data['regions']],
        acceptedBoundaryUpdates=data['stats'].get('acceptedBoundaryUpdates',0)+accepted)
    return data['stats']
