"""Small ridge regressions, isolated by exact cards, discard, role and tempo.

The target is a modern hand's next-state WP minus its inherited forecast at the
ACTUAL source board. Endpoints are never transplanted onto another score pair.
Raw joint outcomes remain in evidence.db for audit and future representation work.
"""
import math
import struct
from pathlib import Path

FILE = 'model291-forecast.json'
PRIOR = 32.0


def empty():
    return dict(schema_version=1,prior_mass=PRIOR,rows={})


def solve(gram, rhs, prior):
    # Four-dimensional ridge system, positive definite even with one sample.
    a=[[gram[4*i+j]+(prior if i==j else 0.) for j in range(4)]+[rhs[i]] for i in range(4)]
    for i in range(4):
        pivot=a[i][i]
        if not math.isfinite(pivot) or pivot<=0:
            raise ValueError('invalid forecast regression')
        a[i]=[v/pivot for v in a[i]]
        for j in range(4):
            if j!=i:
                factor=a[j][i]
                a[j]=[v-factor*w for v,w in zip(a[j],a[i])]
    return [a[i][4] for i in range(4)]


def next_wp(root, scores, dealer, boards):
    mine,other=scores
    if mine>=121:return 1.
    if other>=121:return 0.
    if root not in boards:
        data=(Path(root)/'rust/cribbage-shadow-engine/assets/model202-board-win-matrix.bin').read_bytes()
        if len(data)!=16+4*121*121*8 or data[:4]!=b'BWM2':
            raise ValueError('invalid source board matrix')
        boards[root]=data
    # The next hand swaps dealer; matrix entries are dealer-win probabilities.
    d,p=(other,mine) if dealer==0 else (mine,other)
    wp=struct.unpack_from('<d',boards[root],16+8*(d*121+p))[0]
    return 1.-wp if dealer==0 else wp


def add(data, cohort, outcome, boards):
    record=outcome.get('forecast')
    if not isinstance(record,dict) or cohort['model']!='29.1' or not cohort.get('sourceRoot'):
        raise ValueError('missing attributable 29.1 forecast input')
    from forecast import key
    expected=key(cohort['own'],outcome['discard'],[0,0],cohort['dealer']==0)
    x=record['features'];styles=record['styles'];base=record['baseline']
    expected_x=[1.,(cohort['start'][0]-60.)/60.,(cohort['start'][1]-60.)/60.,2.*base-1.]
    if record['context']!=expected or len(x)!=4 or any(abs(a-b)>1e-12 for a,b in zip(x,expected_x)) or len(styles)!=3 or not 0<=base<=1 or any(not math.isfinite(v) for v in [base,*x,*styles]) or any(v<0 or v>1 for v in styles) or abs(sum(styles)-1)>1e-12:
        raise ValueError('invalid 29.1 forecast input')
    target=next_wp(cohort['sourceRoot'],outcome['scores'],cohort['dealer'],boards)
    row=data['rows'].setdefault(expected,dict(n=[0.,0.,0.],gram=[[0.]*16 for _ in range(3)],
        rhs=[[0.]*4 for _ in range(3)],coefficients=[[0.]*4 for _ in range(3)]))
    for style,weight in enumerate(styles):
        if not weight:continue
        row['n'][style]+=weight
        for i in range(4):
            row['rhs'][style][i]+=weight*x[i]*(target-base)
            for j in range(4):row['gram'][style][i*4+j]+=weight*x[i]*x[j]
    return expected


def finish(data, changed):
    for identity in changed:
        row=data['rows'][identity]
        row['coefficients']=[solve(g,r,data['prior_mass']) for g,r in zip(row['gram'],row['rhs'])]
