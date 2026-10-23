/** Isolated qualification worker. Arguments select only test data under a
 * temporary root; the production owner has no such selector or fault hook. */
import fs from "node:fs";
import { join, resolve } from "node:path";
import { mock } from "bun:test";
import { createRequire } from "node:module";

const [mode, root, coordination, detail = ""] = process.argv.slice(2);
if (!mode || !root || !coordination || !resolve(root).includes("pairing-owner-")) throw Error("test root required");
const original = {...fs}, fdPaths = new Map<number, string>();
let syncs = 0, held = false;
const trace = (event: unknown) => original.appendFileSync(join(coordination, "trace.jsonl"), JSON.stringify(event) + "\n");
const pause = (name: string) => {
  original.writeFileSync(join(coordination, name), "ready");
  const end = Date.now() + 10_000;
  while (!original.existsSync(join(coordination, "go"))) {
    if (Date.now() > end) throw Error("test coordination timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
};
if (mode === "instrument" || mode === "managed-paths") {
  fs.openSync = ((path: any, ...args: any[]) => { const fd = (original.openSync as any)(path, ...args); fdPaths.set(fd, String(path)); return fd; }) as any;
  fs.fsyncSync = ((fd: number) => {
    syncs++; trace({event: "sync", number: syncs, path: fdPaths.get(fd)});
    if (detail === "advisory-sync-fail" && fdPaths.get(fd)?.includes(".pairing-last-seen-")) throw Object.assign(Error("injected advisory sync failure"), {code:"EIO"});
    if (detail === `sync-${syncs}`) throw Object.assign(Error("injected sync failure"), {code: "EIO"});
    original.fsyncSync(fd); trace({event: "sync_success", number: syncs, directory: original.fstatSync(fd).isDirectory()});
  }) as any;
  fs.linkSync = ((source: any, target: any) => {
    original.linkSync(source, target); trace({event: "link", target: String(target), held});
    if (detail === "after-cas" && String(target).includes("trusted-peers.owner.")) process.exit(73);
  }) as any;
  fs.renameSync = ((source: any, target: any) => {
    if (detail === "before-projection" && String(target).endsWith("trusted-peers.json")) pause("ready-before-projection");
    if (detail === "rename-fail") throw Object.assign(Error("injected rename failure"),{code:"EIO"});
    original.renameSync(source, target); trace({event: "rename", target: String(target), held});
    if (detail === "after-rename") process.exit(74);
  }) as any;
  mock.module("node:fs", () => ({...fs}));
}
const {pairingTrustOwner} = await import("../packages/runtime/src/pairing-security/trust-owner.ts");
const key = "a".repeat(64), peer = {publicKey: key, pairedAt: "2026-01-01T00:00:00Z"};
try {
  const owner = pairingTrustOwner(root);
  if (mode === "race") {
    const snapshot = owner.read(); pause(`ready-${detail}`);
    const result = owner.mutate(snapshot.revision, `race-${detail}`, {type: "grant", peer: {...peer, publicKey: detail.repeat(64)}});
    console.log(JSON.stringify({ok: true, result}));
  } else if (mode === "reconnect") {
    const {refreshTrustedPeer, loadTrustedPeers} = await import("../packages/runtime/src/pairing-security/identity.ts");
    if (!loadTrustedPeers().has(key)) throw Error("seed missing"); pause("ready-reconnect");
    refreshTrustedPeer(key, "later"); console.log(JSON.stringify({ok: true}));
  } else if (mode === "instrument") {
    const result = owner.mutate(0, "instrument", {type: "grant", peer});
    console.log(JSON.stringify({ok: true, result, syncs}));
  } else if (mode === "managed-paths" || mode === "routes") {
    const web = await import("../packages/web/server/pairing.ts");
    if (mode === "managed-paths") {
      let holder: object | null = null;
      const remove = owner.register({id:"test.adapter", withGate(_r,body) {holder={};held=true;try{return body(holder);}finally{held=false;holder=null;}},currentHolder(){return holder;}});
      owner.withInvocation(c=>owner.mutate(0,"adopt",{type:"manage"},c));
      if (detail === "advisory-rename-fail") original.mkdirSync(join(root,"trusted-peers.last-seen.json"),{mode:0o700});
      const runtime = await import("../packages/runtime/src/pairing-security/index.ts");
      const desktop = await import("../apps/desktop/src/core/pairing/runtime/security/index.ts");
      function exchange(Transport: typeof runtime.SecureTransport, identity: ReturnType<typeof runtime.generateKeyPair>, phone: ReturnType<typeof runtime.generateKeyPair>, trustOnComplete: boolean) {
        const queue: Array<["server"|"client",string]> = [], errors: Error[] = [];
        const server = new Transport({send:data=>queue.push(["client",data])},"responder",identity,{onError:error=>errors.push(error)},{trustOnComplete});
        const client = new runtime.SecureTransport({send:data=>queue.push(["server",data])},"initiator",phone,{onError:error=>errors.push(error)},{skipTrustWrite:()=>true});
        while (queue.length) { const [to,data]=queue.shift()!; (to === "server" ? server : client).receive(data); }
        if (errors.length || !server.isReady() || !client.isReady()) throw Error("real handshake did not complete: "+errors.map(String));
      }
      const identity=runtime.generateKeyPair(), first=runtime.generateKeyPair(), second=runtime.generateKeyPair();
      exchange(runtime.SecureTransport,identity,first,true);
      const beforeRuntime = owner.read().revision;
      for (let i=0;i<100;i++) exchange(runtime.SecureTransport,identity,first,false);
      const runtimeGrowth = owner.read().revision-beforeRuntime;
      exchange(desktop.SecureTransport,identity,second,true);
      const beforeDesktop = owner.read().revision;
      for (let i=0;i<100;i++) exchange(desktop.SecureTransport,identity,second,false);
      const reconnectGenerations = runtimeGrowth+owner.read().revision-beforeDesktop;
      const removed=web.removeScoutPairingTrustedPeer(runtime.bytesToHex(first.publicKey));
      console.log(JSON.stringify({ok:true,removed,revision:owner.read().revision,peers:owner.read().peers.length,reconnectGenerations})); remove();
    } else {
      const collision=key.slice(0,16)+"b".repeat(48);
      owner.mutate(0,"a",{type:"grant",peer}); owner.mutate(1,"b",{type:"grant",peer:{...peer,publicKey:collision}});
      const {Hono}=createRequire(new URL("../packages/web/package.json",import.meta.url))("hono");
      const {mountPairingRoutes}=await import("../packages/web/server/routes/pairing.ts");
      const app=new Hono(); mountPairingRoutes(app,{options:{},currentDirectory:root,pendingPairRequests:null as any,shellStateCache:null as any});
      const ambiguous=await app.request("http://localhost/api/pairing/peers/"+key.slice(0,16),{method:"DELETE"});
      const full=await app.request("http://localhost/api/pairing/peers/"+key,{method:"DELETE"});
      const missing=await app.request("http://localhost/api/pairing/peers/"+key,{method:"DELETE"});
      let holder: object | null=null;
      const remove=owner.register({id:"test.adapter",withGate(_r,body){holder={};try{return body(holder);}finally{holder=null;}},currentHolder(){return holder;}});
      owner.withInvocation(c=>owner.mutate(3,"adopt",{type:"manage"},c)); remove();
      const unavailable=await app.request("http://localhost/api/pairing/peers/"+collision,{method:"DELETE"});
      console.log(JSON.stringify({ok:true,statuses:[ambiguous.status,full.status,missing.status,unavailable.status]}));
    }
  } else if (mode === "read" || mode === "env") {
    console.log(JSON.stringify({ok: true, snapshot: owner.read()}));
  } else if (mode === "forged") {
    console.log(JSON.stringify({ok: true, snapshot: owner.read(JSON.parse(detail))}));
  } else if (mode === "binding") {
    const runtime = await import("../packages/runtime/src/pairing-security/identity.ts");
    const desktop = await import("../apps/desktop/src/core/pairing/runtime/security/identity.ts");
    if (runtime.saveTrustedPeer !== desktop.saveTrustedPeer) throw Error("desktop did not delegate");
    runtime.saveTrustedPeer(peer); desktop.saveTrustedPeer({...peer, publicKey: "b".repeat(64)});
    console.log(JSON.stringify({ok: true, keys: [...runtime.loadTrustedPeers().keys()], path: owner.path}));
  } else throw Error("unknown test mode");
} catch (error) { console.log(JSON.stringify({ok: false, error: String(error)})); }
