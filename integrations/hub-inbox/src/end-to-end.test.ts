/**
 * The whole path with real parts: the reporter runs under Node as a Claude Code
 * hook would run it, posts to this Worker (served locally over an in-memory
 * bucket), and the runtime's collector turns the chunks back into a mirror
 * transcript identical to the source.
 */
import { afterEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  connectClaudeCode,
  HubCollectorService,
  loadOrCreateHubIdentity,
  saveHubConfig,
  sealHubChunk, readHubStatus,
} from "../../../packages/runtime/src/hub/index.ts";
import { activityPage } from "../../../packages/runtime/src/hub/activity.ts";
import { probeInbox } from "../../../packages/runtime/src/hub/round-trip.ts";
import { serveLocalInbox } from "./serve-local.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const step of cleanup.splice(0)) step(); });

test("a cloud transcript arrives in the mirror byte for byte", async () => {
  const work = mkdtempSync(join(tmpdir(), "scout-hub-e2e-"));
  const inbox = serveLocalInbox({ readToken: "shr_e2e", writeToken: "shw_e2e" });
  cleanup.push(() => { inbox.server.stop(true); rmSync(work, { recursive: true, force: true }); });

  // The runtime side: key pair and config.
  const hubHome = join(work, "hub");
  const mirrorRoot = join(hubHome, "claude", "projects");
  const config = { v: 1 as const, inbox: inbox.url, readToken: "shr_e2e", writeToken: "shw_e2e", createdAt: "" };
  saveHubConfig(config, hubHome);
  const identity = loadOrCreateHubIdentity(hubHome);

  // The repo, connected.
  const repo = join(work, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  connectClaudeCode({ repoRoot: repo, config, recipientPublicKey: identity.publicKey, label: "hub-spike" });

  // The sandbox's transcript, with an image and a subagent.
  const session = "4f1d2c3b-aaaa-4bbb-8ccc-0123456789ab";
  const projectDir = join(work, "root", ".claude", "projects", "-home-user-repo");
  mkdirSync(join(projectDir, session, "subagents"), { recursive: true });
  const transcript = join(projectDir, `${session}.jsonl`);
  const subagent = join(projectDir, session, "subagents", "agent-a1b2c3.jsonl");
  const image = Buffer.alloc(200_000, 7).toString("base64");
  writeFileSync(transcript, [
    JSON.stringify({ type: "user", sessionId: session, cwd: "/home/user/repo", message: { content: [{ type: "text", text: "look" }] } }),
    JSON.stringify({ type: "user", sessionId: session, message: { content: [{ type: "tool_result", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image } }] }] } }),
    "",
  ].join("\n"));
  writeFileSync(subagent, `${JSON.stringify({ type: "assistant", sessionId: session, isSidechain: true })}\n`);

  // Async, so this process's inbox can answer while the reporter runs.
  const runReporter = async (args: string[], env: Record<string, string>, input: object) => {
    const child = Bun.spawn(["node", join(repo, ".claude", "scout", "report.mjs"), ...args], {
      stdin: new TextEncoder().encode(JSON.stringify(input)),
      stdout: "pipe",
      env: { PATH: process.env.PATH!, SCOUT_HUB_STATE_DIR: join(work, "state"), ...env },
    });
    expect(await child.exited).toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
  };
  const hook = (args: string[]) => runReporter(args, { CLAUDE_CODE_REMOTE: "true", CLAUDE_CODE_REMOTE_SESSION_ID: "cse_e2e" },
    { session_id: session, transcript_path: transcript, cwd: "/home/user/repo", hook_event_name: "Stop" });

  await hook(["flush", "--wait"]);
  // A line still being written is held back until it ends.
  appendFileSync(transcript, '{"type":"assistant","sessionId":"' + session + '"}\n{"type":"partial');
  await hook(["flush", "--wait"]);

  const collector = new HubCollectorService({ home: hubHome, mirrorRoot });
  const first = await collector.collectOnce();
  expect(first).toMatchObject({ configured: true, rejected: 0, waiting: 0 });
  expect(first.appended).toBeGreaterThanOrEqual(3);
  expect(inbox.bucket.objects.size).toBe(0);

  const mirrored = join(mirrorRoot, "hub-spike", `${session}.jsonl`);
  const source = readFileSync(transcript, "utf8");
  expect(readFileSync(mirrored, "utf8")).toBe(source.slice(0, source.lastIndexOf("\n") + 1));
  expect(readFileSync(join(mirrorRoot, "hub-spike", session, "subagents", "agent-a1b2c3.jsonl"), "utf8")).toBe(readFileSync(subagent, "utf8"));
  expect(readFileSync(mirrored, "utf8")).toContain(image);

  // The line finishes; the detached flush (what PostToolUse runs) delivers it.
  appendFileSync(transcript, '"}\n');
  await hook(["flush"]);
  const deadline = Date.now() + 10_000;
  while (inbox.bucket.objects.size === 0 && Date.now() < deadline) await Bun.sleep(100);
  await collector.collectOnce();
  expect(readFileSync(mirrored, "utf8")).toBe(readFileSync(transcript, "utf8"));

  // Nothing is sent from a local (non-cloud) session.
  const before = inbox.bucket.objects.size;
  appendFileSync(transcript, '{"type":"user"}\n');
  await runReporter(["flush", "--wait"], {}, { session_id: session, transcript_path: transcript });
  expect(inbox.bucket.objects.size).toBe(before);
}, 30_000);

test("collect reports the first waiting offset per file until the gap fills", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-hub-gap-"));
  const inbox = serveLocalInbox({ readToken: "shr_e2e", writeToken: "shw_e2e" });
  cleanup.push(() => { inbox.server.stop(true); rmSync(home, { recursive: true, force: true }); });
  const mirrorRoot = join(home, "mirror");
  saveHubConfig({ v: 1, inbox: inbox.url, readToken: "shr_e2e", writeToken: "shw_e2e", createdAt: "" }, home);
  const identity = loadOrCreateHubIdentity(home);
  const label = "cloud-project";
  const sessionId = "gap-session";
  const file = `${sessionId}.jsonl`;
  const send = async (offset: number) => {
    const body = sealHubChunk({
      v: 1, kind: "claude-code.transcript", label, sessionId, file, offset, seq: offset,
      remoteSessionId: "cse_gap", cwd: "/home/user/repo", sentAt: new Date().toISOString(),
    }, Buffer.from("{}\n"), identity.publicKey);
    const response = await fetch(`${inbox.url}/v1/inbox/chunks`, {
      method: "POST", headers: { authorization: "Bearer shw_e2e" }, body,
    });
    expect(response.status).toBe(201);
  };
  await send(0);
  await send(6);
  await send(9);
  for (const obj of inbox.bucket.objects.values()) obj.uploaded = new Date(Date.now() - 3_600_001);
  const collector = new HubCollectorService({ home, mirrorRoot });
  const first = await collector.collectOnce();
  expect(first.waiting).toBe(2);
  expect(first.waitingFiles).toMatchObject([{ label, sessionId, file, mirroredBytes: 3, waitingOffset: 6 }]);
  expect(Number.isFinite(Date.parse(first.waitingFiles[0]!.waitingSince))).toBe(true);
  expect(JSON.parse(readFileSync(join(home, "status.json"), "utf8")).waitingFiles).toEqual(first.waitingFiles);
  expect(inbox.bucket.objects.size).toBe(2);
  expect(readHubStatus(home).issues).toMatchObject([{ id: `gap:${label}/${file}` }]);
  expect((await collector.collectOnce()).waitingFiles).toEqual(first.waitingFiles);

  await send(3);
  expect(await collector.collectOnce()).toMatchObject({ appended: 3, waiting: 0, waitingFiles: [] });
  expect(inbox.bucket.objects.size).toBe(0);
  expect(readFileSync(join(mirrorRoot, label, file), "utf8")).toBe("{}\n".repeat(4));
});

test("a Managed Agents webhook reaches the runtime as a note, and only once", async () => {
  const { Webhook } = await import("standardwebhooks");
  const work = mkdtempSync(join(tmpdir(), "scout-hub-e2e-"));
  const secret = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;
  const inbox = serveLocalInbox({ readToken: "shr_e2e", writeToken: "shw_e2e", webhookSigningKey: secret });
  cleanup.push(() => { inbox.server.stop(true); rmSync(work, { recursive: true, force: true }); });
  const hubHome = join(work, "hub");
  saveHubConfig({ v: 1, inbox: inbox.url, readToken: "shr_e2e", writeToken: "shw_e2e", createdAt: "" }, hubHome);
  loadOrCreateHubIdentity(hubHome);

  const body = JSON.stringify({ type: "event", id: "whe_e2e1", created_at: new Date().toISOString(), data: { type: "session.status_idled", id: "sesn_e2e" } });
  const now = new Date();
  const posted = await fetch(`${inbox.url}/v1/inbox/webhooks/anthropic`, {
    method: "POST",
    headers: { "webhook-id": "whe_e2e1", "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": new Webhook(secret).sign("whe_e2e1", now, body) },
    body,
  });
  expect(posted.status).toBe(204);

  // A runtime that does not act on notes leaves them for one that does.
  const passive = await new HubCollectorService({ home: hubHome, mirrorRoot: join(hubHome, "claude", "projects") }).collectOnce();
  expect(passive).toMatchObject({ configured: true, nudges: 0 });
  expect(inbox.bucket.objects.size).toBe(1);

  const seen: string[] = [];
  const collector = new HubCollectorService({
    home: hubHome, mirrorRoot: join(hubHome, "claude", "projects"),
    onNudges: (nudges) => seen.push(...nudges.map((nudge) => `${nudge.type} ${nudge.resourceId}`)),
  });
  expect(await collector.collectOnce()).toMatchObject({ nudges: 1 });
  expect(seen).toEqual(["session.status_idled sesn_e2e"]);
  expect(activityPage(null, 50, hubHome).items).toContainEqual(expect.objectContaining({ kind: "webhook", summary: seen[0] }));
  expect(inbox.bucket.objects.size).toBe(0);
  expect(await collector.collectOnce()).toMatchObject({ nudges: 0 });
});

test("the probe proves its own chunk, leaves other mail alone and never creates a mirror", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-hub-probe-"));
  const inbox = serveLocalInbox({ readToken: "reader", writeToken: "writer" });
  cleanup.push(() => { inbox.server.stop(true); rmSync(home, { recursive: true, force: true }); });
  const config = { v: 1 as const, inbox: inbox.url, readToken: "reader", writeToken: "writer", createdAt: "" };
  saveHubConfig(config, home);
  const identity = loadOrCreateHubIdentity(home);
  const abandoned = sealHubChunk({ v: 1, kind: "scout.test", label: "_scout-test", sessionId: "orphan",
    remoteSessionId: null, file: "orphan.jsonl", offset: 0, seq: 0, cwd: null, sentAt: "" }, Buffer.from("test\n"), identity.publicKey);
  await fetch(inbox.url + "/v1/inbox/chunks", { method: "POST", body: abandoned, headers: { authorization: "Bearer writer" } });
  const probe = await probeInbox(config, identity, true);
  expect(probe).toMatchObject({ ok: true, webhooksEnabled: false });
  expect(probe.steps.map(s => s.name)).toEqual(["post", "list", "fetch", "open", "delete", "webhooks"]);
  expect(inbox.bucket.objects.size).toBe(1);

  await fetch(inbox.url + "/v1/inbox/webhooks/anthropic", { method: "POST" });
  const mirrorRoot = join(home, "mirror");
  const collector = () => new HubCollectorService({ home, mirrorRoot }).collectOnce();
  expect(await collector()).toMatchObject({ fetched: 1, appended: 0, rejected: 0 });
  await collector(); // a new collector does not double-count or log idle work
  expect(activityPage(null, 50, home).items.filter(r => r.kind === "rejection")).toMatchObject([
    { summary: expect.stringContaining("webhooks/anthropic.not_enabled: 1 refused") },
  ]);
  expect(readHubStatus(home).issues).toMatchObject([{ id: "webhooks/anthropic.not_enabled" }]);
  saveHubConfig({ ...config, readToken: "wrong" }, home);
  await collector();
  expect(readHubStatus(home).issues.map(i => i.id)).toContain("inbox_read_token");
  inbox.server.stop(true);
  await collector();
  expect(readHubStatus(home).issues.map(i => i.id)).toContain("inbox_unreachable");
  expect(existsSync(mirrorRoot)).toBe(false);
});
