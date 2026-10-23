/** Process-local interruption probes. No production fault switches. */
import fs from "node:fs";
import {join,basename} from "node:path";
import {tmpdir} from "node:os";
import {mock} from "bun:test";
const [mode,root,coord,detail="{}"]=process.argv.slice(2),options=JSON.parse(detail),original={...fs};
if(!root||!coord||!original.realpathSync(root).startsWith(original.realpathSync(tmpdir())+"/")||!basename(root).startsWith("pairing-capsule-"))throw Error("temporary fixture required");
let syncs=0,moves=0,nativeHolder:object|null=null;const paths=new Map<number,string>();
const trace=(x:object)=>original.appendFileSync(join(coord,"maintenance.jsonl"),JSON.stringify({...x,held:nativeHolder!==null})+"\n");
const crash=(point:string)=>{if(options.point===point){trace({event:"boundary",point});process.exit(83);}};
fs.openSync=((p:any,...args:any[])=>{const fd=(original.openSync as any)(p,...args);paths.set(fd,String(p));return fd;}) as any;
fs.fsyncSync=((fd:number)=>{crash(`before-sync-${syncs+1}`);original.fsyncSync(fd);syncs++;trace({event:"sync",n:syncs,path:paths.get(fd),directory:original.fstatSync(fd).isDirectory()});crash(`sync-${syncs}`);}) as any;
fs.renameSync=((a:any,b:any)=>{const from=String(a),to=String(b);crash(`before-move-${moves+1}`);
 if(options.conflict && to.includes(".pairing-reclamation/op.") && !original.existsSync(to)){
  original.mkdirSync(to,{mode:0o700});original.writeFileSync(join(to,"conflict"),"retain",{mode:0o600});
 }
 try{original.renameSync(a,b);}catch(e){const actual=(e as NodeJS.ErrnoException).code;
  if(options.conflict && ["EEXIST","ENOTEMPTY","EISDIR","ENOTDIR"].includes(actual??"") && options.errno)(e as NodeJS.ErrnoException).code=options.errno;
  trace({event:"rename_failure",actualCode:actual,code:(e as NodeJS.ErrnoException).code});throw e;
 }
 for(const [fd,p] of paths)if(p===from||p.startsWith(from+"/"))paths.set(fd,to+p.slice(from.length));
 moves++;trace({event:"move",n:moves,from,to});crash(`move-${moves}`);
}) as any;
fs.linkSync=((a:any,b:any)=>{if(mode==="strand" && /trusted-peers\.v2\.commit\.[0-9]+\.json$/.test(String(b)))crash("before-publication");
 original.linkSync(a,b);if(mode==="committed" && /trusted-peers\.v2\.commit\.[0-9]+\.json$/.test(String(b)))crash("after-publication");}) as any;
for(const name of ["unlinkSync","rmdirSync","rmSync"] as const){const fn=original[name];(fs as any)[name]=(...args:any[])=>{trace({event:"delete",name,path:String(args[0])});return (fn as any)(...args);};}
mock.module("node:fs",()=>({...fs}));
const {pairingTrustOwner}=await import("../packages/runtime/src/pairing-security/trust-owner.ts");
const owner=pairingTrustOwner(root);
if(options.managedId)owner.register({id:options.managedId,currentHolder:()=>nativeHolder,withGate(_root,body){
 if(nativeHolder)throw Error("fixture gate already held");nativeHolder={};try{return body(nativeHolder);}finally{nativeHolder=null;}
}});
try{
 if(mode==="strand"||mode==="committed")owner.mutate(owner.read().revision,"interrupted-revoke",{type:"revoke",publicKey:options.key});
 else{const result=owner.reclaimCapsuleStaging(options.id??"maintenance",{quiescent:true});trace({event:"complete",syncs,moves});console.log(JSON.stringify({ok:true,result}));}
}catch(e){console.log(JSON.stringify({ok:false,error:String(e)}));}
