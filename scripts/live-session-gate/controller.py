#!/usr/bin/env python3
"""Portable A1 instrument. --smoke is explicitly NOT qualification."""
import argparse,datetime,hashlib,json,math,os,pathlib,re,shutil,signal,subprocess,sys,tempfile,time
from stall import recorder,process_witness,verified_signature,apply_signature
from host import sha,write,checked,snapshot,envelope_errors,phase_errors,classification
P=pathlib.Path;HERE=P(__file__).resolve().parent
PINS={"1.3.14":"e0c90ec15d33363e6b70713d56bc3b2c7585c17f40a0fe0f8fd9305901d4e233","1.3.13":"fc0b4cae13a911098f0c61d13b7d9fd6b640bdb9f6b6a0b78bdb9d778c12bc3f"}
PATHS=["legacy","trpc","fallback","relay-reconnect","relay-qr","relay-request","relay-retired-qr","relay-retired-request"]
METHOD={"runsPerTierPerBun":3,"warmups":100,"samples":1000,"revokeTrials":100,"seconds":60,"rpcAdmissionsPerSecond":10,"eventBatchesPerSecond":10,"awaitedFramesPerSecond":12,"burstRPCs":100,"burstEventBatches":100,"paths":PATHS}
CEILINGS={"realistic":{"admission":[5,15,50],"gateHold":[3,10,30],"sweep":[5,15,50],"revoke":[600,1150,1300],"steadyCPU":25,"idleCPU":1},"large":{"admission":[25,75,200],"gateHold":[20,60,150],"sweep":[25,75,200],"revoke":[700,1250,1500],"steadyCPU":75,"idleCPU":5}}
WORKLOAD="no agent harness, build, browser, dev server, or any workload started for or during the gate; the host's resident idle login session is part of the environment; enforced by the quantitative envelope terms and recorded by full process snapshot before and after every phase."
def disk():
 if shutil.disk_usage("/System/Volumes/Data").free<3*1024**3:raise ValueError("3 GiB disk floor")
def resume_state(state,seal,out,resume):
 if state['status']=='campaign-stopped' or state.get('requiresPostBumpDeclaration'):raise ValueError('campaign stopped: fresh post-bump declaration required')
 if state['status']=='failure':raise ValueError('final failure; remedy changes required')
 if state['manifestSHA256']!=seal or state['results']!=str(out):raise ValueError('manifest/results changed')
 if state['status']=='running':raise ValueError('interrupted: reviewed recovery required')
 if state['status']=='complete':return False
 if not resume:raise ValueError('explicit resume required')
 return True
def validate(m):
 policy=json.loads((HERE/'manifest.air.policy.json').read_text())
 if any(m.get(k)!=v for k,v in policy.items()if k!='status'):raise ValueError('declaration differs from committed policy')
 if m.get("status")!="declared" or not m.get("declaredAt") or not re.fullmatch('[a-f0-9]{40}',m.get('gateHead','')):raise ValueError("manifest not declared")
 if m.get('sourceHead')!=m['gateHead'] or m.get('baselineHead')!='6c19d6c10c2e93192a5b7b4296bbf10531a55fb8':raise ValueError('head binding changed')
 if m['method']!=METHOD or m['ceilings']!=CEILINGS or m['buns']!=PINS:raise ValueError("method, ceilings or executables changed")
 if m['host']['workloadTerm']!=WORKLOAD or not m['host']['oneGateOneHost']:raise ValueError("host terms changed")
 e=m['envelope'];memory=e['memory']
 if e['minimumDiskFreeGiB']!=3 or e['maximumLoad1PerLogicalCPU']!=0.5 or e['maximumLoad5PerLogicalCPU']!=0.5:raise ValueError("envelope widened")
 if memory!={"kind":"absolute-swap-pressure-delta-v1","maximumSwapUsedGiB":2,"requiredPressureLevel":1,"maximumSystemSwapDeltaPages":0}:raise ValueError("memory envelope changed")
 if m['host']['expected']!={"model":"Mac14,2","chip":"Apple M2","ramBytes":17179869184,"logicalCPUs":8,"architecture":"arm64","osVersion":"26.6.2","osBuild":"25G83"}:raise ValueError("host class changed")
 if datetime.datetime.fromisoformat(m['declaredAt'].replace('Z','+00:00')).timestamp()>time.time():raise ValueError("future declaration")
def identity(m,clone,baseline,binaries,library,smoke=False):
 for v,p in binaries.items():
  if sha(p)!=PINS[v]:raise ValueError("executable hash mismatch "+v)
 if sha(library)!=m['nativeLibrarySHA256']:raise ValueError("native library hash mismatch")
 for label,path in [('source',clone),('baseline',baseline)]:
  if not smoke and label=='source':
   checked(['git','merge-base','--is-ancestor',m['productHead'],m['sourceHead']],path)
   if any(not(n.startswith('scripts/live-session-gate/')or n=='docs/live-session-cost-gate.md')for n in checked(['git','diff','--name-only',m['productHead'],m['sourceHead']],path).splitlines()):raise ValueError('product code changed: stop for review')
  if not smoke and (checked(['git','rev-parse','HEAD'],path)!=m[label+'Head']or checked(['git','status','--porcelain'],path)):raise ValueError(label+" head/clean mismatch")
  if not smoke and set(m[label+'Files'])!=set(n for n in checked(['git','ls-files'],path).splitlines()if(path/n).is_file()):raise ValueError('incomplete source closure')
  for name,h in m[label+'Files'].items():
   if sha(path/name)!=h:raise ValueError(label+" bytes changed: "+name)
 if not smoke:
  for name in ['controller.py','host.py','instrument.ts','worker.ts','traffic.ts','spawn-recorder.ts','stall.py','manifest.air.policy.json']:
   if sha(HERE/name)!=m['sourceFiles'].get('scripts/live-session-gate/'+name):raise ValueError('running instrument bytes changed')
def quantiles(values):
 if not values or any(not math.isfinite(x)or x<0 for x in values):raise ValueError('missing/invalid samples')
 a=sorted(values);return {name:a[max(0,math.ceil(len(a)*q)-1)]for name,q in [('p50',.5),('p95',.95),('p99',.99),('max',1)]}
def limit(values,limits):
 q=quantiles(values);return q,[k for k,v in zip(['p50','p95','max'],limits)if q[k]>v]
def records(path):
 # Application console lines remain in the raw file, never interpreted as samples.
 return [json.loads(l)for l in P(path).read_text().splitlines()if l.startswith('{')]
def markers(samples,gc):
 starts=[];ends=[];current=None;collections={}
 for m in re.finditer(r'GATE_START (\S+) (\d+)|GATE_END (\S+) (\d+)|=> (Eden|Full)Collection',gc):
  if m[1]:current=(m[1],int(m[2]));starts.append(current)
  elif m[3]:ends.append((m[3],int(m[4])));current=None
  elif current:collections[current]=collections.get(current,0)+1
 pairs=[(x['path'],x['id'])for x in samples]
 if starts!=ends or starts!=pairs or len(set(pairs))!=len(pairs):raise ValueError('sample/native GC marker mismatch')
 for x in samples:
  if len(x['usageBefore'])!=6 or len(x['usageAfter'])!=6 or any(not math.isfinite(n) for n in [x['wallMs'],*x['usageBefore'],*x['usageAfter']]):raise ValueError('sample counters')
  if any(n<0 for n in x['usageDelta'])or any(abs((b-a)-d)>1e-6 for a,b,d in zip(x['usageBefore'],x['usageAfter'],x['usageDelta'])):raise ValueError('counter delta')
  if any(not math.isfinite(v)or v<0 for gate in x.get('gates',[])for v in [gate['waitMs'],gate['holdMs']]):raise ValueError('native gate clock')
  x['nativeCollections']=collections.get((x['path'],x['id']),0)
 return samples
def prefix_check(out,phase,tier,config):
 # No incomplete sample is imputed, excluded from a clean run, or made a pass.
 # Prefix quantiles are conservative: they can refuse an exception, never pass a run.
 failures=[];observed=0
 for raw in [out/'generator.jsonl',*sorted(out.glob('worker-*.jsonl'))]:
  samples=[x for x in records(raw)if x.get('kind')=='sample'];observed+=len(samples)
  gc=raw.with_suffix('.gc.log').read_text();starts=list(re.finditer(r'GATE_START (\S+) (\d+)',gc));ends=list(re.finditer(r'GATE_END (\S+) (\d+)',gc))
  if len(starts)==len(ends)+1:gc=gc[:starts[-1].start()]
  markers(samples,gc)
  for row in samples:
   if row.get('error') and not(row['path']=='pending-publication'and row['error']=='Error: gate interrupted after committed publication'):raise ValueError('completed sample error before stall')
   quantiles([row['wallMs']])
   for gate in row.get('gates',[]):quantiles([gate['waitMs'],gate['holdMs']])
  for path in ['admission','resolver-admission']:
   eligible=[x for x in samples if x['phase'].split('/')[0]in ['first','warmup','timed']and x['path']==path]
   timed=eligible[1+config['warmups']:]
   for timed in [timed[:config['samples']],timed[config['samples']:]]:
    if not timed:continue
    failures+=limit([x['wallMs']for x in timed],CEILINGS[tier]['admission'])[1]
    if any(len(x['gates'])!=1 for x in timed):raise ValueError('incomplete completed gate evidence')
    failures+=limit([x['gates'][0]['holdMs']for x in timed],CEILINGS[tier]['gateHold'])[1]
  sweep=[x['wallMs']for x in samples if x['path']=='sweep'and x['counts'].get('readAuthority',0)>0]
  if sweep:failures+=limit(sweep,CEILINGS[tier]['sweep'])[1]
 data=records(out/'generator.jsonl')
 for flavor in ['web','desktop']:
  values=[x['ackToInvalidationMs']for x in data if x.get('kind')=='revoke'and x['flavor']==flavor]
  if values:failures+=limit(values,CEILINGS[tier]['revoke'])[1]
 loads=[x for x in data if x.get('kind')=='load']
 if phase in ['steady','idle','burst']:
  # Missing CPU/delivery receipts cannot prove that only a stall failed.
  if len(loads)!=1:raise ValueError('pre-stall CPU/delivery proof unavailable')
  row=loads[0]
  if row['dropped']or row['refused']:failures.append('load refusal')
  if phase!='burst'and(row['cpuWindowMs']!=config['seconds']*1000 or any(n<row['cpuWindowMs']for n in row['counterSpanMs'])):failures.append('CPU window')
  if phase!='burst'and not config.get('baseline')and row['cpuPercentOneCore']>CEILINGS[tier][phase+'CPU']:failures.append('CPU ceiling')
  if phase=='steady'and(sum(row['deliveredStreamFrames'])!=config['seconds']*12 or sum(0<=x<=config['seconds']*1000 for group in row['streamArrivalMs']for x in group)<config['seconds']*10 or any(n!=config['seconds']*5 for group in row['deliveredEvents']for n in group)):failures.append('delivery ceiling')
 if failures:raise ValueError('ceiling exceeded before stall: '+repr(failures))
 return {'completedSamples':observed,'failures':failures,'notQualification':True}
def summarize(out,phase,tier,config,smoke=False):
 data=records(out/'generator.jsonl');complete=[x for x in data if x.get('kind')=='complete']
 if phase!='prepare' and len(complete)!=1:raise ValueError('incomplete generator')
 failures=[];checks={};all_samples=[]
 workers=sorted(out.glob('worker-*.jsonl'));expected_workers=0 if phase=='prepare'else 1 if phase=='mutation-recovery'else 3 if phase in ['revokes','active-revoke','suspend']else 2
 if len(workers)!=expected_workers or len([row for row in data if row.get('kind')=='workerUsage'])!=expected_workers:raise ValueError('worker logs or CPU/lifecycle receipts missing')
 for raw in workers:
  samples=[x for x in records(raw)if x.get('kind')=='sample'];markers(samples,raw.with_suffix('.gc.log').read_text());all_samples+=samples
  # Record per-worker decisions separately; pooling can hide a slow bridge.
  if phase=='admission':
   for measured_path in ['admission','resolver-admission']:
    eligible=[x for x in samples if x['phase'].split('/')[0]in ['first','warmup','timed']and x['path']==measured_path]
    warmups=config['warmups'];required=config['samples']
    if len(eligible)<1+warmups+required:raise ValueError('missing first/warmup/timed '+measured_path)
    for index,row in enumerate(eligible):row['decisionPhase']='first'if index==0 else'warmup'if index<=warmups else'timed'if index<=warmups+required else'additional'
    for suffix,timed in [('',eligible[1+warmups:1+warmups+required]),('/additional',eligible[1+warmups+required:])]:
     if not timed:continue
     q,bad=limit([x['wallMs']for x in timed],CEILINGS[tier]['admission']);checks[raw.name+'/'+measured_path+suffix]=q;failures +=[raw.name+'/'+measured_path+suffix+'/'+x for x in bad]
     holds=[g['holdMs']for x in timed for g in x['gates']]
     if len(holds)!=len(timed):raise ValueError('one actual managed gate per decision required')
     q,bad=limit(holds,CEILINGS[tier]['gateHold']);checks[raw.name+'/'+measured_path+suffix+'/gateHold']=q;failures +=[raw.name+'/'+measured_path+suffix+'/gateHold/'+x for x in bad]
  sweep=[x['wallMs']for x in samples if x['path']=='sweep'and x['counts'].get('readAuthority',0)>0]
  if sweep:
   q,bad=limit(sweep,CEILINGS[tier]['sweep']);checks[raw.name+'/sweep']=q;failures +=[raw.name+'/sweep/'+x for x in bad]
  if phase=='idle' and not config.get('baseline') and not smoke:
   backstop=[x for x in samples if x['path']=='sweep' and x['phase']=='idle' and x['counts'].get('readAuthority',0)>0]
   if not backstop:raise ValueError('idle full-read backstop was not observed')
 if phase in ['active-revoke','suspend']:
  witnesses=[x for x in data if x.get('kind')=='lifetime-witness']
  if len(witnesses)!=1 or witnesses[0]['wallClockClosurePromise']:raise ValueError('lifetime trace missing')
 if phase=='mutation-recovery':
  if not any(x['path']=='pending-publication' and x.get('error') for x in all_samples)or not any(x['path']=='recovery'and not x.get('error')for x in all_samples):raise ValueError('pending publication/recovery traces missing')
 if phase=='prepare':
  prep=[x for x in data if x.get('kind')=='prepared']
  if len(prep)!=1 or not prep[0].get('migration',{}).get('planHash'):raise ValueError('real migration receipt missing')
  f=prep[0]
  if f['generations']!=(10000 if tier=='large'else 100)or f['keys']!=(32 if tier=='large'else 4):raise ValueError('wrong fixture tier')
  if f['largestLegacyGenerationBytes']>1048576 or f['legacyBytes']>128*1024**2 or any(row['bytes']>1048576 for row in f['authorityFiles'])or sum(row['bytes']for row in f['authorityFiles'])>128*1024**2:raise ValueError('fixture capacity exceeded')
 if phase=='revokes':
  revokes=[x for x in data if x.get('kind')=='revoke']
  if len(revokes)!=config['trials']*2:raise ValueError('missing revoke trials')
  for flavor in ['web','desktop']:
   q,bad=limit([x['ackToInvalidationMs']for x in revokes if x['flavor']==flavor],CEILINGS[tier]['revoke']);checks[flavor+'/revoke']=q;failures +=[flavor+'/revoke/'+x for x in bad]
 if phase in ['steady','idle','burst']:
  loads=[x for x in data if x.get('kind')=='load']
  if len(loads)!=1:raise ValueError('load receipt missing')
  row=loads[0]
  if phase!='burst'and(row['cpuWindowMs']!=config['seconds']*1000 or any(n<row['cpuWindowMs']for n in row['counterSpanMs'])):raise ValueError('CPU window shortened')
  if row['dropped']or row['refused']:failures.append('dropped/refused load')
  checks['load']=row
  if phase!='burst' and not config.get('baseline') and row['cpuPercentOneCore']>CEILINGS[tier][phase+'CPU']:failures.append(phase+' CPU')
  if phase=='steady':
   expected=config['seconds']*10
   if sum(row['deliveredStreamFrames'])!=config['seconds']*12:raise ValueError('missing or extra awaited frames')
   if sum(0<=arrival<=config['seconds']*1000 for group in row['streamArrivalMs']for arrival in group)<config['seconds']*10:raise ValueError('sustained awaited delivery below 10 frames/s')
   if any(n!=expected//2 for group in row['deliveredEvents']for n in group):raise ValueError('fanout delivery mismatch')
 write(out/'samples-with-gc.json',all_samples)
 return {'checks':checks,'failures':failures,'samples':len(all_samples),'nativeCollections':sum(x['nativeCollections']for x in all_samples)}
def execute(argv,clone,out,timeout):
 with open(out/'generator.jsonl','w')as stdout,open(out/'generator.gc.log','w')as stderr:
  p=subprocess.Popen(argv,cwd=clone,env={**os.environ,'BUN_JSC_logGC':'1'},stdout=stdout,stderr=stderr,start_new_session=True)
  try:
   deadline=time.monotonic()+timeout
   while True:
    process_witness(out)
    remaining=deadline-time.monotonic()
    if remaining<=0:raise subprocess.TimeoutExpired(argv,timeout)
    try:
     code=p.wait(timeout=min(.25,remaining))
     process_witness(out);write(out/'execution.json',{'processGroup':p.pid,'stalledAtUnixMs':time.time()*1000})
     return code,None
    except subprocess.TimeoutExpired:
     if time.monotonic()>=deadline:raise
  except subprocess.TimeoutExpired:
   process_witness(out);write(out/'execution.json',{'processGroup':p.pid,'stalledAtUnixMs':time.time()*1000})
   os.killpg(p.pid,signal.SIGKILL);p.wait();return -1,'whole-phase timeout'
  except BaseException:
   os.killpg(p.pid,signal.SIGKILL);p.wait();raise
  finally:
   # Cleanup the entire group even if a crashed generator left a child alive.
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
def schedule(tier,smoke=False):
 maximum=32 if tier=='large'else 4
 yield {'phase':'prepare'}
 for path in PATHS:
  for peers in [1,maximum]:yield {'phase':'admission','path':path,'peers':peers}
 for baseline in [True,False]:
  for phase in ['steady','idle']:yield {'phase':phase,'path':'trpc','peers':maximum,'baseline':baseline}
 yield {'phase':'burst','path':'trpc','peers':maximum}
 yield {'phase':'revokes','path':'legacy','peers':maximum}
 yield {'phase':'active-revoke','path':'legacy','peers':maximum}
 yield {'phase':'suspend','path':'legacy','peers':maximum}
 yield {'phase':'mutation-recovery'}
def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',type=P,required=True);p.add_argument('--clone',type=P,required=True);p.add_argument('--baseline-clone',type=P,required=True);p.add_argument('--library',type=P,required=True);p.add_argument('--bun-1-3-14',type=P,required=True);p.add_argument('--bun-1-3-13',type=P,required=True);p.add_argument('--results',type=P,required=True)
 mode=p.add_mutually_exclusive_group(required=True);mode.add_argument('--run',action='store_true');mode.add_argument('--smoke',action='store_true');mode.add_argument('--inspect',action='store_true');p.add_argument('--resume',action='store_true');p.add_argument('--smoke-path',choices=PATHS,default='trpc');p.add_argument('--smoke-tier',choices=['realistic','large'],default='realistic');p.add_argument('--smoke-baseline',action='store_true');p.add_argument('--smoke-version',choices=list(PINS),default='1.3.14');args=p.parse_args()
 clone=args.clone.resolve();baseline=args.baseline_clone.resolve();buns={'1.3.14':args.bun_1_3_14.resolve(),'1.3.13':args.bun_1_3_13.resolve()};library=args.library.resolve();m=json.loads(args.manifest.read_text());out=args.results.resolve();disk();out.mkdir(mode=0o700,parents=True,exist_ok=True);identity(m,clone,baseline,buns,library,args.smoke)
 if args.inspect:
  s=snapshot();write(out/('inspect-'+str(time.time_ns())+'.json'),{'snapshot':s,'errors':envelope_errors(s,m),'gateLaunched':False});return
 if not args.smoke:validate(m)
 # One per-head journal and lock survive result-directory/declaration changes.
 statepath=(P.home()/'.local/state/scout/live-session-gates'/(m['sourceHead']+'.json'))if not args.smoke else out/'smoke.state.json';statepath.parent.mkdir(parents=True,exist_ok=True);seal=sha(args.manifest)
 lock=statepath.with_suffix('.lock');lock.mkdir()
 try:
  if statepath.exists():
   state=json.loads(statepath.read_text())
   if not resume_state(state,seal,out,args.resume):print('Already complete; no rerun');return
  else:
   if args.resume or any(path!=lock for path in out.iterdir()):raise ValueError('fresh empty results required')
   state={'manifestSHA256':seal,'results':str(out),'status':'ready','nextRun':0,'attempt':0,'hardwareUUID':None,'qualification':not args.smoke,'syncSpawnInvalids':0,'syncSpawnCounts':{}};write(statepath,state)
  runs=[(v,t,n)for v in PINS for t in ['realistic','large']for n in range(1,4)]if not args.smoke else [(args.smoke_version,args.smoke_tier,1)]
  while state['nextRun']<len(runs):
   v,t,n=runs[state['nextRun']];state['attempt']+=1;attempt=out/f'{v}-{t}-{n}-attempt-{state["attempt"]}';attempt.mkdir();root=P(tempfile.mkdtemp(prefix='pairing-capsule-live-gate-'));keys=root.parent/(root.name+'-keys.json');run_results=[]
   try:
    phases=list(schedule(t,args.smoke))
    if args.smoke:phases=[{'phase':'prepare'},{'phase':'admission','path':args.smoke_path,'peers':1},{'phase':'steady','path':'trpc','peers':1},{'phase':'revokes','path':'legacy','peers':1},{'phase':'active-revoke','path':'legacy','peers':1},{'phase':'suspend','path':'legacy','peers':1},{'phase':'mutation-recovery'}]
    if args.smoke_baseline and args.smoke:phases[2:2]=[{'phase':'steady','path':'trpc','peers':1,'baseline':True},{'phase':'idle','path':'trpc','peers':1,'baseline':True}]
    for i,options in enumerate(phases):
     phase=options['phase'];folder=attempt/f'{i:02d}-{phase}-{options.get("path","")}-{options.get("peers",0)}-{options.get("baseline",False)}';folder.mkdir();disk();identity(m,clone,baseline,buns,library,args.smoke);before=snapshot();write(folder/'before.host.json',before);errors=envelope_errors(before,m)
     uid=before.get('parsed',{}).get('hardwareUUID')
     if state['hardwareUUID']is None and uid:state['hardwareUUID']=uid
     if uid!=state['hardwareUUID']:errors.append('hardware changed')
     if errors and not args.smoke:
      state['status']='held';write(folder/'result.json',{'status':'held','errors':errors,'launched':False});write(statepath,state);raise SystemExit(2)
     cfg={**options,'source':str(clone),'baselineSource':str(baseline),'root':str(root),'gateLock':str(root.parent/(root.name+'.lock')),'keys':str(keys),'tier':t,'library':str(library),'executableSHA256':PINS[v],'output':str(folder),'warmups':100 if not args.smoke else 1,'samples':1000 if not args.smoke else 2,'trials':100 if not args.smoke else 2,'seconds':60 if not args.smoke else 2,'smoke':args.smoke}
     write(folder/'config.json',cfg);state['status']='running';write(statepath,state);code,problem=execute([str(buns[v]),str(HERE/'traffic.ts'),str(folder/'config.json')],clone,folder,900)
     after=snapshot();write(folder/'after.host.json',after);errors=phase_errors(before,after,m)
     try:identity(m,clone,baseline,buns,library,args.smoke)
     except Exception as e:problem='post-phase identity '+repr(e)
     summary=None
     try:
      if not code and not problem:
       summary=summarize(folder,phase,t,cfg,args.smoke)
       summary['syncSpawns']=recorder(folder,complete=True,expected=(1 if phase=='prepare'else 2 if phase=='mutation-recovery'else 4 if phase in ['revokes','active-revoke','suspend']else 3))
       if summary['failures'] and not args.smoke:problem='unchanged ceilings exceeded'
     except Exception as e:problem='evidence validation '+repr(e)
     status=classification(errors,code,problem)if not args.smoke else 'smoke-failure'if code or problem else 'smoke-pass'
     proof=verified_signature(folder,code,problem,lambda:prefix_check(folder,phase,t,cfg))if code or problem else {'verified':False,'reason':'clean phase'}
     if not args.smoke:status=apply_signature(status,state,proof)
     try:
      counts=recorder(folder)['counts']
      for api,count in counts.items():state.setdefault('syncSpawnCounts',{})[api]=state.get('syncSpawnCounts',{}).get(api,0)+count
     except Exception:pass # Clean-run completeness above is mandatory; failures cannot pass.
     result={'syncSpawnSignature':proof,'status':status,'phase':phase,'options':options,'exit':code,'problem':problem,'envelopeErrors':errors,'summary':summary,'qualification':not args.smoke};write(folder/'result.json',result);run_results.append(result)
     if status not in ['pass','smoke-pass']:
      state['status']='campaign-stopped'if status=='campaign-stopped'else'failure'if status in ['failure','smoke-failure']else'invalid';write(attempt/'result.json',result);write(statepath,state);print(status,folder,problem,flush=True);raise SystemExit(1 if state['status']in ['failure','campaign-stopped']else 2)
    cpu={}
    for mode in ['steady','idle']:
     pair=[row for row in run_results if row['phase']==mode]
     if len(pair)==2:
      base_value=next(row['summary']['checks']['load']['cpuPercentOneCore']for row in pair if row['options'].get('baseline'));head_value=next(row['summary']['checks']['load']['cpuPercentOneCore']for row in pair if not row['options'].get('baseline'));cpu[mode]={'baselinePercentOneCore':base_value,'guardedPercentOneCore':head_value,'deltaPercentagePoints':head_value-base_value}
    write(attempt/'cpu-delta.json',cpu)
    write(attempt/'result.json',{'status':'pass'if not args.smoke else'not-the-gate','phases':run_results});state['nextRun']+=1;state['attempt']=0;state['status']='ready';write(statepath,state)
   finally:
    shutil.rmtree(root);keys.unlink(missing_ok=True);(root.parent/(root.name+'.lock')).unlink(missing_ok=True)
   if state['nextRun']<len(runs):time.sleep(30)
  state['status']='complete';state['syncSpawnEmpiricalZero']={'observed':sum(state.get('syncSpawnCounts',{}).values())==0,'scope':'all launched phases, including retained invalid attempts','qualifyingRuns':state['nextRun']if not args.smoke else 0,'allTwelveClean':not args.smoke and state['nextRun']==12};write(statepath,state);print('All runs complete'if not args.smoke else'Smoke complete: NOT THE GATE',flush=True)
 finally:lock.rmdir()
if __name__=='__main__':main()
