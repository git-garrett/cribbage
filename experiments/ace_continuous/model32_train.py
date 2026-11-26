from pathlib import Path
import ctypes as ct,fcntl,json,os,signal,sqlite3,sys,time,shutil,subprocess
R=Path(sys.argv[1]);B=R.parent;OLD=B/'model32-33-native-search-20261103-v1'
sys.path.insert(0,str(R/'source'))
sys.path.insert(0,str(R.parent))
from hybrid import latest32
import numpy as np
import campaign as c
from native import Backend,atomic_json,sha,ptr,U,F
from runner import Player,Model31

def guard():
 if (R/'STOP').exists() or (R/'INTERRUPTED.json').exists():raise SystemExit(75)
 while shutil.disk_usage(R).free<5*2**30 or subprocess.run(
         ['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],
         capture_output=True,text=True).stdout.strip()=='4':
  if (R/'STOP').exists() or (R/'INTERRUPTED.json').exists():raise SystemExit(75)
  time.sleep(5)
def freeze(source,target):
 source=Path(source);target=Path(target)
 if target.exists():
  for name,h in c.read(target/'frozen-manifest.json').items():assert sha(target/name)==h
  return
 tmp=target.with_name(target.name+'.partial')
 if tmp.exists():shutil.rmtree(tmp)
 shutil.copytree(source,tmp)
 manifest={p.name:sha(p) for p in tmp.iterdir() if p.is_file() and p.name!='frozen-manifest.json'}
 assert manifest=={p.name:sha(source/p.name) for p in tmp.iterdir() if p.is_file() and p.name!='frozen-manifest.json'}
 atomic_json(tmp/'frozen-manifest.json',manifest);tmp.rename(target)

def wait():
 while True:
  guard();state=c.read(B/'model32-double-r33-v1/campaign-supervisor/status.json')
  atomic_json(R/'wait-status.json',dict(at=time.time(),parentState=state['state']))
  if state['state']=='complete':break
  if state['state'] in ('failed','stopped'):raise RuntimeError('Doubled32 parent needs recovery; its checkpoints are preserved')
  time.sleep(30)
 atomic_json(R/'wait.json',dict(status='complete'))

def initialize():
 guard();old31=B/'model31-large-ace-backlog-v1';p31=old31/'data'/c.read(old31/'data/current.json')['folder']
 p32=Path(c.read(B/'model32-double-r33-v1/double.json')['result']['checkpoint'])
 r31=R/'model31';d31=r31/'data';d32=R/'data/model32'
 freeze(p31,d31/'frozen');freeze(p32,d32/'frozen')
 if not (d31/'input').exists():freeze(d31/'frozen',d31/'input')
 if not (d31/'current.json').exists():atomic_json(d31/'current.json',dict(folder='input'))
 config=c.read(old31/'config.json');db=sqlite3.connect('file:'+config['aceTeacher']['database']+'?mode=ro',uri=True)
 high=db.execute('select max(rowid) from labels').fetchone()[0];db.close()
 config.update(archive=str(d31.resolve()),labelHighWater=high)
 atomic_json(r31/'config.json',config)
 shutil.copy2(old31/'data/heldout-labels.json',d31/'heldout-labels.json')
 shutil.copy2(old31/'data/heldout-labels.json',d32/'heldout-labels.json')
 atomic_json(R/'ace-config.json',dict(database=config['aceTeacher']['database'],identity=config['aceTeacher']['identity'],labelHighWater=high))
 atomic_json(R/'initialize.json',dict(status='complete',parent31=str(p31),parent32=str(p32),labelHighWater=high,baseline31=str(d31/'frozen'),baseline32=str(d32/'frozen')))

def backend():
 b=Backend(R);b.lib.m3233_ace.argtypes=[ct.c_void_p,U,F,ct.c_int,ct.c_float,F,ct.c_int];return b

def api(b,n,x,update=False):
 raw=np.ascontiguousarray(x['raw'],np.uint8);features=np.ascontiguousarray(x['features'],np.float32);out=np.zeros(3,np.float32)
 assert n.stage==int(x['role']>=2) and x['action'] in x['legal']
 b.check(b.lib.m3233_ace(n.handle,ptr(raw,U),ptr(features,F),int(x['action']),1e-4,ptr(out,F),int(update)))
 assert np.isfinite(out).all();return out

def eval32(player,folder):
 ref=c.read(R/'campaign-config.json')['references'][0];opponent=Model31(R,ref['checkpoint'],ref['library'],True)
 try:return c.evaluate(R,player,opponent,folder,500,892320000,player.backend)
 finally:opponent.close()

def heldout32(player,folder):
 receipt=folder/'heldout.json'
 if receipt.exists():return c.read(receipt)
 rows=c.read(R/'data/model32/heldout-labels.json')['rows'];loss=[]
 for i,x in enumerate(rows):
  if i%32==0:guard()
  loss.append(float(api(player.backend,player.networks[int(x['role']>=2)],x)[0]))
 result=dict(labels=len(rows),meanPreferenceCE=float(np.mean(loss)),trainingUse=False);atomic_json(receipt,result);return result

def select32(player,number):
 path=R/'data/model32'/f'labels-{number}.json'
 if path.exists():return c.read(path)['rows']
 cfg=c.read(R/'ace-config.json');db=sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True);groups=[]
 cfg['labelHighWater']=db.execute('SELECT MAX(rowid) FROM labels').fetchone()[0]
 for role in range(4):
  rows=[dict(json.loads(p),rowId=i) for i,p in db.execute('SELECT rowid,payload FROM labels WHERE role=? AND split=0 AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?',(role,player.teacher_cursor[role],cfg['labelHighWater'],cfg['labelsPerRole']))]
  assert all(x['role']==role and x['split']==0 and x['teacherIdentity']==cfg['identity'] and x['actor']=='Ace 28.3.fast' and x['action'] in x['legal'] for x in rows)
  np.random.default_rng(811051+number*13+role).shuffle(rows);groups.append(rows)
 db.close();rows=[group[i] for i in range(max(map(len,groups),default=0)) for group in groups if i<len(group)]
 atomic_json(path,dict(rows=rows,startCursors=player.teacher_cursor,highWater=cfg['labelHighWater']));return rows

def train32(number):
 guard();data=R/'data/model32';work=data/f'round-{number}';work.mkdir(exist_ok=True);receipt=R/f'model32-round-{number}.json'
 if receipt.exists():return
 b=backend();state=c.read(work/'current.json')
 if state:player=Player.load(b,work/state['folder'],True)
 else:
  prior=data/'frozen' if number==1 else latest32(R.parent,number-1)
  player=Player.load(b,prior,True);state=dict(consumed=0,acceptedUpdates=0,ingestionSeconds=0.)
  c.publish(player,work,state);state=c.read(work/'current.json')
 try:
  baseline=data/'baseline';baseline.mkdir(exist_ok=True)
  if not (baseline/'report.json').exists():
   assert number==1 and state['consumed']==0
   atomic_json(baseline/'report.json',eval32(player,baseline/'evaluation'))
   heldout32(player,baseline)
  elif not (baseline/'heldout.json').exists():
   assert number==1 and state['consumed']==0;heldout32(player,baseline)
  rows=select32(player,number);consumed=state['consumed'];accepted=state.get('acceptedUpdates',0);elapsed=state.get('ingestionSeconds',0.);checkpoint_at=time.monotonic();dirty=False
  def commit():
   c.publish(player,work,dict(consumed=consumed,acceptedUpdates=accepted,ingestionSeconds=elapsed))
   atomic_json(R/'progress.json',dict(model=32,round=number,committedLabels=consumed,selectedLabels=len(rows),acceptedUpdates=accepted,ingestionSeconds=elapsed,at=time.time()))
  try:
   for i in range(consumed,len(rows)):
    if i%16==0:guard()
    began=time.monotonic();x=rows[i]
    if len(set(x['legal']))>1:accepted+=int(api(b,player.networks[int(x['role']>=2)],x,True)[2]>0)
    consumed=i+1;elapsed+=time.monotonic()-began;dirty=True
    if consumed%512==0 or time.monotonic()-checkpoint_at>=30:commit();dirty=False;checkpoint_at=time.monotonic()
  except (SystemExit,InterruptedError):
   if dirty:commit()
   raise
  for role in range(4):player.teacher_cursor[role]=max([player.teacher_cursor[role]]+[x['rowId'] for x in rows if x['role']==role])
  commit()
  final=number==c.read(R/'ace-config.json')['finalRound']
  after=eval32(player,work/'evaluation') if final else None;hold=heldout32(player,work) if final else None;state=c.read(work/'current.json')
  result=dict(status='complete',model=32,round=number,labelsConsumed=consumed,acceptedUpdates=accepted,ingestionSeconds=elapsed,baseline=c.read(baseline/'report.json'),evaluation=after,baselineHeldout=c.read(baseline/'heldout.json'),heldout=hold,checkpoint=str(work/state['folder']),cursors=player.teacher_cursor,promotion='Retained experimental continuation; original and pre-Ace snapshots preserved')
  atomic_json(receipt,result)
 finally:player.close()

if __name__=='__main__':
 with (R/'writer.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  for sig in (signal.SIGTERM,signal.SIGINT):
   signal.signal(sig,lambda n,f:atomic_json(R/'INTERRUPTED.json',dict(signal=n,at=time.time())))
  train32(int(sys.argv[2]))
