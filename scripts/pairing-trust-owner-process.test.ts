import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pairingTrustOwner, type PairingTrustAdapter } from "../packages/runtime/src/pairing-security/trust-owner.ts";

const project = fileURLToPath(new URL("..", import.meta.url)), worker = join(project, "scripts/pairing-trust-owner-worker.ts");
const roots: string[] = [], cleanups: Array<() => void> = [];
const key = "a".repeat(64), peer = {publicKey: key, pairedAt: "2026-01-01T00:00:00Z"};
function fixture() { const root = mkdtempSync(join(tmpdir(), "pairing-owner-process-")); roots.push(root); const data = join(root,"data"), coordination = join(root,"coordination"); mkdirSync(data, {mode: 0o700}); mkdirSync(coordination); return {root, data, coordination}; }
function launch(mode: string, data: string, coordination: string, detail = "", extra: Record<string,string> = {}) {
  return Bun.spawn([process.execPath, "--no-install", worker, mode, data, coordination, detail], {
    cwd: project, env: {...process.env, HOME: dirname(data), OPENSCOUT_HOME: join(dirname(data),"home"), OPENSCOUT_CONTROL_HOME: join(dirname(data),"control"), OPENSCOUT_PAIRING_HOME: data, ...extra}, stdout: "pipe", stderr: "pipe",
  });
}
async function result(child: ReturnType<typeof launch>) {
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return {code, stdout, stderr, value: stdout.trim() ? JSON.parse(stdout.trim().split("\n").at(-1)!) : null};
}
async function ready(path: string) { const end = Date.now()+10_000; while (!existsSync(path)) { if (Date.now()>end) throw Error("ready timeout"); await Bun.sleep(5); } }
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

describe("pairing owner real cross-process and I/O paths", () => {
  test("unmanaged CAS race: one winner, one refusal, no lost update", async () => {
    const {data, coordination} = fixture();
    const a = launch("race",data,coordination,"a"), b = launch("race",data,coordination,"b");
    await Promise.all([ready(join(coordination,"ready-a")), ready(join(coordination,"ready-b"))]); writeFileSync(join(coordination,"go"),"go");
    const values = await Promise.all([result(a), result(b)]);
    expect(values.every(v => v.code === 0)).toBe(true);
    expect(values.filter(v => v.value.ok).length).toBe(1);
    expect(values.find(v => !v.value.ok)?.value.error).toMatch(/revision_conflict|publication_incomplete|external_change_or_incomplete|unsafe_path/);
    expect(pairingTrustOwner(data).read().peers.length).toBe(1);
    expect(readdirSync(data).some(name => name.includes("lock"))).toBe(false);
  });
  test("a helper completes a live writer; a later revoke survives the original writer resuming", async () => {
    const {data,coordination}=fixture(), first=launch("instrument",data,coordination,"before-projection");
    await ready(join(coordination,"ready-before-projection"));
    const owner=pairingTrustOwner(data);
    expect(owner.read()).toEqual({revision:1,peers:[peer]});
    owner.mutate(1,"revoke",{type:"revoke",publicKey:key});
    writeFileSync(join(coordination,"go"),"go"); const output=await result(first);
    expect(output.value).toMatchObject({ok:true,result:{mutationId:"instrument",revision:1}});
    expect(owner.read()).toEqual({revision:2,peers:[]});
    const events=readFileSync(join(coordination,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
    expect(events.filter(e=>e.event === "rename")).toEqual([]);
  });
  test("failed projection rename retains recoverable evidence and reports publication_incomplete", async () => {
    const {data,coordination}=fixture(), output=await result(launch("instrument",data,coordination,"rename-fail"));
    expect(output.value.ok).toBe(false); expect(output.value.error).toContain("publication_incomplete");
    expect(readdirSync(data).filter(n=>n.endsWith(".tmp")).length).toBe(2);
    const owner=pairingTrustOwner(data);
    expect(owner.read()).toEqual({revision:1,peers:[peer]});
    expect(owner.mutate(0,"instrument",{type:"grant",peer}).revision).toBe(1);
  });
  test("crash between link and rename rolls forward on the next operation in both modes", async () => {
    for (const managed of [false,true]) for (const revoking of [false,true]) {
      const {data,coordination}=fixture(), owner=pairingTrustOwner(data);
      if (revoking) owner.mutate(0,"seed",{type:"grant",peer});
      if (managed) {
        let holder:object|null=null;
        const remove=owner.register({id:"test.adapter",withGate(_r,body){holder={};try{return body(holder);}finally{holder=null;}},currentHolder(){return holder;}});
        owner.withInvocation(c=>owner.mutate(revoking?1:0,"adopt",{type:"manage"},c));remove();
      }
      const crashed=await result(launch((managed?"managed-instrument":"instrument")+(revoking?"-revoke":""),data,coordination,"after-cas"));
      expect(crashed.code).toBe(73);
      if (managed) expect(()=>owner.read()).toThrow("managed_adapter_required");
      const completed=await result(launch(managed?"recover-managed":"recover",data,coordination));
      expect(completed.value).toEqual({ok:true,snapshot:{revision:(managed?2:1)+(revoking?1:0),peers:revoking?[]:[peer]}});
      const events=readFileSync(join(coordination,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
      const renames=events.filter(e=>e.event === "rename"); expect(renames.length).toBe(1);
      expect(renames[0].held).toBe(managed);
    }
  });
  test("a read unable to finish in-flight publication reports publication_incomplete", async () => {
    const {data,coordination}=fixture(), first=launch("instrument",data,coordination,"before-projection");
    await ready(join(coordination,"ready-before-projection"));
    const reader=await result(launch("recover",data,coordination,"rename-fail"));
    expect(reader.value.ok).toBe(false); expect(reader.value.error).toContain("publication_incomplete");
    writeFileSync(join(coordination,"go"),"go");expect((await result(first)).value.ok).toBe(true);
  });
  test("delayed reconnect in another process cannot restore a revoked key", async () => {
    const {data, coordination} = fixture(), owner = pairingTrustOwner(data);
    owner.mutate(0,"seed",{type:"grant",peer});
    const reconnect = launch("reconnect",data,coordination); await ready(join(coordination,"ready-reconnect"));
    owner.mutate(1,"revoke",{type:"revoke",publicKey:key}); writeFileSync(join(coordination,"go"),"go");
    const output = await result(reconnect); expect(output.value.ok).toBe(false); expect(output.value.error).toContain("peer_revoked");
    expect(owner.read().peers).toEqual([]);
  });
  test("real barriers reached; crash after publication and ACK-loss retry", async () => {
    for (const point of ["", "after-cas", "after-rename", "sync-1", "sync-2", "sync-3"]) {
      const {data, coordination} = fixture(), output = await result(launch("instrument",data,coordination,point));
      const trace = readFileSync(join(coordination,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
      expect(trace.some(e=>e.event === "sync")).toBe(true);
      console.log(JSON.stringify({instrument:point||"success",trace}));
      const owner = pairingTrustOwner(data);
      if (point === "after-cas") {
        expect(output.code).toBe(73); expect(owner.read()).toEqual({revision:1,peers:[peer]});
      } else if (point === "after-rename" || point === "sync-3") {
        if (point === "after-rename") expect(output.code).toBe(74); else expect(output.value.ok).toBe(false);
        const retried = owner.mutate(0,"instrument",{type:"grant",peer});
        expect(retried.revision).toBe(1); expect(owner.read().revision).toBe(1);
      } else if (point.startsWith("sync")) {
        expect(output.value.ok).toBe(false); expect(owner.read().revision).toBe(0);
        expect(readdirSync(data).some(n=>n.endsWith(".tmp"))).toBe(false);
      } else {
        expect(output.value.ok).toBe(true);
        expect(trace.filter(e=>e.event === "sync").length).toBe(3);
        expect(trace.filter(e=>e.event === "sync_success").length).toBe(3);
        expect(trace.filter(e=>e.event === "sync_success" && e.directory).length).toBe(1);
        expect(trace.filter(e=>e.event === "link").length).toBe(1);
        expect(trace.filter(e=>e.event === "rename").length).toBe(1);
      }
    }
  });
  test("all override spellings select the same owner for runtime and desktop", async () => {
    for (const spelling of ["OPENSCOUT_PAIRING_HOME","SCOUT_PAIRING_HOME","OPENSCOUT_PAIRING_DIR","OPENSCOUT_SCOUT_HOME"]) {
      const fixtureRoot = fixture(), coordination = fixtureRoot.coordination;
      const data = spelling === "OPENSCOUT_SCOUT_HOME" ? join(fixtureRoot.data,"pairing") : fixtureRoot.data;
      const extra: Record<string,string> = {OPENSCOUT_PAIRING_HOME:"",SCOUT_PAIRING_HOME:"",OPENSCOUT_PAIRING_DIR:"",OPENSCOUT_SCOUT_HOME:"",[spelling]:fixtureRoot.data};
      const output = await result(launch("binding",data,coordination,"",extra));
      expect(output.code).toBe(0); expect(output.value).toMatchObject({ok:true, keys:[key,"b".repeat(64)]});
      expect(pairingTrustOwner(data).read().revision).toBe(2);
    }
  });
  test("managed store stays unavailable in another process despite loader-shaped environment/argv/JSON", async () => {
    const {data,coordination} = fixture(), owner = pairingTrustOwner(data);
    let holder: object | null = null;
    const adapter: PairingTrustAdapter = {id:"test.adapter", withGate(_r,body) { holder={}; try {return body(holder);} finally {holder=null;} }, currentHolder(){return holder;}};
    cleanups.push(owner.register(adapter));
    let capture = "";
    owner.withInvocation(context => { capture = JSON.stringify({...context, toJSON:undefined}); owner.mutate(0,"adopt",{type:"manage"},context); });
    const poison = join(coordination,"adapter.ts"); writeFileSync(poison, `throw Error("ENV_ADAPTER_WAS_LOADED");`);
    const output = await result(launch("env",data,coordination,"--pairing-trust-adapter="+poison, {
      OPENSCOUT_PAIRING_TRUST_ADAPTER:poison, OPENSCOUT_PAIRING_TRUST_ADAPTER_MODULE:poison,
      SCOUT_PAIRING_TRUST_ADAPTER:poison, OPENSCOUT_PAIRING_OWNER:JSON.stringify({module:poison,id:"test.adapter"}),
    }));
    expect(output.value.ok).toBe(false); expect(output.value.error).toContain("managed_adapter_required");
    expect(output.stderr).not.toContain("ENV_ADAPTER_WAS_LOADED");
    const forged = await result(launch("forged",data,coordination,capture));
    expect(forged.value.ok).toBe(false); expect(forged.value.error).toContain("invalid_context");
  });
  test("real runtime and retained desktop reconnect storm writes zero generations; authority publications stay gated", async () => {
    const {data,coordination}=fixture(), output=await result(launch("managed-paths",data,coordination));
    expect(output.code,output.stderr).toBe(0); expect(output.value).toEqual({ok:true,removed:true,revision:4,peers:1,reconnectGenerations:0});
    const events=readFileSync(join(coordination,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
    const advisory=events.filter(e=>e.event === "rename" && e.target.endsWith("trusted-peers.last-seen.json"));
    expect(advisory.length).toBe(200); expect(advisory.every(e=>e.held === false)).toBe(true);
    const publications=events.filter(e=>(e.event === "link" || e.event === "rename") && !e.target.endsWith("trusted-peers.last-seen.json"));
    expect(publications.length).toBe(9); expect(publications.every(e=>e.held === true)).toBe(true);
  });
  test("real runtime and desktop handshakes survive advisory sync and rename failures", async () => {
    for (const fault of ["advisory-sync-fail","advisory-rename-fail"]) {
      const {data,coordination}=fixture(), output=await result(launch("managed-paths",data,coordination,fault));
      expect(output.code,output.stderr).toBe(0); expect(output.value).toEqual({ok:true,removed:true,revision:4,peers:1,reconnectGenerations:0});
      const events=readFileSync(join(coordination,"trace.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line));
      expect(events.filter(e=>e.event === "rename" && e.target.endsWith("trusted-peers.last-seen.json"))).toEqual([]);
      expect(readdirSync(data).filter(n=>n.endsWith(".tmp"))).toEqual([]);
    }
  });
  test("actual web DELETE returns ambiguous 409, full-key 200, missing 404 and managed unavailable 503", async () => {
    const {data,coordination}=fixture(), output=await result(launch("routes",data,coordination));
    expect(output.code,output.stderr).toBe(0); expect(output.value).toEqual({ok:true,statuses:[409,200,404,503]});
  });
  test("hardlink and unprotected trust files refuse before serving authority", () => {
    const {data,coordination} = fixture(), source = join(coordination,"source");
    writeFileSync(source,"[]",{mode:0o600}); linkSync(source,join(data,"trusted-peers.json"));
    expect(()=>pairingTrustOwner(data).read()).toThrow("unsafe_path");
    chmodSync(data,0o777); expect(()=>pairingTrustOwner(data)).toThrow("unsafe_path"); chmodSync(data,0o700);
  });
});
