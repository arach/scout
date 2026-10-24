"""macOS whole-phase envelope and durable result helpers. No execution on import."""
import hashlib,json,os,pathlib,re,shutil,subprocess,time
P=pathlib.Path
def sha(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for b in iter(lambda:f.read(1024*1024),b""): h.update(b)
 return h.hexdigest()
def write(path,value):
 path=P(path); data=(json.dumps(value,indent=2,allow_nan=False)+"\n").encode(); temp=path.with_name(path.name+".writing")
 with open(temp,"wb") as f: f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(temp,path);fd=os.open(path.parent,os.O_RDONLY)
 try: os.fsync(fd)
 finally: os.close(fd)
def command(argv,cwd=None):
 p=subprocess.run(argv,cwd=cwd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
 return {"argv":argv,"returncode":p.returncode,"stdout":p.stdout,"stderr":p.stderr}
def checked(argv,cwd=None):
 r=command(argv,cwd)
 if r["returncode"]: raise RuntimeError("command failed: "+repr(r))
 return r["stdout"].strip()
def parse_swap(text):
 values={k:float(v)*{"K":1024,"M":1024**2,"G":1024**3,"T":1024**4}[u] for k,v,u in re.findall(r"(total|used|free)\s*=\s*([\d.]+)([KMGT])",text)}
 if set(values)!={"total","used","free"}: raise ValueError("unknown swap format")
 return values # total=0 is valid, never divide by dynamically allocated total.
def parse_vm(text):
 out={k:int(v) for k,v in re.findall(r"^(Swapins|Swapouts):\s+(\d+)\.",text,re.M)}
 if set(out)!={"Swapins","Swapouts"}: raise ValueError("missing system swap counters")
 return out
def thermal_nominal(text):
 # Exact unprivileged pmset probes named in the host ruling. Unknown fails closed.
 for key in ["Thermal_Level","Performance_Level"]:
  found=re.findall(key+r"\s*[=:]\s*(\d+)",text,re.I)
  if any(int(n)!=0 for n in found): return False
 for key in ["CPU_Scheduler_Limit","CPU_Speed_Limit"]:
  if any(int(n)!=100 for n in re.findall(key+r"\s*[=:]\s*(\d+)",text,re.I)): return False
 return ("No thermal warning level has been recorded" in text and "No performance warning level has been recorded" in text)
def parse_host(raw,free):
 def out(name):
  if raw[name]["returncode"]: raise ValueError("host probe failed: "+name)
  return raw[name]["stdout"].strip()
 loads=[float(x) for x in re.findall(r"\d+\.\d+",out("load"))]
 if len(loads)!=3: raise ValueError("unknown load format")
 lpm=re.findall(r"\blowpowermode\s+(\d+)",out("lpm"))
 uid=re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"',out("hardware"))
 if not uid: raise ValueError("missing hardware identity")
 out("processes");out("disk")
 return {"hardwareUUID":uid[1],"model":out("model"),"chip":out("chip"),"ramBytes":int(out("ram")),"logicalCPUs":int(out("cpus")),"architecture":out("architecture"),"osVersion":out("osVersion"),"osBuild":out("osBuild"),"diskFreeBytes":free,"swap":parse_swap(out("swap")),"pressureLevel":int(out("pressure")),"systemSwap":parse_vm(out("vm")),"loads":loads,"thermalNominal":thermal_nominal(out("thermal")),"acPower":"Now drawing from 'AC Power'" in out("power"),"lowPowerModeOff":bool(lpm) and all(n=="0" for n in lpm)}
def snapshot():
 probes={"disk":["df","-h","/System/Volumes/Data"],"load":["sysctl","vm.loadavg"],"swap":["sysctl","vm.swapusage"],"pressure":["sysctl","-n","kern.memorystatus_vm_pressure_level"],"vm":["vm_stat"],"thermal":["pmset","-g","therm"],"power":["pmset","-g","ps"],"lpm":["pmset","-g"],"processes":["ps","-axo","pid,ppid,%cpu,rss,etime,comm"],"model":["sysctl","-n","hw.model"],"chip":["sysctl","-n","machdep.cpu.brand_string"],"ram":["sysctl","-n","hw.memsize"],"cpus":["sysctl","-n","hw.logicalcpu"],"architecture":["uname","-m"],"osVersion":["sw_vers","-productVersion"],"osBuild":["sw_vers","-buildVersion"],"hardware":["ioreg","-rd1","-c","IOPlatformExpertDevice"]}
 raw={};result={"startedAt":time.time(),"raw":raw}
 for name,argv in probes.items():
  try:raw[name]=command(argv)
  except Exception as e:raw[name]={"argv":argv,"returncode":-1,"stdout":"","stderr":repr(e)}
 try:result["parsed"]=parse_host(raw,shutil.disk_usage("/System/Volumes/Data").free)
 except Exception as e:result["parseError"]=repr(e)
 result["finishedAt"]=time.time();return result
def envelope_errors(s,m):
 if "parsed" not in s:return ["host probe/parse failure"]
 a=s["parsed"];e=m["envelope"];errors=[]
 for k,v in m["host"]["expected"].items():
  if a.get(k)!=v:errors.append("host identity mismatch: "+k)
 if a["diskFreeBytes"]<e["minimumDiskFreeGiB"]*1024**3:errors.append("disk below floor")
 if a["loads"][0]>a["logicalCPUs"]*e["maximumLoad1PerLogicalCPU"]:errors.append("one-minute load")
 if a["loads"][1]>a["logicalCPUs"]*e["maximumLoad5PerLogicalCPU"]:errors.append("five-minute load")
 for k in ["thermalNominal","acPower","lowPowerModeOff"]:
  if not a[k]:errors.append(k)
 memory=e.get("memory")
 if not memory: errors.append("memory policy awaits ruling")
 elif memory.get("kind")=="absolute-swap-pressure-delta-v1":
  if a["swap"]["used"]>memory["maximumSwapUsedGiB"]*1024**3:errors.append("swap used cap")
  if a["pressureLevel"]!=memory["requiredPressureLevel"]:errors.append("memory pressure")
 else:errors.append("unsupported memory policy; ruling/implementation required")
 return errors
def phase_errors(before,after,m):
 errors=["before: "+x for x in envelope_errors(before,m)]+["after: "+x for x in envelope_errors(after,m)]
 if "parsed" in before and "parsed" in after:
  a,b=before["parsed"],after["parsed"]
  if a["hardwareUUID"]!=b["hardwareUUID"]:errors.append("hardware changed")
  memory=m["envelope"].get("memory") or {}
  if memory.get("kind")=="absolute-swap-pressure-delta-v1":
   for k in ["Swapins","Swapouts"]:
    delta=b["systemSwap"][k]-a["systemSwap"][k]
    if delta<0 or delta>memory["maximumSystemSwapDeltaPages"]:errors.append("system "+k+" delta "+str(delta))
 return errors
def classification(errors,exitcode,problem):return "invalid"if errors else "failure"if exitcode or problem else "pass"
