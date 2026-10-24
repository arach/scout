import copy,importlib.util,json,pathlib,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import controller as g
from host import classification,parse_swap,parse_vm,thermal_nominal,phase_errors
ROOT=pathlib.Path(__file__).resolve().parent
def manifest():
 m=json.loads((ROOT/'manifest.air.policy.json').read_text());m.update(status='declared',declaredAt='2026-10-23T00:00:00+00:00',gateHead='f'*40,sourceHead='f'*40);return m
class Policy(unittest.TestCase):
 def test_valid_declared_policy(self):g.validate(manifest())
 def test_undeclared_cannot_run(self):
  m=manifest();m['status']='policy'
  with self.assertRaises(ValueError):g.validate(m)
 def test_no_ceiling_rate_or_memory_widening(self):
  for section in ['method','ceilings','buns']:
   m=manifest();m[section]={}
   with self.assertRaises(ValueError):g.validate(m)
  for key,value in [('maximumSwapUsedGiB',3),('requiredPressureLevel',2),('maximumSystemSwapDeltaPages',1)]:
   m=manifest();m['envelope']['memory'][key]=value
   with self.assertRaises(ValueError):g.validate(m)
 def test_disk_and_load_pins(self):
  for key,value in [('minimumDiskFreeGiB',2),('maximumLoad1PerLogicalCPU',.6),('maximumLoad5PerLogicalCPU',float('nan'))]:
   m=manifest();m['envelope'][key]=value
   with self.assertRaises(ValueError):g.validate(m)
 def test_all_paths_profiles_and_tiers(self):
  for tier,n in [('realistic',4),('large',32)]:
   s=list(g.schedule(tier));self.assertEqual(len(s),26)
   self.assertEqual({(x['path'],x['peers'])for x in s if x['phase']=='admission'},{(p,n)for p in g.PATHS}|{(p,1)for p in g.PATHS})
   self.assertEqual(sum(x['phase']=='revokes'for x in s),1)
 def test_zero_swap_and_native_counters(self):
  self.assertEqual(parse_swap('total = 0M used = 0M free = 0M')['used'],0)
  self.assertEqual(parse_vm('Pageins: 999.\nSwapins: 0.\nSwapouts: 2.'),{'Swapins':0,'Swapouts':2})
 def test_unknown_thermal_fails_closed(self):self.assertFalse(thermal_nominal('unknown'))
 def test_whole_attempt_classification(self):
  self.assertEqual(classification(['swap'],1,'ceiling'),'invalid')
  self.assertEqual(classification([],1,None),'failure')
  self.assertEqual(classification([],0,'ceiling'),'failure')
 def test_final_failure_interruption_and_manifest_cannot_be_laundered(self):
  state={'status':'failure','manifestSHA256':'x','results':'out'}
  with self.assertRaisesRegex(ValueError,'final failure'):g.resume_state(state,'other','new',True)
  state['status']='running'
  with self.assertRaisesRegex(ValueError,'interrupted'):g.resume_state(state,'x','out',True)
  state['status']='invalid'
  with self.assertRaisesRegex(ValueError,'changed'):g.resume_state(state,'other','out',True)
  self.assertTrue(g.resume_state(state,'x','out',True))
  with self.assertRaisesRegex(ValueError,'explicit resume'):g.resume_state(state,'x','out',False)
 def test_nearest_rank_no_pool_or_drop(self):
  a=[1.]*999+[201.];q,bad=g.limit(a,[25,75,200]);self.assertEqual(q['p99'],1);self.assertEqual(q['max'],201);self.assertEqual(bad,['max']);self.assertEqual(len(a),1000)
  for bad in [[],[float('nan')],[-1]]:
   with self.assertRaises(ValueError):g.quantiles(bad)
 def test_marker_and_counter_integrity(self):
  sample={'path':'admission','id':0,'wallMs':1,'usageBefore':[0]*6,'usageAfter':[1]*6,'usageDelta':[1]*6}
  gc='GATE_START admission 0\n=> EdenCollection\nGATE_END admission 0';self.assertEqual(g.markers([sample],gc)[0]['nativeCollections'],1)
  for gc in ['',gc+'\nGATE_START admission 0\nGATE_END admission 0']:
   with self.assertRaises(ValueError):g.markers([sample],gc)
  sample['usageDelta'][0]=2
  with self.assertRaises(ValueError):g.markers([sample],'GATE_START admission 0\nGATE_END admission 0')

class ControllerState(unittest.TestCase):
 def healthy(self):
  m=manifest();return {'parsed':{**m['host']['expected'],'hardwareUUID':'synthetic-host','diskFreeBytes':100*1024**3,'loads':[0.,0.,0.],'thermalNominal':True,'acPower':True,'lowPowerModeOff':True,'swap':{'used':0,'free':0,'total':0},'pressureLevel':1,'systemSwap':{'Swapins':0,'Swapouts':0}}}
 def invoke(self,root,argv,snapshots,execute):
  with patch.object(sys,'argv',argv),patch.object(g,'identity'),patch.object(g,'disk'),patch.object(g,'snapshot',side_effect=snapshots),patch.object(g,'execute',side_effect=execute),patch.object(g.P,'home',return_value=root):return g.main()
 def context(self,d):
  root=pathlib.Path(d);m=root/'manifest.json';m.write_text(json.dumps(manifest()));out=root/'results'
  return root,out,['controller.py','--manifest',str(m),'--clone',d,'--baseline-clone',d,'--library',str(root/'native'),'--bun-1-3-14',str(root/'14'),'--bun-1-3-13',str(root/'13'),'--results',str(out),'--run']
 def test_inside_envelope_failure_survives_new_result_directory(self):
  with tempfile.TemporaryDirectory()as d:
   root,out,argv=self.context(d)
   with self.assertRaises(SystemExit)as e:self.invoke(root,argv,[self.healthy(),self.healthy()],lambda *args:(1,'synthetic failure'))
   self.assertEqual(e.exception.code,1);ledger=root/'.local/state/scout/live-session-gates'/('f'*40+'.json');self.assertEqual(json.loads(ledger.read_text())['status'],'failure')
   argv[argv.index('--results')+1]=str(root/'other-results')
   with self.assertRaisesRegex(ValueError,'final failure'):self.invoke(root,argv,[],lambda *args:self.fail('no second workload'))
 def test_breach_holds_without_launch_and_same_manifest_can_resume(self):
  with tempfile.TemporaryDirectory()as d:
   root,out,argv=self.context(d);bad=self.healthy();bad['parsed']['pressureLevel']=2
   with self.assertRaises(SystemExit)as e:self.invoke(root,argv,[bad],lambda *args:self.fail('must not launch outside envelope'))
   self.assertEqual(e.exception.code,2)
   with self.assertRaises(SystemExit)as e:self.invoke(root,argv+['--resume'],[self.healthy(),self.healthy()],lambda *args:(1,'synthetic inside-envelope failure'))
   self.assertEqual(e.exception.code,1);self.assertEqual(len(list(out.glob('*attempt-*'))),2)
 def test_interrupted_controller_never_restarts_automatically(self):
  with tempfile.TemporaryDirectory()as d:
   root,out,argv=self.context(d)
   def interrupt(*args):raise KeyboardInterrupt()
   with self.assertRaises(KeyboardInterrupt):self.invoke(root,argv,[self.healthy()],interrupt)
   with self.assertRaisesRegex(ValueError,'interrupted'):self.invoke(root,argv+['--resume'],[],lambda *args:self.fail('no restart'))


class Evidence(unittest.TestCase):
 def load(self):return {'kind':'load','dropped':0,'refused':0,'cpuWindowMs':2000,'counterSpanMs':[2001,2002],'cpuPercentOneCore':26,'deliveredStreamFrames':[12,12],'deliveredEvents':[[10],[10]],'streamArrivalMs':[[100]*12,[100]*12]}
 def files(self,root,row,workers=True):
  root=pathlib.Path(root);data=[row,{'kind':'complete'}]
  if workers:
   for i in range(2):
    (root/f'worker-{i}.jsonl').write_text('');(root/f'worker-{i}.gc.log').write_text('');data.append({'kind':'workerUsage'})
  (root/'generator.jsonl').write_text(''.join(json.dumps(x)+'\n'for x in data));return root
 def test_missing_worker_evidence_never_passes(self):
  with tempfile.TemporaryDirectory()as d:
   root=self.files(d,self.load(),False)
   with self.assertRaisesRegex(ValueError,'worker logs'):g.summarize(root,'steady','realistic',{'seconds':2})
 def test_fixed_cpu_denominator_and_overload_are_not_laundered(self):
  with tempfile.TemporaryDirectory()as d:
   row=self.load();row['elapsedMs']=100000;root=self.files(d,row)
   self.assertIn('steady CPU',g.summarize(root,'steady','realistic',{'seconds':2})['failures'])
   row['cpuWindowMs']=100000;root=self.files(d,row)
   with self.assertRaisesRegex(ValueError,'CPU window'):g.summarize(root,'steady','realistic',{'seconds':2})
 def test_actual_awaited_frame_floor_is_required(self):
  with tempfile.TemporaryDirectory()as d:
   row=self.load();row['streamArrivalMs']=[[3000]*12,[3000]*12];root=self.files(d,row)
   with self.assertRaisesRegex(ValueError,'below 10'):g.summarize(root,'steady','realistic',{'seconds':2})


class AdmissionPartition(unittest.TestCase):
 def test_exact_warmup_count_cannot_hide_a_decision_in_a_warmup_rpc(self):
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d)
   for worker in range(2):
    rows=[];log=[]
    for path in ['admission','resolver-admission']:
     for i in range(1102):
      n=len(rows);rows.append({'kind':'sample','id':n,'path':path,'phase':'warmup/path/1','wallMs':201 if i in [101,1101]else 1,'gates':[{'waitMs':0,'holdMs':1}],'usageBefore':[0]*6,'usageAfter':[1]*6,'usageDelta':[1]*6});log.extend([f'GATE_START {path} {n}',f'GATE_END {path} {n}'])
    (root/f'worker-{worker}.jsonl').write_text(''.join(json.dumps(x)+'\n'for x in rows));(root/f'worker-{worker}.gc.log').write_text('\n'.join(log))
   (root/'generator.jsonl').write_text('\n'.join(json.dumps(x)for x in [{'kind':'complete'},{'kind':'workerUsage'},{'kind':'workerUsage'}]))
   result=g.summarize(root,'admission','realistic',{'warmups':100,'samples':1000})
   self.assertTrue(any('/admission/max'in x for x in result['failures']));self.assertTrue(any('/additional/max'in x for x in result['failures']))
class SmokeState(unittest.TestCase):
 healthy=ControllerState.healthy
 invoke=ControllerState.invoke
 context=ControllerState.context
 def test_smoke_lock_is_not_mistaken_for_existing_results(self):
  with tempfile.TemporaryDirectory()as d:
   root,out,argv=self.context(d);argv[argv.index('--run')]='--smoke'
   with self.assertRaises(SystemExit)as e:self.invoke(root,argv,[self.healthy(),self.healthy()],lambda *args:(1,'synthetic smoke failure'))
   self.assertEqual(e.exception.code,1);state=json.loads((out/'smoke.state.json').read_text());self.assertFalse(state['qualification'])

if __name__=='__main__':unittest.main()
