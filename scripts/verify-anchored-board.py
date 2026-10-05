#!/usr/bin/env python3
"""Check retained event prefixes, exact replay counts, and export completeness."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import subprocess

N=121
SEAMS=['discard','after_discard','after_pegging','after_pone']

def connect(p): return sqlite3.connect(p.resolve().as_uri()+'?mode=ro',uri=True)

def oracle(game):
    n=collections.Counter();w=collections.Counter();events=game['events'];markers=game['markers']
    for anchor in [0]:
        for left in range(N):
            for right in range(N):
                scores=[left,right];visited=[];marker=anchor;winner=None
                for event in range(markers[anchor][0],len(events)):
                    while marker<len(markers) and markers[marker][0]==event:
                        _,phase,dealer=markers[marker];visited.append((phase,scores[dealer],scores[1-dealer],dealer));marker+=1
                    actor,points=events[event];scores[actor]+=points
                    if scores[actor]>=N: winner=actor;break
                if winner is None: raise ValueError('unresolved oracle start')
                for phase,d,p,dealer in visited:
                    n[phase,d,p]+=1;w[phase,d,p]+=winner==dealer
    return n,w

def verify_oracle(root):
    selected=[];cohorts=set()
    for line in (root/'trajectories.jsonl').open():
        game=json.loads(line)
        if game['cohort'] not in cohorts: selected.append(game);cohorts.add(game['cohort'])
        if len(selected)==2:break
    pilot=root/'oracle';pilot.mkdir(exist_ok=True)
    inp=pilot/'trajectories.jsonl';inp.write_text(''.join(json.dumps(g)+'\n' for g in selected))
    dbpath=pilot/'matrix.sqlite'
    subprocess.run([str(root/'bin/build_anchored_board'),str(inp),str(dbpath),str(pilot/'report.json')],check=True)
    n=collections.Counter();w=collections.Counter()
    for game in selected:
        a,b=oracle(game);n.update(a);w.update(b)
    with connect(dbpath) as db:
        rows=db.execute("SELECT seam,dealer_score,pone_score,observations,wins FROM matrix_cells WHERE cohort='pooled'").fetchall()
        assert len(rows)==4*N*N
        for phase,d,p,count,wins in rows:
            key=(SEAMS.index(phase),d,p)
            if (count,wins)!=(n[key],w[key]):raise ValueError(f'oracle mismatch {key}')
    return dict(status='complete',games=len(selected),replays=len(selected)*N*N,cellsCompared=4*N*N,phaseVisits=sum(n.values()),allCountsMatchDirectReplay=True)

def verify_matrix(root):
    export=json.loads((root/'trajectories.provenance.json').read_text())
    assert export['games']==40000 and export['clusters']==10000
    assert export['unresolvedFirstPhaseStarts']['discard']==0
    report=json.loads((root/'board-report.json').read_text())
    cells=4*N*N
    with connect(root/'board.sqlite') as db:
        assert db.execute('PRAGMA quick_check').fetchone()[0]=='ok'
        for cohort,phases in report['cohorts'].items():
            for seam,stats in phases.items():
                if seam=='discard': assert stats['minimumObservations']>=stats['sourceGames']
                rows=db.execute('SELECT wins,observations,contributing_clusters,win_probability FROM matrix_cells WHERE cohort=? AND seam=?',(cohort,seam)).fetchall()
                assert len(rows)==N*N
                assert all((0<=w<=n and 1<=k<=stats['seedClusters'] and p==w/n) if n else (w==k==0 and p is None) for w,n,k,p in rows)
        values=[p for seam in SEAMS for (p,) in db.execute("SELECT win_probability FROM matrix_cells WHERE cohort='pooled' AND seam=? ORDER BY dealer_score,pone_score",(seam,))]
    data=(root/'model202-board-win-matrix.bin').read_bytes()
    assert data[:16]==b'BWM2'+struct.pack('<III',2,N,4)
    packed=json.loads((root/'packed-report.json').read_text())
    decoded=list(struct.unpack('<'+str(cells)+'d',data[16:]))
    fallbacks={(SEAMS.index(f['seam']),f['dealerScore'],f['poneScore']):f for f in packed['unsupportedCells']}
    for i,(actual,expected) in enumerate(zip(decoded,values)):
        phase,idx=divmod(i,N*N);d,p=divmod(idx,N)
        if expected is None:
            f=fallbacks[phase,d,p]
            assert f['observations']==0
            assert actual==sum(x['wins'] for x in f['neighbors'])/sum(x['observations'] for x in f['neighbors'])
        else: assert actual==expected
    assert len(fallbacks)==sum(v is None for v in values)
    return dict(status='complete',sourceGames=40000,seedClusters=10000,phaseScoreCells=cells,minimumObservationsPerCell=min(s['minimumObservations'] for s in report['cohorts']['pooled'].values()),assetSha256=hashlib.sha256(data).hexdigest(),unresolvedStarts=0,fallbackCells=len(fallbacks))

def main():
    p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('mode',choices=['oracle','matrix']);args=p.parse_args()
    result={'oracle':verify_oracle,'matrix':verify_matrix}[args.mode](args.root)
    (args.root/(args.mode+'-verification.json')).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__': main()
