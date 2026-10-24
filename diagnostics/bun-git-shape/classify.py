"""Conservative signature check; always retain raw receipts for review."""
import json,pathlib,re,sys
r=pathlib.Path(__file__).resolve().parent
old=json.loads((r/'linux-old/receipt.json').read_text());new=json.loads((r/'linux-new/receipt.json').read_text());snapshots=json.loads((r/'linux-old/os.json').read_text())
zombies=[];armed=[];fd_counts=[]
for snapshot in snapshots:
 records=snapshot['processes']
 for p in records:
  stat=p.get('stat') or '';state=stat[stat.rfind(')')+2:].split()[:1]
  if state==['Z']:zombies.append(p['pid'])
 root=records[0] if records else {};fd_counts.append(root.get('fdCount') or 0)
 sockets={fd['fd'] for fd in root.get('specialFds',[]) if fd['target'].startswith('socket:')}
 for epoll in root.get('specialFds',[]):
  if 'eventpoll' not in epoll['target']:continue
  for fd,events in re.findall(r'tfd:\s*(\d+) events:\s*([a-fA-F0-9]+)',epoll['info']):
   mask=int(events,16)
   if int(fd) in sockets and mask & (1<<30) and mask & 1:armed.append({'epollFd':epoll['fd'],'socketFd':int(fd),'events':events})
def events(receipt):
 result=[]
 for line in receipt['stderr'].splitlines():
  try:result.append(json.loads(line))
  except ValueError:pass
 return result
before=[e for e in events(old) if e.get('phase')=='before-git'];after=[e for e in events(new) if e.get('phase')=='after-git']
old_shape=old['outerTimeout'] and old['resourceCensor'] is None and any(e.get('collected')==2 for e in before) and not any(e.get('phase')=='after-git' for e in events(old)) and bool(zombies) and bool(armed)
new_shape=new['returncode']==0 and not new['outerTimeout'] and new['resourceCensor'] is None and bool(after)
result={'oldGitZombieArmedOneshot':bool(old_shape),'newReturned':bool(new_shape),'zombiePids':sorted(set(zombies)),'armedSockets':list({json.dumps(a,sort_keys=True):a for a in armed}.values()),'maximumFdCount':max(fd_counts,default=0),'oldRevision':old['revision'],'newRevision':new['revision'],'sameSubject':old['scriptSha256']==new['scriptSha256']}
print(json.dumps(result));(r/'linux-new/classification.json').write_text(json.dumps(result,indent=2)+'\n')
if not(old_shape and new_shape and result['sameSubject']):sys.exit('Inconclusive or failed diagnostic: inspect preserved evidence; no rerun-to-green.')
