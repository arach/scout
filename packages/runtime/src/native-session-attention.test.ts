import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrCreateCodexAppServerClient, shutdownCodexAppServerLocalAgent } from "@openscout/agent-sessions/local";
import { invokeClaudeStreamJsonAgent, shutdownClaudeStreamJsonAgent } from "./claude-stream-json.js";
import { invokeAcpAgent, shutdownAcpAgentSession } from "./acp-agent-invocation.js";
import { nativeSessionAttention } from "./native-session-attention.js";

const cleanups: (() => Promise<any>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
async function until(f: () => Promise<any>, predicate: (x: any) => boolean) {
  let last; for (let i=0;i<200;i++) { const value = last = await f(); if (predicate(value)) return value; await Bun.sleep(10); }
  throw Error("native observation timeout: " + JSON.stringify(last));
}
async function fixture(kind: "codex" | "claude" | "acp") {
  const home = await mkdtemp(join(tmpdir(), "native-room-attention-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const executable = join(home, "fake-harness"), log = join(home, "wire.jsonl");
  // Real pipes/protocol parser; deterministic peer, no model/credentials/services.
  await writeFile(executable, `#!${process.execPath}
import readline from 'node:readline'; import {appendFileSync} from 'node:fs';
const kind=${JSON.stringify(kind)}, log=${JSON.stringify(log)};
const out=x=>console.log(JSON.stringify(x)); let active=null, i=0;
if(kind==='claude')out({type:'system',subtype:'init',session_id:'native'});
for await(const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line); appendFileSync(log,JSON.stringify(m)+'\\n'); const {id,method,params={}}=m;
 if(kind==='claude'){setTimeout(()=>out({type:'result',result:'handled'}),m.message.content==='seed'?10:250);continue;}
 if(method==='initialize'){out({id,jsonrpc:'2.0',result:{protocolVersion:1,agentCapabilities:{},authMethods:[]}});continue;}
 if(method==='thread/start'||method==='thread/resume'){out({id,result:{thread:{id:'native'}}});continue;}
 if(method==='session/new'){out({id,jsonrpc:'2.0',result:{sessionId:'native'}});continue;}
 if(method==='turn/steer'){out({id,...(params.expectedTurnId!==active?{error:{message:'stale turn'}}:{result:{turnId:active}})});continue;}
 if(method==='turn/start') {active='t'+(++i);const t=active;out({id,result:{turn:{id:t}}});out({method:'turn/started',params:{threadId:'native',turn:{id:t}}});
 setTimeout(()=>{active=null;out({method:'item/completed',params:{turnId:t,item:{id:'i',type:'agentMessage',text:'done'}}});out({method:'turn/completed',params:{threadId:'native',turn:{id:t,status:'completed'}}});},250);continue;}
 if(method==='session/prompt'){setTimeout(()=>{out({jsonrpc:'2.0',method:'session/update',params:{sessionId:'native',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'done'}}}});out({id,jsonrpc:'2.0',result:{stopReason:'end_turn'}});},250);continue;}
 if(id!==undefined)out({id,jsonrpc:'2.0',result:{}});
}
`); await chmod(executable, 0o755);
  const endpoint: any = { id: home, agentId: home, sessionId: "session", metadata: { placement: "background" }, state: "idle",
    transport: kind === "codex" ? "codex_app_server" : kind === "claude" ? "claude_stream_json" : "grok_acp" };
  const options = { agentName: home, sessionId: "session", cwd: home, runtimeDirectory: join(home, "runtime"), logsDirectory: join(home, "logs"), systemPrompt: "isolated" };
  if (kind === "codex") {
    const previous = process.env.OPENSCOUT_CODEX_BIN; process.env.OPENSCOUT_CODEX_BIN = executable;
    cleanups.push(async () => { if (previous === undefined) delete process.env.OPENSCOUT_CODEX_BIN; else process.env.OPENSCOUT_CODEX_BIN = previous; });
    const client = getOrCreateCodexAppServerClient({ ...options, env: { OPENSCOUT_CODEX_BIN: executable }, connection: { mode: "spawn" } });
    cleanups.push(() => shutdownCodexAppServerLocalAgent({ ...options, env: { OPENSCOUT_CODEX_BIN: executable }, connection: { mode: "spawn" } }));
    await client.ensureOnline();
  } else if (kind === "claude") {
    const previous = process.env.OPENSCOUT_CLAUDE_BIN; process.env.OPENSCOUT_CLAUDE_BIN = executable;
    cleanups.push(async () => { if (previous === undefined) delete process.env.OPENSCOUT_CLAUDE_BIN; else process.env.OPENSCOUT_CLAUDE_BIN = previous; });
    cleanups.push(() => shutdownClaudeStreamJsonAgent(options));
    await invokeClaudeStreamJsonAgent({ ...options, prompt: "seed" });
  } else {
    const acp = { adapterType: "grok-acp" as const, label: "fake", sessionId: "session", poolKey: home, cwd: home,
      prompt: "seed", adapterOptions: { command: executable, args: [], requireAuth: false, permissionMode: "reject" } };
    cleanups.push(() => shutdownAcpAgentSession(acp));
    await invokeAcpAgent(acp);
  }
  await until(() => nativeSessionAttention(endpoint), x => x.state === "idle");
  const wire = async () => (await readFile(log, "utf8")).trim().split("\n").map(l => JSON.parse(l));
  return { endpoint, options, wire };
}

for (const kind of ["codex", "claude", "acp"] as const) test(`${kind}: live native turn admission, stale-state refusal, no mid-turn queue injection`, async () => {
  const h = await fixture(kind);
  // Endpoint inventory may expose provider id while owner key lives in explicit runtime metadata.
  const endpoint = { ...h.endpoint, agentId: "durable-card", sessionId: "native", metadata: { ...h.endpoint.metadata, agentName: h.endpoint.agentId, runtimeInstanceId: "session" } };
  h.endpoint = endpoint;
  const initial: any = await nativeSessionAttention(h.endpoint);
  expect(initial.state).toBe("idle");
  expect((await nativeSessionAttention(h.endpoint, { ...initial, action: "revive", prompt: "raced endpoint" }, () => false) as any).accepted).toBe(false);
  const result: any = await nativeSessionAttention(h.endpoint, { ...initial, action: "revive", prompt: "room batch" });
  expect(result.accepted).toBe(true);
  expect((await nativeSessionAttention(h.endpoint) as any).state).toBe("active");
  expect((await nativeSessionAttention(h.endpoint, { ...initial, action: "revive", prompt: "duplicate" }) as any).accepted).toBe(false);
  const active: any = await nativeSessionAttention(h.endpoint);
  const steer: any = await nativeSessionAttention(h.endpoint, { ...active, action: "steer", prompt: "urgent batch" });
  expect(steer.accepted).toBe(kind === "codex");
  await until(() => nativeSessionAttention(h.endpoint), x => x.state === "idle");
  expect((await nativeSessionAttention(h.endpoint, { ...active, action: "steer", prompt: "late steer" }) as any).accepted).toBe(false);
  const wire = await h.wire(); expect(wire.filter(m => JSON.stringify(m).includes("duplicate") || JSON.stringify(m).includes("late steer"))).toHaveLength(0);
  if (kind === "codex") {
    expect(wire.filter(m => m.method === "turn/start")).toHaveLength(1);
    expect(wire.find(m => m.method === "turn/steer").params.expectedTurnId).toBe(active.turnId);
  } else if (kind === "claude") expect(wire.filter(m => m.type === "user")).toHaveLength(2);
  else expect(wire.filter(m => m.method === "session/prompt")).toHaveLength(2);
});

test("unowned, operator-facing, stopped, and missing sessions never launch a transport", async () => {
  const endpoint: any = { id: "nonexistent", agentId: "not-real", sessionId: "none", transport: "codex_app_server", metadata: { placement: "background" }, state: "idle" };
  expect(await nativeSessionAttention(endpoint)).toEqual({ state: "unknown" });
  expect(await nativeSessionAttention({ ...endpoint, state: "stopped" })).toEqual({ state: "gone" });
  expect(await nativeSessionAttention({ ...endpoint, pane: "w1:p1" })).toEqual({ state: "unsupported" });
  expect(await nativeSessionAttention({ ...endpoint, metadata: { placement: "foreground" } })).toEqual({ state: "unsupported" });
  expect((await nativeSessionAttention(endpoint, { sessionId: "none", token: "bad", action: "revive", prompt: "do not spawn" }) as any).accepted).toBe(false);
});
