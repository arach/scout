import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createCliFixture, isolatedEnvironment, temporaryDirectory } from "./helpers/cli-fixture.mjs";

const cli = join(createCliFixture(), "bin/scout.mjs");
const home = temporaryDirectory("scout-inspection-home-");
const requests = [];
const now = Date.now();
let nodes;
function state(node) {
  return {
    kind: "mesh-node-state", version: 1, nodeId: node.id, name: node.name, hostName: "mini", meshId: "test", capabilities: [], observedAt: now,
    workload: { total: 1, working: 1, available: 0, offline: 0, truncated: false },
    roster: [{ id: `agent-${node.id}`, title: "Agent", role: null, projectRoot: "/repo", state: "working", statusLabel: "working", lastSeenAt: now }],
    sessions: { total: 0, truncated: false, items: [] },
    work: { total: 1, running: 1, truncated: false, items: [{ id: `work-${node.id}`, targetAgentId: `agent-${node.id}`, state: "running", summary: `Task on ${node.id}`, startedAt: now - 1_000, completedAt: null }] },
  };
}
function serverFor(id) {
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push([id, request.url]);
    let body;
    if (url.pathname === "/health") body = { ok: true, nodeId: id };
    if (url.pathname === "/v1/node") body = nodes[id]; // pre-card broker
    if (url.pathname === "/v1/mesh/nodes") body = nodes;
    if (url.pathname === "/v1/mesh/node-state" && !url.search) body = state(nodes[id]); // old broker: no query params
    if (url.pathname === "/v1/aliases") body = { bindings: [] };
    if (url.pathname === "/v1/snapshot") body = {
      nodes, agents: Object.fromEntries(Object.values(nodes).map(node => [`agent-${node.id}`, { id: `agent-${node.id}`, homeNodeId: node.id, metadata: { projectRoot: "/repo" } }])),
      endpoints: {}, messages: {}, flights: {},
    };
    response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body ?? { error: "unsupported" }));
  });
}
const local = serverFor("mini-local-openscout");
const remote = serverFor("mini-openscout");
local.listen(0, "127.0.0.1"); remote.listen(0, "127.0.0.1");
await Promise.all([once(local, "listening"), once(remote, "listening")]);
const localUrl = `http://127.0.0.1:${local.address().port}`;
nodes = {
  "mini-local-openscout": { id: "mini-local-openscout", name: "mini", hostName: "mini", brokerUrl: localUrl },
  "mini-openscout": { id: "mini-openscout", name: "mini", hostName: "mini", brokerUrl: `http://127.0.0.1:${remote.address().port}` },
};
test.after(() => { local.closeAllConnections(); remote.closeAllConnections(); local.close(); remote.close(); });

async function run(args, tty = false) {
  const child = spawn(tty ? "/usr/bin/script" : "bun", tty ? ["-q", "/dev/null", "bun", cli, ...args] : [cli, ...args], {
    cwd: home, env: isolatedEnvironment({ OPENSCOUT_BROKER_URL: localUrl }), stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const guard = setTimeout(() => child.kill("SIGKILL"), 8_000);
  try {
    const [code, signal] = await once(child, "close");
    return { code, signal, stdout, stderr };
  } finally { clearTimeout(guard); }
}

test("real recent CLI joins work, queries both ambiguous ids on old brokers, and keeps pipes clean", async () => {
  const result = await run(["recent", "--machine", "mini", "--since", "2h", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "", "legacy node-card diagnostics are not routine CLI output");
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.machines.map(machine => machine.nodeId).sort(), Object.keys(nodes).sort());
  for (const machine of report.machines) {
    assert.equal(machine.status, "ok");
    assert.equal(machine.entries.length, 1);
    assert.equal(machine.entries[0].kind, "agent");
    assert.equal(machine.entries[0].workState, "running");
    assert.ok(requests.some(([id, path]) => id === machine.nodeId && path === "/v1/mesh/node-state"));
  }
  const plain = await run(["check", "--machine", "mini", "--since", "2h"]);
  assert.equal(plain.code, 0, plain.stderr);
  for (const id of Object.keys(nodes)) assert.ok(plain.stdout.includes(`mini (${id}):`));
  assert.equal(plain.stdout.match(/Task on /g).length, 2);
  assert.ok(!plain.stdout.includes("caps apply before"));
});

test("real who CLI filters every matching machine while keeping its JSON array shape", async () => {
  const result = await run(["--json", "who", "--machine", "mini", "--context-root", home]);
  assert.equal(result.code, 0, result.stderr);
  const rows = JSON.parse(result.stdout);
  for (const nodeId of Object.keys(nodes)) assert.ok(rows.some(row => row.nodeId === nodeId && row.projectRoot === "/repo"));
  const plain = await run(["who", "--machine", "mini", "--context-root", home]);
  assert.equal(plain.code, 0, plain.stderr);
  for (const id of Object.keys(nodes)) assert.ok(plain.stdout.includes(`mini (${id}):`));
});

test("unknown machine names fail instead of silently returning an empty success", async () => {
  for (const command of ["who", "recent"]) {
    const result = await run([command, "--machine", "misspelled"]);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.includes('Unknown machine "misspelled"'));
  }
});

test("TTY recent output retains labelled blocks without duplicate work lines", { skip: process.platform !== "darwin" }, async () => {
  const result = await run(["recent", "--machine", "mini"], true);
  assert.equal(result.code, 0, result.stderr);
  for (const id of Object.keys(nodes)) assert.ok(result.stdout.includes(`mini (${id}):`));
  assert.equal(result.stdout.match(/Task on /g).length, 2);
  assert.ok(!result.stdout.includes("presents no signed node card"));
});

test("an unreachable peer is a bounded per-machine failure, not empty activity", async () => {
  const unreachable = createServer(() => {});
  unreachable.listen(0, "127.0.0.1");
  await once(unreachable, "listening");
  nodes.unreachable = { id: "unreachable", name: "offline", brokerUrl: `http://127.0.0.1:${unreachable.address().port}` };
  const started = Date.now();
  try {
    const result = await run(["recent", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    assert.ok(Date.now() - started < 6_000, "card probe and read share one deadline");
    const machines = JSON.parse(result.stdout).machines;
    assert.equal(machines.filter(machine => machine.status === "ok").length, 2);
    assert.deepEqual(machines.find(machine => machine.nodeId === "unreachable"), {
      nodeId: "unreachable", nodeName: "offline", local: false, status: "unavailable", error: "no answer in 3s",
    });
  } finally {
    delete nodes.unreachable;
    unreachable.closeAllConnections(); unreachable.close();
  }
});
