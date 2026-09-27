#!/usr/bin/env python3
"""Pack dense BWM2; retain unsupported-cell provenance instead of inventing data."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
N=121
SEAMS=['discard','after_discard','after_pegging','after_pone']

def pack(database,output,report):
    values=[];fallbacks=[]
    with sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True) as db:
        for seam in SEAMS:
            rows=db.execute("SELECT dealer_score,pone_score,wins,observations,win_probability FROM matrix_cells WHERE cohort='pooled' AND seam=? ORDER BY dealer_score,pone_score",(seam,)).fetchall()
            if len(rows)!=N*N:raise ValueError('matrix shape mismatch')
            supported={(d,p):(w,n,prob) for d,p,w,n,prob in rows if n>0}
            if not supported:raise ValueError('unsupported entire phase')
            for i,(d,p,w,n,prob) in enumerate(rows):
                assert (d,p)==divmod(i,N)
                if not n:
                    assert w==0 and prob is None
                    distance=min(abs(x-d)+abs(y-p) for x,y in supported)
                    neighbors=[(x,y,*v[:2]) for (x,y),v in supported.items() if abs(x-d)+abs(y-p)==distance]
                    prob=sum(v[2] for v in neighbors)/sum(v[3] for v in neighbors)
                    fallbacks.append(dict(seam=seam,dealerScore=d,poneScore=p,observations=0,probability=prob,rule='nearest supported Manhattan ring, weighted by observation count',neighbors=[dict(dealerScore=x,poneScore=y,wins=w,observations=n) for x,y,w,n in neighbors]))
                else:
                    assert 0<=w<=n and prob==w/n
                assert 0<=prob<=1
                values.append(prob)
    data=b'BWM2'+struct.pack('<III',2,N,4)+struct.pack('<'+str(len(values))+'d',*values)
    output.write_bytes(data)
    result=dict(status='complete',bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),observedCells=len(values)-len(fallbacks),unsupportedCells=fallbacks,missingEvidenceIsNotZero=True)
    report.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['status','bytes','sha256','observedCells']}|{'unsupportedCells':len(fallbacks)}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('database',type=Path);p.add_argument('output',type=Path);p.add_argument('report',type=Path);a=p.parse_args();pack(a.database,a.output,a.report)
