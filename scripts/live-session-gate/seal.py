#!/usr/bin/env python3
"""Declare immutable public-safe pins AFTER committing the instrument.
No host connection, fixture, workload, dependency install or timing run."""
import argparse,datetime,json,pathlib,subprocess
from controller import PINS,validate
from host import checked,sha,write
P=pathlib.Path
p=argparse.ArgumentParser();p.add_argument('--clone',type=P,required=True);p.add_argument('--baseline-clone',type=P,required=True);p.add_argument('--output',type=P,required=True);a=p.parse_args()
source=a.clone.resolve();baseline=a.baseline_clone.resolve();m=json.loads((source/'scripts/live-session-gate/manifest.air.policy.json').read_text())
for label,root in [('source',source),('baseline',baseline)]:
 if checked(['git','status','--porcelain'],root):raise ValueError('clean clone required: '+label)
 head=checked(['git','rev-parse','HEAD'],root)
 if label=='baseline' and head!=m['baselineHead']:raise ValueError('wrong baseline')
 if label=='source':
  subprocess.run(['git','merge-base','--is-ancestor',m['productHead'],head],cwd=root,check=True)
  changed=checked(['git','diff','--name-only',m['productHead'],head],root).splitlines()
  if any(not(name.startswith('scripts/live-session-gate/')or name=='docs/live-session-cost-gate.md')for name in changed):raise ValueError('product bytes changed; stop for review')
 m[label+'Head']=head;m[label+'Files']={name:sha(root/name)for name in checked(['git','ls-files'],root).splitlines()if(root/name).is_file()}
m.update(status='declared',gateHead=m['sourceHead'],declaredAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
validate(m)
if a.output.exists():raise ValueError('never overwrite a declaration')
a.output.parent.mkdir(parents=True,exist_ok=True);write(a.output,m);a.output.with_suffix('.sha256').write_text(sha(a.output)+'  '+a.output.name+'\n');print('Declared',m['gateHead'],'without launching the gate')
