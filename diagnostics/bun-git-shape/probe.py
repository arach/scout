"""One bounded owned child; portable macOS/Linux parent, no test-child imports."""
import datetime,hashlib,json,os,pathlib,re,resource,selectors,shutil,signal,subprocess,sys,tempfile,time
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
r=pathlib.Path(__file__).resolve().parent
label,bun,script,*extra=sys.argv[1:]; out=r/label;out.mkdir(exist_ok=True)
def guard():
 volume='/System/Volumes/Data' if sys.platform=='darwin' else str(r)
 if sys.platform=='darwin':
  raw=subprocess.check_output(['memory_pressure','-Q'],text=True);free=int(re.search(r'free percentage:\s*(\d+)%',raw)[1])
 else:
  m=dict(re.findall(r'^(\w+):\s*(\d+)',pathlib.Path('/proc/meminfo').read_text(),re.M));free=100*int(m['MemAvailable'])//int(m['MemTotal'])
 result={'freeMemoryPercent':free,'freeDiskBytes':shutil.disk_usage(volume).free,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 if free<20 or result['freeDiskBytes']<3*1024**3:raise RuntimeError('resource guard '+json.dumps(result))
 return result
samples=[guard()];env={k:v for k,v in os.environ.items() if not k.startswith(('BUN_JSC_','OPENSCOUT_','SCOUT_'))}
env['BUN_JSC_slowPathAllocsBetweenGCs']='3'
with tempfile.TemporaryDirectory(prefix='bun-git-shape-') as fixture:
 subprocess.run(['git','init','--quiet',fixture],check=True)
 subprocess.run(['git','-C',fixture,'-c','user.name=Probe','-c','user.email=probe@example.invalid','commit','--allow-empty','--quiet','-m','fixture'],check=True)
 cmd=[bun,script,fixture,*extra];start=time.monotonic();child=subprocess.Popen(cmd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 sel=selectors.DefaultSelector();sel.register(child.stderr,selectors.EVENT_READ,'stderr');stdout_registered=False; stdout_release_at=None
 stdout_hash=hashlib.sha256();stdout_size=0;stderr=bytearray();states=[];proc=[];last_os=0;last_guard=start;outer=False;censor=None
 while sel.get_map() or not stdout_registered:
  now=time.monotonic()
  if not stdout_registered and ((stdout_release_at is not None and now>=stdout_release_at) or now-start>=5):sel.register(child.stdout,selectors.EVENT_READ,'stdout');stdout_registered=True
  if now-start>10 and not outer:outer=True;os.killpg(child.pid,signal.SIGKILL)
  if now-last_guard>=2:
   last_guard=now
   try:samples.append(guard())
   except Exception as error:
    censor=str(error)
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
  if now-last_os>.25:
   last_os=now
   if sys.platform=='darwin':
    rows=subprocess.run(['ps','-axo','pid=,ppid=,state=,time=,comm='],capture_output=True,text=True).stdout.splitlines()
    kept=[]
    for line in rows:
     bits=line.split(None,4)
     if len(bits)==5 and (bits[0]==str(child.pid) or bits[1]==str(child.pid)):
      kept.append({'pid':int(bits[0]),'ppid':int(bits[1]),'state':bits[2],'cpu':bits[3],'exe':os.path.basename(bits[4])})
    states.append({'elapsedMs':int((now-start)*1000),'processes':kept})
   else:
    try:
     pids=[child.pid];pids += [int(x) for x in pathlib.Path(f'/proc/{child.pid}/task/{child.pid}/children').read_text().split()]
     records=[]
     for pid in pids:
      p=pathlib.Path(f'/proc/{pid}');fds=[]
      try:
       for fd in (p/'fd').iterdir():
        try:
         target=os.readlink(fd)
         if target.startswith(('pipe:','socket:','anon_inode:')):
          info=(p/'fdinfo'/fd.name).read_text();fds.append({'fd':int(fd.name),'target':target,'info':info})
        except OSError:pass
      except OSError:pass
      def read(name):
       try:return (p/name).read_text()
       except OSError:return None
      records.append({'pid':pid,'stat':read('stat'),'syscall':read('syscall'),'fdCount':len(list((p/'fd').iterdir())) if (p/'fd').exists() else None,'specialFds':fds})
     proc.append({'elapsedMs':int((now-start)*1000),'processes':records})
    except OSError:pass
  for key,_ in sel.select(.05):
   b=os.read(key.fileobj.fileno(),65536)
   if not b:sel.unregister(key.fileobj);key.fileobj.close()
   elif key.data=='stdout':stdout_hash.update(b);stdout_size+=len(b)
   else:
    stderr.extend(b)
    if stdout_release_at is None and b'"phase":"before-git"' in stderr:stdout_release_at=time.monotonic()+.25
 code=child.wait()
 result={'label':label,'command':cmd,'scriptSha256':hashlib.sha256(pathlib.Path(script).read_bytes()).hexdigest(),'revision':subprocess.check_output([bun,'--revision'],text=True).strip(),'returncode':code,'outerTimeout':outer,'resourceCensor':censor,'resources':samples,'elapsedMs':int((time.monotonic()-start)*1000),'stdoutBytes':stdout_size,'stdoutSha256':stdout_hash.hexdigest(),'stderr':stderr.decode(errors='replace')}
 (out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');(out/'os.json').write_text(json.dumps(states or proc,indent=2)+'\n');(out/'stderr.log').write_bytes(stderr)
 print(json.dumps(result),flush=True)
