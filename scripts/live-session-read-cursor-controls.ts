/** Paired forwarding/submission and serialization/refusal controls. No shared
 * broker is contacted and the source checkout is never patched. */
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statfsSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {isBuiltin} from "node:module";
import {createHash} from "node:crypto";
import {namedControlFailed} from "./fixtures/source-control-evidence.ts";
const out=resolve(process.argv[2]!);mkdirSync(out,{recursive:true});
const apiPath="packages/runtime/src/broker-api.ts",brokerPath="packages/web/server/core/broker/service.ts",mobilePath="packages/web/server/core/mobile/service.ts";
const api=readFileSync(apiPath,"utf8");
function edit(source:string,anchor:string,replacement:string){if(source.split(anchor).length!==2)throw Error("unique control anchor required: "+anchor);return source.replace(anchor,replacement);}
function relocate(source:string,path:string){return source.replace(/(from\s*|import\s*)["']([^"']+)["']/g,(all,prefix,spec)=>isBuiltin(spec)||spec.startsWith("bun:")?all:prefix+JSON.stringify(pathToFileURL(Bun.resolveSync(spec,dirname(resolve(path)))).href));}
const cases:any[]=[];
for(const protocol of ["legacy","trpc"]){
  const dispatchPath=`packages/web/server/core/pairing/runtime/bridge/${protocol==="legacy"?"server":"router"}.ts`;
  const source=readFileSync(dispatchPath,"utf8");
  const anchor=protocol==="legacy"?'result: await markScoutMobileConversationRead({\n            conversationId: p.conversationId,\n            lastReadMessageId: p.lastReadMessageId ?? null,\n          }, () => { requireTransportContext(rpcContext); }),':
    'markScoutMobileConversationRead(input, () => { requireTransportContext(ctx); })';
  const replacement=protocol==="legacy"?anchor.replace(', () => { requireTransportContext(rpcContext); }',""):"markScoutMobileConversationRead(input)";
  cases.push({id:`${protocol}-dispatch`,protocol,stage:"discovery",key:protocol==="legacy"?"legacy":"router",path:dispatchPath,source,altered:edit(source,anchor,replacement)});
  for(const [id,key,path,needle,replacement,stage] of [
    ["mobile","mobile",mobilePath,'    broker.baseUrl,\n    beforeEffect,\n  );','    broker.baseUrl,\n  );',"discovery"],
    ["record","broker",brokerPath,'  }, {beforeEffect});','  });',"discovery"],
    ["post","broker",brokerPath,'    beforeEffect: options.beforeEffect,','    // planted missing wire admission',"discovery"],
    ["unix","api",apiPath,'    admitBrokerEffect(options); // Unix-socket submission, after serialization','    // planted Unix submission bypass',"discovery"],
    ["http","api",apiPath,'  admitBrokerEffect(options); // HTTP submission, after serialization/fallback','  // planted HTTP submission bypass',"fallback"],
  ]){const source=readFileSync(path!,"utf8");cases.push({id:`${protocol}-${id}`,protocol,stage,key,path,source,altered:edit(source,needle!,replacement!)});}
}
for(const [id,expected,guard,anchor] of [
  ["http-before-serialization","http admission follows body serialization",'  admitBrokerEffect(options); // HTTP submission, after serialization/fallback','  const init = {'],
  ["unix-before-serialization","unix admission follows body serialization",'    admitBrokerEffect(options); // Unix-socket submission, after serialization','    const body = requestBody(options);'],
])cases.push({id,expected,path:apiPath,source:api,altered:edit(edit(api,guard!,""),anchor!,`    admitBrokerEffect(options);\n${anchor}`)});
cases.push({id:"refusal-misclassified-as-io",expected:"an admission error with an I/O code never becomes a fallback",path:apiPath,source:api,
  altered:edit(api,'  catch (error) { throw new BrokerEffectAdmissionRefusal(error); }','  catch (error) { throw error; }')});
cases.push({id:"asynchronous-admission",expected:"an asynchronous admission cannot authorize a request",path:apiPath,source:api,
  altered:edit(api,'    if (result && typeof (result as {then?: unknown}).then === "function")\n      throw new Error("synchronous broker admission required");','    void result;')});
const results=[];
for(const c of cases){
  const pair:any={id:c.id,protocol:c.protocol??null,path:c.path,hashes:{}};
  for(const kind of ["healthy","bypass"]){
    const disk=statfsSync(process.platform==="darwin"?"/System/Volumes/Data":"/");if(disk.bavail*disk.bsize<3*1024**3)throw Error("3 GiB floor");
    const scratch=mkdtempSync(join(tmpdir(),"pairing-capsule-read-control-"));
    try{
      const home=join(scratch,"home"),store=join(scratch,"pairing-capsule-read-store");mkdirSync(home);mkdirSync(store);
      const raw=kind==="healthy"?c.source:c.altered;pair.hashes[kind]=createHash("sha256").update(raw).digest("hex");
      const subject=join(scratch,"subject.ts");writeFileSync(subject,relocate(raw,c.path));
      let args:string[];
      if(c.protocol){const config=join(scratch,"subjects.json");writeFileSync(config,JSON.stringify({[c.key]:subject}));args=["scripts/live-session-read-cursor-worker.ts",c.protocol,c.stage,config];}
      else{const test=join(scratch,"oracle.test.ts");writeFileSync(test,readFileSync("packages/runtime/src/broker-api-effect.test.ts","utf8").replace('"./broker-api.js"',JSON.stringify(pathToFileURL(subject).href)));args=["test",test,"--test-name-pattern",c.expected];}
      const child=Bun.spawn([process.execPath,...args],{env:{...process.env,HOME:home,OPENSCOUT_PAIRING_HOME:store,OPENSCOUT_BROKER_SOCKET_ONLY:"0"},stdout:"pipe",stderr:"pipe"});
      const timer=setTimeout(()=>child.kill(),60_000);
      const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);clearTimeout(timer);
      const text=stdout+stderr;writeFileSync(join(out,`${c.id}-${kind}.log`),text);
      let caught=false;
      if(c.protocol){const line=text.split("\n").find(line=>line.startsWith("READ_CURSOR_EFFECT "));const seen=line?JSON.parse(line.slice("READ_CURSOR_EFFECT ".length)):null;
        caught=code!==0&&seen&&(seen.lateUDS+seen.latePosts)>0&&text.includes("no resumed read-cursor submission after revoke ACK")&&!/Cannot find (module|package)|SyntaxError|read-cursor pause not reached/.test(text);
      }else caught=code!==0&&namedControlFailed(text,c.expected);
      if(kind==="healthy"?code!==0:!caught)throw Error(`invalid control evidence ${c.id}/${kind}`);
    }finally{rmSync(scratch,{recursive:true,force:true});}
  }
  pair.caught=true;results.push(pair);
}
writeFileSync(join(out,"results.json"),JSON.stringify({bun:Bun.version,pairs:results},null,2));console.log(JSON.stringify(results));
