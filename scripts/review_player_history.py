#!/usr/bin/env python3
"""Prepare and run resumable, model-labelled reviews of one player's archive."""
from __future__ import annotations
import argparse, collections, concurrent.futures, datetime, hashlib, json, math, os
from pathlib import Path
import sqlite3, subprocess, threading, time
from history_review_inputs import REVIEW_MODELS, actual_opponent, compact_review, input_text, legacy_reviews, native_review

LATEST = 'schell_table-peg_table-28.3.fast'

def iso(value):
    if isinstance(value, (int,float)) or (isinstance(value,str) and value.rstrip('Z').isdigit()):
        number=float(str(value).rstrip('Z'))
        if number>1e11:number/=1000
        return datetime.datetime.fromtimestamp(number,datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    return value

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def encode(value):return json.dumps(value,separators=(',',':'),sort_keys=True)

def connection(path):
    c=sqlite3.connect(path);c.row_factory=sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')
    c.executescript('''CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS games(game_id TEXT PRIMARY KEY,metadata_json TEXT NOT NULL,events_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,hand INTEGER NOT NULL,original_model TEXT,record_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,request_json TEXT NOT NULL,result_json TEXT,seconds REAL,PRIMARY KEY(id,model));''')
    return c

def cached_review(record,model):
    for a in record.get('analyses',[]):
        if a['evaluator_model']==model:
            a={'model':model,'selectedCardIds':a['selected_card_ids'],'recommendedCardIds':a['recommended_card_ids'],
               'selectedEv':a['selected_ev'],'recommendedEv':a['recommended_ev'],
               'selectedWinProbability':a.get('selected_win_probability'),'recommendedWinProbability':a.get('recommended_win_probability')}
            break
    else:
        a=record.get('eventReview') or {}
    if a.get('model')!=model or any(a.get(k) is None for k in ['selectedWinProbability','recommendedWinProbability']):return None
    from history_review_inputs import cards
    selected=a.get('selectedCardIds') or cards(a['selected'])
    recommended=a.get('recommendedCardIds') or cards(a['recommended'])
    if sorted(selected)!=sorted(record['selected']):raise ValueError('cached review selection mismatch')
    return {'ok':True,'id':record['id'],'model':model,'review':{
        'selected':{'cardIds':selected,'ev':a.get('selectedEv'),'winProbability':a['selectedWinProbability']},
        'recommended':{'cardIds':recommended,'ev':a.get('recommendedEv'),'winProbability':a['recommendedWinProbability']}}}

def merged_payloads(source):
    payloads={}
    for r in source['legacyUploads']:
        payloads[r['game_id']]={'gameId':r['game_id'],'model':r['model'],'events':json.loads(r['events_json']),'finalResult':json.loads(r['final_result_json'] or 'null')}
    for r in source['uploads']:
        p=json.loads(r['payload_json']);old=payloads.get(r['game_id'],{})
        merged={e['id']:e for e in old.get('events',[])}
        for e in p.get('events',[]):merged[e['id']]={**merged.get(e['id'],{}),**e}
        p['events']=list(merged.values());payloads[r['game_id']]=p
    return payloads

def prepare(args):
    if args.database.exists():raise ValueError('refusing to replace an existing review database')
    source=json.loads(args.source.read_text());sessions={r['session_id']:json.loads(r['session_json']) for r in source['sessions']}
    payloads=merged_payloads(source)
    c=connection(args.database)
    c.execute('INSERT INTO metadata VALUES (?,?)',('source',encode({'path':str(args.source),'sha256':digest(args.source),'capturedAt':source['capturedAt'],'deployment':source['deployment'],'latestModel':LATEST})))
    unavailable=collections.Counter();total=0
    for gid,p in payloads.items():
        events=p.get('events',[]);session=sessions.get(gid);original=session['model'] if session else actual_opponent(events,p.get('model'))
        final=p.get('finalResult') or next((e for e in reversed(events) if e.get('type')=='game' and e.get('action')=='end'),{})
        ended=iso((session or {}).get('completed_at') or final.get('at'))
        if not ended:raise ValueError('game lacks an attributable completion time: '+gid)
        excluded=[];records=[]
        if session:
            for r in session['decision_reviews']:
                try:records.append(native_review(r))
                except (ValueError,KeyError,TypeError) as e:excluded.append({'id':r['id'],'hand':r['game']['hand_number'],'reason':str(e)})
            hands=session['game']['hand_number']
            completed={e['hand_number'] for e in session['score_events'] if e['category']=='Crib'}
            assisted={e['hand_number'] for e in session.get('help_events',[])}
        elif gid.startswith(('rust-','human-game-')):
            ds={e['handNumber']:e for e in events if e.get('type')=='discard' and e.get('player')=='human'}
            for e in events:
                if e.get('player')!='human':continue
                try:
                    if e.get('type')=='discard':
                        part,missing=legacy_reviews([e]);records.extend(part);excluded.extend(missing)
                    elif e.get('type')=='pegging' and e.get('action')=='play':records.append(compact_review(e,ds[e['handNumber']]))
                except (ValueError,KeyError,TypeError) as error:excluded.append({'id':e['id'],'hand':e.get('handNumber'),'reason':str(error)})
            hands=max(ds,default=0);completed=set(range(1,hands));assisted=set()
            completed.update(e['handNumber'] for e in events if e.get('type')=='score' and e.get('category')=='crib')
        else:
            records,excluded=legacy_reviews(events)
            hands=max((r['hand'] for r in records),default=0);completed=set(range(1,hands));assisted=set()
            # Only explicitly ended hands count at the final deal; older clients
            # with drifting counters otherwise use the verified deal sequence.
            if any(e.get('type')=='hand' and e.get('action')=='end' and e.get('handNumber')==hands for e in events):completed.add(hands)
        metadata={'opponent':original,'endedAt':ended,'hands':hands,'completedHands':sorted(completed),
                  'assistedHands':sorted(assisted),'unavailable':excluded,'decisionCount':len(records),
                  'forfeited':bool((session or {}).get('forfeited')),'finalScores':final.get('finalScores')}
        c.execute('INSERT INTO games VALUES (?,?,?)',(gid,encode(metadata),encode(events)))
        for missing in excluded:unavailable[missing['reason']]+=1
        for r in records:
            r['at']=iso(r['at']);r['gameId']=gid
            c.execute('INSERT INTO decisions VALUES (?,?,?,?,?)',(r['id'],gid,r['hand'],original,encode(r)))
            for model in sorted({LATEST}|({original} if original in REVIEW_MODELS else set())):
                request={'id':r['id'],'model':model,'inputText':input_text(r['fields'],model),'selectedCardIds':r['selected']}
                result=cached_review(r,model)
                status='complete' if result else 'pending'
                if r['forced']:
                    result={'ok':True,'id':r['id'],'model':model,'forced':True,'loss':0.0};status='complete'
                c.execute('INSERT INTO reviews VALUES (?,?,?,?,?,?)',(r['id'],model,status,encode(request),encode(result) if result else None,0 if result else None))
            total+=1
    c.commit()
    counts=dict(c.execute('SELECT status,count(*) FROM reviews GROUP BY status'))
    print(encode({'games':len(payloads),'decisions':total,'reviews':counts,'unavailable':dict(unavailable)}))

def run(args):
    c=connection(args.database)
    provenance={'binarySha256':digest(args.worker),'modelRoot':str(args.model_root),'buildReceiptSha256':digest(args.build_receipt)}
    saved=c.execute("SELECT value FROM metadata WHERE key='worker'").fetchone()
    if saved and json.loads(saved[0])!=provenance:raise ValueError('worker provenance changed; refusing to mix results')
    c.execute('INSERT OR IGNORE INTO metadata VALUES (?,?)',('worker',encode(provenance)));c.commit()
    rows=list(c.execute("SELECT id,model,request_json FROM reviews WHERE status='pending' ORDER BY rowid"))
    if c.execute("SELECT count(*) FROM reviews WHERE status='failed'").fetchone()[0]:raise ValueError('failed reviews require inspection before explicit retry')
    local=threading.local();processes=[];lock=threading.Lock()
    def evaluate(row):
        if not hasattr(local,'process'):
            local.process=subprocess.Popen([str(args.worker)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,
                 env=dict(os.environ,CRIBBAGE_RUST_MODEL_ROOT=str(args.model_root)),bufsize=1)
            with lock:processes.append(local.process)
        p=local.process;start=time.monotonic();p.stdin.write(row['request_json']+'\n');p.stdin.flush();line=p.stdout.readline()
        if not line:raise RuntimeError('review worker exited without a result')
        result=json.loads(line)
        if result.get('id')!=row['id'] or result.get('model')!=row['model']:raise RuntimeError('worker returned a different review identity')
        return result,time.monotonic()-start
    count=0
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            pending={}
            iterator=iter(rows)
            for row in list(next(iterator,None) for _ in range(args.workers)):
                if row is not None:pending[pool.submit(evaluate,row)]=row
            while pending:
                done,_=concurrent.futures.wait(pending,return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    row=pending.pop(future)
                    try:result,seconds=future.result()
                    except Exception as error:result={'ok':False,'error':str(error)};seconds=0
                    status='complete' if result.get('ok') else 'failed'
                    c.execute('UPDATE reviews SET status=?,result_json=?,seconds=? WHERE id=? AND model=?',(status,encode(result),seconds,row['id'],row['model']));c.commit();count+=1
                    if status=='failed':print(f"Review unavailable: {row['id']} / {row['model']}: {result.get('error')}",flush=True)
                    if count%100==0:print(f'Reviewed {count}/{len(rows)} pending decisions.',flush=True)
                    next_row=next(iterator,None)
                    if next_row is not None:pending[pool.submit(evaluate,next_row)]=next_row
    finally:
        for p in processes:
            if p.poll() is None:p.terminate()
        for p in processes:p.wait()
    left=c.execute("SELECT count(*) FROM reviews WHERE status!='complete'").fetchone()[0]
    if left:raise RuntimeError(f'{left} reviews are incomplete')
    report={'status':'complete','games':c.execute('SELECT count(*) FROM games').fetchone()[0],'decisions':c.execute('SELECT count(*) FROM decisions').fetchone()[0],'reviews':c.execute('SELECT count(*) FROM reviews').fetchone()[0],**provenance}
    args.receipt.write_text(encode(report)+'\n');print(encode(report))

def main():
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    prep=sub.add_parser('prepare');prep.add_argument('--source',type=Path,required=True);prep.add_argument('--database',type=Path,required=True)
    run_parser=sub.add_parser('run')
    for field in ['database','worker','model-root','build-receipt','receipt']:run_parser.add_argument('--'+field,type=Path,required=True)
    run_parser.add_argument('--workers',type=int,default=4)
    args=parser.parse_args();(prepare if args.command=='prepare' else run)(args)

if __name__=='__main__':main()
