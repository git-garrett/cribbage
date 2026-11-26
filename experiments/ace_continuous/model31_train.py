import os,sys,json,time,signal,fcntl,sqlite3,shutil,gzip,subprocess,random
from pathlib import Path
R=Path(sys.argv[1]);B=Path('/Users/garrett/Library/Application Support/StrongCribbage/runtimes');S=B/'model31-exploration-20261024-v2';OLD=B/'model32-33-native-search-20261103-v1'
sys.path.insert(0,str(R/'source'))
import numpy as np
from scaling_data import save,sha
from native_learning import Backend,Trainer
from checkpoint_policy import models
from native_rollout import Rollout
from schema import ROLES
from paired import summarize
cfg=json.loads((R/'config.json').read_text())
def read(p):return json.loads(Path(p).read_text())
def guard():
 if (R/'STOP').exists() or (R/'INTERRUPTED.json').exists():raise SystemExit(75)
 while shutil.disk_usage(R).free<5*2**30 or subprocess.run(
         ['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],
         capture_output=True,text=True).stdout.strip()=='4':
  if (R/'STOP').exists() or (R/'INTERRUPTED.json').exists():raise SystemExit(75)
  time.sleep(5)
def mail(event,text):
 pass
def evaluate(folder):
 dest=R/'data'/('eval-'+folder.name);dest.mkdir(exist_ok=True)
 receipt=dest/'report.json'
 if receipt.exists():return read(receipt)
 wp=np.load(folder/'wp-state.npz')['table']
 original=R/'baseline-opponent'
 otherwp=np.load(original/'wp-state.npz')['table']
 settings=dict(cfg,model='31.0',candidateChunk=128,candidateQueueDepth=1,initializationSeed=8110403)
 run,_=Rollout(cfg['nativeCpp']['rolloutBuild'])(dest,settings,models(settings,folder.parent,folder.name),wp,cfg['followupSeeds']['progress'][0],1000,32,'comparison',opponent=(models(settings,original.parent,original.name),otherwp),progress=lambda *a:guard())
 result=summarize(run['savedGames'],run['seed'],run['games'],2)
 save(receipt,result);return result
def heldout(folder):
 receipt=R/'data'/('heldout-'+folder.name+'.json')
 if receipt.exists():return read(receipt)
 rows=read(R/'data/heldout-labels.json')['rows']
 backend=Backend(cfg['nativeCpp']['learningLibrary']);wp=np.load(folder/'wp-state.npz')['table'];metrics=[]
 for role in range(4):
  selected=[x for x in rows if x['role']==role and len(set(x['legal']))>1]
  correct=0;loss=0.;margin=0.
  with Trainer.checkpoint(backend,folder,role,wp,gpu=True) as n:
   for lo in range(0,len(selected),32):
    guard();part=selected[lo:lo+32]
    raw=np.asarray([x['raw'] for x in part],np.uint8);features=np.asarray([x['features'] for x in part],np.float32);a=np.asarray([x['action'] for x in part],np.int32)
    q=n.scores(raw,features);idx=np.arange(len(part));best=q.argmax(1);preferred=q[idx,a].copy()
    assert np.all(preferred>=0)
    q[idx,a]=-1.;alternative=q.max(1);assert np.all(alternative>=0)
    correct+=int(np.sum(best==a));loss+=float(np.logaddexp(0,(alternative-preferred)/.02).sum());margin+=float((preferred-alternative).sum())
  metrics.append(dict(role=role,labels=len(selected),agreement=correct/len(selected),preferenceLoss=loss/len(selected),meanWpMargin=margin/len(selected)))
 result=dict(status='complete',roles=metrics,labels=sum(x['labels'] for x in metrics),trainingUse=False)
 save(receipt,result);return result
def shuffled_block(block,number,role):
 result=list(block)
 random.Random(8110403+number*1000003+role*10007+block[0]['rowId']).shuffle(result)
 return result
def train(number):
 guard();current=read(R/'data/current.json');folder=R/'data'/current['folder']
 reportpath=R/('round-'+str(number)+'.json')
 if reportpath.exists():mail('round-'+str(number),json.dumps(read(reportpath)));return
 if number==1 and not (R/'baseline-result.json').exists():
  save(R/'baseline-result.json',evaluate(R/'frozen'))
  mail('baseline','Frozen larger Model 31 baseline: '+json.dumps(read(R/'baseline-result.json')))
 baseline_heldout=heldout(R/'frozen')
 # Persist the bounded immutable row selection before applying gradients.
 selection=R/'data'/('labels-'+str(number)+'.json')
 assert sha(selection)==read(selection.with_suffix('.sha256.json'))['sha256']
 rows=read(selection)['rows'];backend=Backend(cfg['nativeCpp']['learningLibrary'])
 consumed=0;began=time.monotonic()
 for role in range(4):
  current=read(R/'data/current.json');folder=R/'data'/current['folder']
  cursor=read(folder/'ace-teacher-state.json')['cursor']
  pending=[x for x in rows if x['role']==role and x['rowId']>cursor[role]]
  if not pending:continue
  wp=np.load(folder/'wp-state.npz')['table']
  with Trainer.checkpoint(backend,folder,role,wp,gpu=True) as n:
   # Keep the saved Adam moments, with a smaller rate for the Ace-only phase.
   n.rate=np.array(3e-5,np.float32)
   backend.check(backend.lib.m31_train_hyper(n.handle,float(n.rate),int(backend.lib.m31_train_step_count(n.handle))))
   for start in range(0,len(pending),4096):
    block=pending[start:start+4096]
    training=[x for x in shuffled_block(block,number,role) if len(set(x['legal']))>1]
    for lo in range(0,len(training),32):
     guard();part=training[lo:lo+32]
     raw=np.asarray([x['raw'] for x in part],np.uint8);features=np.asarray([x['features'] for x in part],np.float32);preferred=np.asarray([x['action'] for x in part],np.int32)
     q=n.scores(raw,features);assert np.all(q[np.arange(len(part)),preferred]>=0)
     q[np.arange(len(part)),preferred]=-1;alternative=q.argmax(1);assert np.all(q[np.arange(len(part)),alternative]>=0)
     loss=n.update(raw,preferred,features,alternative,True,.02,.1)
     assert np.isfinite(loss)
    guard()
    current=read(R/'data/current.json');previous=R/'data'/current['folder']
    dest=R/'data'/('checkpoint-'+str(time.time_ns()));shutil.copytree(previous,dest,copy_function=os.link)
    meta=n.save(dest)
    ck=read(dest/'checkpoint.json');ck['weightsSha256'][ROLES[role]]=meta['sha256'];save(dest/'checkpoint.json',ck)
    curs=read(dest/'ace-teacher-state.json');curs['cursor'][role]=block[-1]['rowId'];save(dest/'ace-teacher-state.json',curs)
    (dest/'manifest.json').unlink(missing_ok=True)
    save(R/'data/current.json',{'folder':dest.name,'round':number,'lastRole':role,'lastRowId':block[-1]['rowId']})
    if previous.name.startswith(('checkpoint-', 'selfplay-')):shutil.rmtree(previous)
    consumed+=len(block)
    save(R/'progress.json',{'round':number,'role':role,'committedExamplesThisInvocation':consumed,'lastRowId':block[-1]['rowId']})
 current=read(R/'data/current.json');folder=R/'data'/current['folder']
 final=number==cfg['finalRound']
 result=evaluate(folder) if final else None
 heldout_result=heldout(folder) if final else None
 retained=R/'data'/('round-'+str(number)+'-checkpoint')
 if final and not retained.exists():shutil.copytree(folder,retained,copy_function=os.link)
 report={'status':'complete','round':number,'selectedLabels':len(rows),'trainableLabels':sum(len(set(x['legal']))>1 for x in rows),'heldout':heldout_result,'baselineHeldout':baseline_heldout,'evaluation':result,'baseline':read(R/'baseline-result.json'),'cursors':read(folder/'ace-teacher-state.json')['cursor'],'checkpoint':str(retained) if final else None,'secondsThisInvocation':time.monotonic()-began}
 save(reportpath,report);mail('round-'+str(number),json.dumps(report))

with (R/'writer.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 for sig in (signal.SIGTERM,signal.SIGINT):
  signal.signal(sig,lambda n,f:save(R/'INTERRUPTED.json',{'signal':n}))
 if sys.argv[2]=='baseline':
  save(R/'baseline-result.json',evaluate(R/'frozen'))
 else:
  train(int(sys.argv[2]))
