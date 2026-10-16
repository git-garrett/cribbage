"""FP64 updates to existing 28.3 binary formats; exact score cubes stay fixed."""
import hashlib,itertools,json,struct
from collections import Counter
from pathlib import Path
ROLES=('dealer','pone')
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def blend(p,mass,successes,n):return (p*mass+successes)/(mass+n)
def replace(path,data):
    path=Path(path);tmp=path.with_suffix(path.suffix+'.new');tmp.write_bytes(data);tmp.replace(path)
def key(cards):
    c=[0]*13
    for card in cards:c[card%13]+=1
    return ''.join(map(str,c))
def rank_keys(n):
    return sorted({key(r) for r in itertools.combinations_with_replacement(range(13),n) if max(Counter(r).values(),default=0)<=4})
PAIRS=rank_keys(2);KEEPS=rank_keys(4);DI={p:i for i,p in enumerate(PAIRS)};KI={k:i for i,k in enumerate(KEEPS)}

def update_hold(source,dest,counts,strength,state):
    data=bytearray(source.read_bytes());version,rows,entries,ds,rs=struct.unpack_from('<5I',data,8)
    if data[:8]!=b'M203HB01' or (version,ds,rs)!=(1,22,21):raise ValueError('unsupported hold asset')
    offset=28+rows*22;changed=0
    for i in range(rows):
        role,*rest=struct.unpack_from('<B13BII',data,28+i*22);prefix=''.join(map(str,rest[:13]));first,n=rest[13:]
        own={hand:c for (r,p,hand),c in counts.items() if (r,p)==(role,prefix)}
        if not own:continue
        row=[]
        for j in range(n):
            p=offset+(first+j)*21;*rank,w=struct.unpack_from('<13BQ',data,p);row.append((p,''.join(map(str,rank)),w))
        total=sum(w for _,_,w in row);raw=sum(own.values());identity=f'{role}:{prefix}';prior_n=float(strength)+float(state.get(identity,0))
        for p,h,w in row:
            weight=max(1,round(float(float(blend(float(w)/float(total),prior_n,own.get(h,0),raw)*float(10**15)))));struct.pack_into('<Q',data,p+13,weight)
        if set(own)-{h for _,h,_ in row}:raise ValueError('hold evidence outside complete support')
        state[identity]=state.get(identity,0)+raw;changed+=1
    replace(dest,data);return changed


def update_crib(source,dest,counts,strength,state):
    data=source.read_bytes();magic,version,roles,pairs,ranks,ml,size=struct.unpack_from('<8s6I',data)
    meta=json.loads(data[64:64+ml]);offset=64+ml;payload=bytearray();new_totals={}
    for role in range(2):
        rows=[list(struct.unpack_from('<Qd',data,offset+16*(role*91+d))) for d in range(91)]
        additions=Counter()
        for (r,k,d),n in counts.items():
            if r==role:additions[d]+=n
        new_n=sum(additions.values());prior_n=float(strength)+float(state.get(str(role),0))
        for d,(n,p) in enumerate(rows):payload+=struct.pack('<Qd',n+additions[d],blend(p,prior_n,additions[d],new_n))
        state[str(role)]=state.get(str(role),0)+new_n;new_totals[ROLES[role]]=sum(n for n,p in rows)+new_n
    meta['observationsByRole']=new_totals;meta['model29Update']=dict(priorEffectiveSamples=strength,naturalDecisions=sum(counts.values()))
    encoded=canonical(meta);payload=encoded+payload+data[offset+2*91*16:]
    replace(dest,struct.pack('<8s6I32s',magic,version,roles,pairs,ranks,len(encoded),len(payload),hashlib.sha256(payload).digest())+payload)

def update_declines(source,dest,hands,strength,state,repo,policy):
    # The extraction is the repository's audited actual-hand routine. Training
    # admits only this frozen native 28.3 executable, never arbitrary model labels.
    import sys
    sys.path.insert(0,str(Path(repo)/'scripts'))
    from build_model203_decline_factors import hand_events,CATEGORIES,FIRST_CARD_CATEGORIES
    asset=json.loads(source.read_text());counts=[[0,0,0] for _ in range(21)]
    packed=lambda c:(c%13)*4+c//13
    for h in hands:
        hand=dict(cut_card=packed(h['cut']),left_dealt=bytes(map(packed,h['dealt'][0])),right_dealt=bytes(map(packed,h['dealt'][1])),
            left_keep=bytes(map(packed,h['keeps'][0])),right_keep=bytes(map(packed,h['keeps'][1])),plays=[(p['action'],p['actor'],packed(p['card']) if p['card'] is not None else None,p['before'],p['after'],'29.0') for p in h['plays']])
        for actor,engine,index,outcome in hand_events(hand):counts[index][outcome]+=1
    for i,category in enumerate(CATEGORIES):
        first=int(category not in FIRST_CARD_CATEGORIES)
        for ordinal in range(first,3):
            k=str(i*3+ordinal);old=state.get(k,[0,0,0]);added=counts[i*3+ordinal]
            previous=float(asset['factors'][category][ordinal-first])/float(1e6)
            mass=float(strength)+float(old[0]+old[1]);n=added[0]+added[1]
            if n:asset['factors'][category][ordinal-first]=max(1,min(999999,round(float(float(blend(previous,mass,added[1],n)*float(1e6))))))
            state[k]=[a+b for a,b in zip(old,added)]
    asset['model29PolicyAudit']=policy;asset['model29RawObservations']=counts;replace(dest,canonical(asset)+b'\n')
    return sum(sum(c) for c in counts)

