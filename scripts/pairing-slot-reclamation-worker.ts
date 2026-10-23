/** Test-only filesystem boundaries, never a production loader or fault knob. */
import fs from "node:fs";
import {join,basename} from "node:path";
import {tmpdir} from "node:os";
import {mock} from "bun:test";
const [root,coordination,detail="{}"]=process.argv.slice(2);
if(!root || !coordination || !fs.realpathSync(root).startsWith(fs.realpathSync(tmpdir())+"/") || !basename(root).startsWith("pairing-capsule-"))throw Error("temporary fixture required");
const options=JSON.parse(detail),original={...fs},paths=new Map<number,string>();
const trace=(event:object)=>original.appendFileSync(join(coordination,"trace.jsonl"),JSON.stringify(event)+"\n");
function boundary(point:string){
  if(options.point!==point)return;
  trace({event:"boundary",point});
  if(!options.pause)process.exit(81);
  original.writeFileSync(join(coordination,`ready-${options.id}`),"ready");
  const deadline=Date.now()+30000;
  while(!original.existsSync(join(coordination,"go"))){
    if(Date.now()>deadline)throw Error("test coordination timeout, never ownership authority");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
  }
}
fs.openSync=((path:any,...args:any[])=>{const fd=(original.openSync as any)(path,...args);paths.set(fd,String(path));return fd;}) as any;
fs.mkdirSync=((path:any,...args:any[])=>{const result=(original.mkdirSync as any)(path,...args);trace({event:"mkdir",path:String(path)});if(String(path).includes("/.pairing-claim-"))boundary("after-candidate-mkdir");return result;}) as any;
fs.fsyncSync=((fd:number)=>{original.fsyncSync(fd);const path=paths.get(fd),directory=original.fstatSync(fd).isDirectory();trace({event:"sync",path,directory});
  if(path?.includes("/.pairing-claim-") && directory)boundary("after-candidate-sync");
  else if(path?.includes("/.pairing-claim-") && path.endsWith(".json"))boundary("after-candidate-token");
}) as any;
fs.renameSync=((source:any,target:any)=>{
  const from=String(source),to=String(target),claim=from.includes("/.pairing-claim-") && /\.pairing-v2-slot-[0-7]$/.test(to);
  if(claim && (options.index===undefined || to.endsWith(`-${options.index}`)))boundary("before-claim-rename");
  try{original.renameSync(source,target);}catch(error){
    const actualCode=(error as NodeJS.ErrnoException).code;
    if(claim && ["ENOTEMPTY","EEXIST"].includes(actualCode??"") && ["ENOTEMPTY","EEXIST"].includes(options.renameErrno)) (error as NodeJS.ErrnoException).code=options.renameErrno;
    trace({event:"rename_failure",source:from,target:to,actualCode,code:(error as NodeJS.ErrnoException).code});throw error;
  }
  for(const [fd,path] of paths)if(path===from || path.startsWith(from+"/"))paths.set(fd,to+path.slice(from.length));
  trace({event:"rename",source:from,target:to,claim});if(claim)boundary("after-claim-rename");
}) as any;
fs.unlinkSync=((path:any)=>{original.unlinkSync(path);trace({event:"unlink",path:String(path)});if(String(path).includes("/.pairing-v2-slot-"))boundary("after-slot-token-unlink");}) as any;
fs.rmdirSync=((path:any)=>{if(String(path).includes("/.pairing-v2-slot-"))boundary("before-slot-rmdir");original.rmdirSync(path);trace({event:"rmdir",path:String(path)});if(String(path).includes("/.pairing-v2-slot-"))boundary("after-slot-rmdir");}) as any;
mock.module("node:fs",()=>({...fs}));
const {pairingTrustOwner}=await import("../packages/runtime/src/pairing-security/trust-owner.ts");
try{
 const owner=pairingTrustOwner(root),internal=owner as any;
 const result=options.mode==="claim"?internal.operation(undefined,(identity:any)=>internal.claimCapsuleSlot(identity)):
   owner.mutate(owner.read().revision,options.id??"slot-write",{type:"revoke",publicKey:options.key??"a".repeat(64)});
 console.log(JSON.stringify({ok:true,result}));
}catch(error){console.log(JSON.stringify({ok:false,error:String(error)}));}
