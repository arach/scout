import datetime,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import controller as g
import stall
import test_controller as fixtures
P=pathlib.Path
class Signature(unittest.TestCase):
 def fixture(self,root):
  now=datetime.datetime.now().replace(microsecond=0);ms=now.timestamp()*1000
  call={'kind':'sync-spawn','event':'start','id':0,'api':'execFileSync','arguments':"['/usr/bin/git', ['status']]",'stack':'planted call site','pid':123,'expectedChild':'git','atUnixMs':ms,'monotonicMs':1}
  self.write(root/'123.sync-spawn.jsonl',[{'kind':'sync-spawn-recorder','event':'ready','apis':stall.APIS,'pid':123},call]);self.write(root/'generator.jsonl',[]);(root/'generator.gc.log').write_text('')
  (root/'execution.json').write_text(json.dumps({'processGroup':100,'stalledAtUnixMs':ms+900}))
  witness={'atUnixMs':ms+850,'active':[call],'returncode':0,'stdout':f"124 123 100 Z {now.strftime('%a %b %d %H:%M:%S %Y')} /usr/bin/git          \n"}
  self.write(root/'sync-spawn-processes.jsonl',[witness]);return call,witness,ms
 def write(self,path,rows):path.write_text(''.join(json.dumps(x)+'\n'for x in rows))
 def proof(self,root,code=-1,problem='whole-phase timeout',check=lambda: {'failures':[]}):return stall.verified_signature(root,code,problem,check)
 def test_exact_signature_timeout_and_worker_kill_are_invalid_not_pass(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d);call,witness,ms=self.fixture(root);proof=self.proof(root);self.assertTrue(proof['verified'],proof);state={};self.assertEqual(stall.apply_signature('failure',state,proof),'invalid');self.assertEqual(state['syncSpawnInvalids'],1)
   self.write(root/'generator.jsonl',[{'kind':'worker-exit','pid':123,'signalCode':'SIGKILL','atUnixMs':ms+900},{'kind':'generator-error','message':'worker command timeout: phase'}]);self.assertTrue(self.proof(root,1,None)['verified'])
 def test_execute_captures_live_os_zombie_before_its_own_cleanup(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d)
   source=r"""
import datetime,json,os,pathlib,subprocess,sys,time
r=pathlib.Path(sys.argv[1]);pid=os.getpid();name=pathlib.Path(subprocess.check_output(['ps','-p',str(pid),'-o','comm='],text=True).strip()).name
ready={'kind':'sync-spawn-recorder','event':'ready','apis':['execSync','execFileSync','spawnSync','Bun.spawnSync'],'pid':pid}
call={'kind':'sync-spawn','event':'start','id':0,'api':'spawnSync','arguments':'synthetic fork witness test, NOT Bun defect reproduction','stack':'synthetic','pid':pid,'expectedChild':name,'atUnixMs':time.time()*1000,'monotonicMs':1}
(r/f'{pid}.sync-spawn.jsonl').write_text(json.dumps(ready)+'\n'+json.dumps(call)+'\n')
child=os.fork()
if child==0:os._exit(0)
time.sleep(30)
"""
   code,problem=g.execute([sys.executable,'-c',source,str(root)],root,root,1.5)
   self.assertEqual(problem,'whole-phase timeout');proof=self.proof(root,code,problem);self.assertTrue(proof['verified'],proof)
 def test_cleanup_worker_kill_requires_stall_cause_and_actual_signal_receipt(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d);call,witness,ms=self.fixture(root)
   events=[{'kind':'worker-kill','pid':123,'stopAcknowledged':False,'alreadyExited':False,'cause':'worker command timeout: phase','atUnixMs':ms+900},{'kind':'generator-error','message':'worker command timeout: phase'},{'kind':'worker-kill-result','pid':123,'signalCode':'SIGTERM'}]
   self.write(root/'generator.jsonl',events);self.assertTrue(self.proof(root,1,None)['verified'])
   for key,value in [('stopAcknowledged',True),('alreadyExited',True),('cause','unrelated error')]:
    changed=json.loads(json.dumps(events));changed[0][key]=value;self.write(root/'generator.jsonl',changed);self.assertFalse(self.proof(root,1,None)['verified'])
   self.write(root/'generator.jsonl',events[:-1]);self.assertFalse(self.proof(root,1,None)['verified'])
 def test_missing_or_ambiguous_signature_is_final(self):
  for change in ['no-active','ended','not-zombie','other-parent','other-group','other-command','old-child','stale-witness','other-error','completed','no-recorder','monitor-error']:
   with self.subTest(change=change),tempfile.TemporaryDirectory()as d:
    root=P(d);call,witness,ms=self.fixture(root)
    if change=='no-active':witness['active']=[]
    elif change=='ended':
     with open(root/'123.sync-spawn.jsonl','a')as f:f.write(json.dumps({**call,'event':'end','durationMs':1})+'\n')
    elif change=='not-zombie':witness['stdout']=witness['stdout'].replace(' Z ',' S ')
    elif change=='other-parent':witness['stdout']=witness['stdout'].replace('124 123','124 999')
    elif change=='other-group':witness['stdout']=witness['stdout'].replace('123 100','123 999')
    elif change=='other-command':witness['stdout']=witness['stdout'].replace('git','sh')
    elif change=='old-child':witness['stdout']=witness['stdout'].replace(datetime.datetime.fromtimestamp(ms/1000).strftime('%Y'),str(datetime.datetime.now().year-1))
    elif change=='stale-witness':witness['atUnixMs']=ms-5000
    elif change=='other-error':self.write(root/'generator.jsonl',[{'kind':'generator-error','message':'unrelated product error'}])
    elif change=='completed':self.write(root/'generator.jsonl',[{'kind':'complete'}])
    elif change=='no-recorder':(root/'123.sync-spawn.jsonl').unlink()
    elif change=='monitor-error':(root/'sync-spawn-monitor-errors.jsonl').touch()
    self.write(root/'sync-spawn-processes.jsonl',[witness]);proof=self.proof(root);self.assertFalse(proof['verified'],change);self.assertEqual(stall.apply_signature('failure',{},proof),'failure')
 def test_unavailable_cpu_or_preceding_ceiling_never_gets_exception(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d);self.fixture(root)
   def exceeded():raise ValueError('ceiling exceeded before stall')
   self.assertFalse(self.proof(root,check=exceeded)['verified'])
   with self.assertRaisesRegex(ValueError,'CPU/delivery'):g.prefix_check(root,'steady','realistic',{'warmups':100,'samples':1000,'seconds':60})
   self.write(root/'worker-0.jsonl',[{'kind':'sample','id':0,'phase':'timed/path/1','path':'sweep','wallMs':51,'gates':[],'counts':{'readAuthority':1},'usageBefore':[0]*6,'usageAfter':[1]*6,'usageDelta':[1]*6}]);(root/'worker-0.gc.log').write_text('GATE_START sweep 0\nGATE_END sweep 0\n')
   proof=self.proof(root,check=lambda:g.prefix_check(root,'admission','realistic',{'warmups':100,'samples':1000}));self.assertFalse(proof['verified']);self.assertIn('ceiling exceeded',proof['reason'])
 def test_other_stall_or_failure_remains_final(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d);self.fixture(root)
   for code,problem in [(0,None),(1,'evidence validation failed'),(1,None),(-9,None)]:self.assertFalse(self.proof(root,code,problem)['verified'])
 def test_ready_without_calls_proves_zero_only_with_final_receipt(self):
  with tempfile.TemporaryDirectory()as d:
   root=P(d);self.write(root/'123.sync-spawn.jsonl',[{'kind':'sync-spawn-recorder','event':'ready','apis':stall.APIS,'pid':123},{'kind':'sync-spawn-recorder','event':'exit','pid':123,'counts':dict.fromkeys(stall.APIS,0),'broken':False}]);self.assertEqual(stall.recorder(root,True,1)['total'],0)
   with self.assertRaises(ValueError):stall.recorder(root,True,2)
   (root/'123.sync-spawn.jsonl').write_text((root/'123.sync-spawn.jsonl').read_text().splitlines()[0]+'\n')
   with self.assertRaises(ValueError):stall.recorder(root,True,1)

class Campaign(unittest.TestCase):
 healthy=fixtures.ControllerState.healthy
 invoke=fixtures.ControllerState.invoke
 context=fixtures.ControllerState.context
 def test_two_invalids_persist_across_resumes_third_stops_and_cannot_reset(self):
  with tempfile.TemporaryDirectory()as d:
   root,out,argv=self.context(d);ledger=root/'.local/state/scout/live-session-gates'/('f'*40+'.json')
   with patch.object(g,'verified_signature',return_value={'verified':True,'issue':'synthetic fixture'}):
    for n in [1,2,3]:
     with self.assertRaises(SystemExit)as e:self.invoke(root,argv+(['--resume']if n>1 else []),[self.healthy(),self.healthy()],lambda *args:(-1,'whole-phase timeout'))
     state=json.loads(ledger.read_text());self.assertEqual(state['syncSpawnInvalids'],n);self.assertEqual(state['nextRun'],0);self.assertEqual(state['status'],'invalid'if n<=2 else'campaign-stopped');self.assertEqual(e.exception.code,2 if n<=2 else 1)
   argv[argv.index('--results')+1]=str(root/'new-results')
   with self.assertRaisesRegex(ValueError,'campaign stopped'):self.invoke(root,argv+['--resume'],[],lambda *args:self.fail('no fourth attempt'))
   state['manifestSHA256']='other';self.assertTrue(state['requiresPostBumpDeclaration'])
   with self.assertRaisesRegex(ValueError,'campaign stopped'):g.resume_state(state,'new-manifest',root/'other',True)
 def test_counter_is_shared_across_tiers_runs_and_envelope_invalids(self):
  state={'nextRun':8,'syncSpawnInvalids':1};proof={'verified':True}
  self.assertEqual(stall.apply_signature('invalid',state,proof),'invalid');state['nextRun']=11
  self.assertEqual(stall.apply_signature('failure',state,proof),'campaign-stopped');self.assertEqual(state['syncSpawnInvalids'],3)

if __name__=='__main__':unittest.main()
