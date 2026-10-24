"""Conservative #34069 evidence checks. Unknown or incomplete proof is FINAL."""
import datetime,json,math,os,pathlib,subprocess,time
P=pathlib.Path
APIS=['execSync','execFileSync','spawnSync','Bun.spawnSync']
def rows(path):
 return [json.loads(line)for line in path.read_text().splitlines()if line.startswith('{')]
def recorder(out,complete=False,expected=None):
 files=sorted(out.glob('*.sync-spawn.jsonl'));active=[];counts={api:0 for api in APIS}
 if expected is not None and len(files)!=expected:raise ValueError('sync-spawn recorder missing process')
 if not files:raise ValueError('sync-spawn recorder absent')
 for file in files:
  data=rows(file);ready=[x for x in data if x.get('kind')=='sync-spawn-recorder'and x.get('event')=='ready'];exits=[x for x in data if x.get('kind')=='sync-spawn-recorder'and x.get('event')in ['exit','stop']];pending={};local={api:0 for api in APIS}
  if len(ready)!=1 or ready[0]['apis']!=APIS or file.stem.split('.')[0]!=str(ready[0]['pid']):raise ValueError('recorder identity/APIs')
  for row in data:
   if row['pid']!=ready[0]['pid']:raise ValueError('recorder pid changed')
   if row.get('kind')!='sync-spawn':continue
   api=row['api'];key=row['id']
   if api not in counts:raise ValueError('unknown recorder API')
   if row['event']=='start':
    if key in pending or not row.get('stack')or 'arguments'not in row:raise ValueError('recorder start')
    pending[key]=row;counts[api]+=1;local[api]+=1
   elif row['event']=='end':
    if key not in pending or row['durationMs']<0 or not math.isfinite(row['durationMs'])or row['api']!=pending[key]['api']:raise ValueError('recorder end')
    del pending[key]
   else:raise ValueError('recorder event')
  if complete and (not exits or any(x['counts']!=local or x['broken']for x in exits)or pending):raise ValueError('incomplete sync-spawn recorder')
  active+=list(pending.values())
 return {'processes':len(files),'counts':counts,'total':sum(counts.values()),'active':active}
def process_witness(out):
 """Called while the phase is alive, and once more BEFORE timeout group cleanup."""
 try:
  if not list(out.glob('*.sync-spawn.jsonl')):return
  active=recorder(out)['active']
  if not active:return
  raw=subprocess.run(['ps','-axo','pid=,ppid=,pgid=,stat=,lstart=,ucomm='],capture_output=True,text=True,timeout=2,env={**os.environ,'LC_ALL':'C'})
  row={'atUnixMs':time.time()*1000,'active':active,'returncode':raw.returncode,'stdout':raw.stdout,'stderr':raw.stderr}
  with open(out/'sync-spawn-processes.jsonl','a')as f:f.write(json.dumps(row)+'\n');f.flush()
 except (ValueError,KeyError):
  return # A new/append-in-progress file is retried; final signature parsing is strict.
 except Exception as e:
  with open(out/'sync-spawn-monitor-errors.jsonl','a')as f:f.write(json.dumps({'error':repr(e)})+'\n')
def zombie_matches(witness,call,group):
 if witness.get('returncode')!=0 or not call.get('expectedChild'):return False
 for line in witness['stdout'].splitlines():
  parts=line.split(None,9)
  if len(parts)!=10:continue
  pid,ppid,pgid,state=parts[:4]
  try:born=datetime.datetime.strptime(' '.join(parts[4:9]),'%a %b %d %H:%M:%S %Y').timestamp()*1000
  except ValueError:continue
  name=P(parts[9].strip()).name.strip('()')
  if int(ppid)==call['pid']and int(pgid)==group and 'Z'in state and name==call['expectedChild']and born>=call['atUnixMs']-1000:return True
 return False
def verified_signature(out,code,problem,prefix_check):
 try:
  if code==0:return {'verified':False,'reason':'not a failed phase'}
  data=rows(out/'generator.jsonl');errors=[x for x in data if x.get('kind')=='generator-error']
  if any(x.get('kind')=='complete'for x in data):raise ValueError('generator completed: not stall-only')
  execution=json.loads((out/'execution.json').read_text());stalled=execution['stalledAtUnixMs'];group=execution['processGroup']
  if problem=='whole-phase timeout':
   if errors:raise ValueError('independent generator error before timeout')
   killed=None
  elif problem is None:
   if len(errors)>1 or any(not x['message'].startswith(('worker command timeout: ','gate timeout: '))for x in errors):raise ValueError('independent generator failure')
   external=[x for x in data if x.get('kind')=='worker-exit'and x.get('signalCode')in ['SIGKILL',9]]
   cleanup=[x for x in data if x.get('kind')=='worker-kill'and not x['stopAcknowledged']and not x['alreadyExited']and x.get('cause','').startswith(('worker command timeout: ','gate timeout: '))and any(y.get('kind')=='worker-kill-result'and y['pid']==x['pid']and y.get('signalCode')in ['SIGTERM',15]for y in data)]
   killed=external+cleanup
   if len(killed)!=1:raise ValueError('not solely verified worker kill')
   killed=killed[0];stalled=killed['atUnixMs']
  else:raise ValueError('not solely whole-phase timeout or worker kill')
  if (out/'sync-spawn-monitor-errors.jsonl').exists():raise ValueError('monitor incomplete')
  current=recorder(out)['active'];witnesses=rows(out/'sync-spawn-processes.jsonl')
  prefix=prefix_check() # Completed observations only; unavailable CPU proof refuses.
  for witness in reversed(witnesses):
   # Live pre-cleanup OS witness, not a zombie created by our own SIGKILL.
   if not 0<=stalled-witness['atUnixMs']<=1000:continue
   for call in witness['active']:
    if killed and call['pid']!=killed['pid']:continue
    if not any((x['pid'],x['id'])==(call['pid'],call['id'])for x in current):continue
    if zombie_matches(witness,call,group):return {'verified':True,'issue':'oven-sh/bun#34069','witness':witness,'call':call,'prefix':prefix}
  raise ValueError('no contemporaneous attributable unreaped zombie with spawn in flight')
 except Exception as e:return {'verified':False,'reason':str(e)}
def apply_signature(status,state,proof):
 if not proof.get('verified'):return status
 # Count even when an envelope breach also invalidates this attempt.
 state['syncSpawnInvalids']=state.get('syncSpawnInvalids',0)+1
 if state['syncSpawnInvalids']>2:
  state['requiresPostBumpDeclaration']=True;return 'campaign-stopped'
 return 'invalid'
