import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MeshFeedback, MESH_REPORT_MAX_BYTES, MESH_REPORT_LOGS } from "./mesh-feedback.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const principal = { kind: "oauth" as const, id: "identity", ownerKey: "owner", node: "node", agentId: "agent" };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "feedback-api-")); dirs.push(dir);
  let uploaded = 0;
  const endpoint = "https://feedback.example/api/feedback";
  const fetcher = (async (url, init) => {
    uploaded++; expect(String(url)).toBe(endpoint); expect(init?.redirect).toBe("error");
    const report = JSON.parse(String(init?.body));
    return Response.json({ success: true, id: report.id });
  }) as typeof fetch;
  const feedback = new MeshFeedback({ supportDirectory: dir, endpoint, health: () => ({ ready: true, advertiseScope: "mesh" }), fetch: fetcher });
  const consent = (list = [principal]) => writeFileSync(join(dir, "mcp-bridge.json"), JSON.stringify({ remoteDiagnostics: list }));
  return { dir, feedback, consent, get uploaded() { return uploaded; }, report(id: string) { return JSON.parse(readFileSync(join(dir, "reports", "mesh", `${id}.json`), "utf8")); } };
}
describe("runtime feedback collection and explicit upload", () => {
  test("remote default and an unconsented diagnostic request persist only a note", async () => {
    const f = fixture();
    for (const diagnostics of [false, true]) {
      const receipt = await f.feedback.collect({ message: "token=private", diagnostics, principal }, true);
      expect(receipt.diagnosticsIncluded).toBe(false);
      const saved = f.report(receipt.id);
      expect(saved.report.logs).toEqual([]); expect(saved.report.context.reportSections).toEqual([]);
      expect(JSON.stringify(saved)).not.toContain("private");
    }
    expect(f.uploaded).toBe(0);
  });
  test("collection is bounded, secret-redacted and allowlisted before persistence", async () => {
    const f = fixture();
    writeFileSync(join(f.dir, "settings.json"), JSON.stringify({ brokerPort: 43110, meshEnabled: true, secret: "private-setting", environment: { apiKey: "private-env" } }));
    mkdirSync(join(f.dir, "logs", "base"), { recursive: true });
    const current = new Date(Date.now() - 1000).toISOString();
    writeFileSync(join(f.dir, "logs", MESH_REPORT_LOGS[0]), `${current} TypeError: token=private-log\n2000-01-01T00:00:00Z TypeError: ancient\nTypeError: no-timestamp\n${current} user message body=private-conversation\n`);
    const receipt = await f.feedback.collect({ message: "failure Bearer abcdef123", diagnostics: true }, false);
    expect(receipt.diagnosticsIncluded).toBe(true); expect(f.uploaded).toBe(0);
    const saved = f.report(receipt.id);
    const text = JSON.stringify(saved);
    expect(text).not.toMatch(/private-setting|private-env|private-log|abcdef123|ancient|no-timestamp|private-conversation/);
    expect(saved.report.logs).toHaveLength(1);
    expect(saved.report.context.reportSections.some((s: { id: string }) => s.id === "health")).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MESH_REPORT_MAX_BYTES);
    await f.feedback.upload({ id: receipt.id }, false); expect(f.uploaded).toBe(1);
  });
  test("consent is per identity and owner, and is rechecked at upload", async () => {
    const f = fixture(); f.consent();
    const receipt = await f.feedback.collect({ message: "failure", diagnostics: true, principal }, true);
    expect(receipt.diagnosticsIncluded).toBe(true);
    await expect(f.feedback.upload({ id: receipt.id, principal: { ...principal, id: "other" } }, true)).rejects.toMatchObject({ code: "report_identity_mismatch" });
    await expect(f.feedback.upload({ id: receipt.id }, false)).rejects.toMatchObject({ code: "report_identity_mismatch" });
    f.consent([]);
    await expect(f.feedback.upload({ id: receipt.id, principal }, true)).rejects.toMatchObject({ code: "diagnostic_consent_revoked" });
    expect(f.uploaded).toBe(0);
    f.consent();
    const impostor = await f.feedback.collect({ message: "note", diagnostics: true, principal: { ...principal, ownerKey: "other" } }, true);
    expect(impostor.diagnosticsIncluded).toBe(false);
    const anotherAgent = await f.feedback.collect({ message: "note", diagnostics: true, principal: { ...principal, agentId: "other-agent" } }, true);
    expect(anotherAgent.diagnosticsIncluded).toBe(false);
    writeFileSync(join(f.dir, "mcp-bridge.json"), JSON.stringify({ enabled: false, remoteDiagnostics: [principal] }));
    const disabled = await f.feedback.collect({ message: "note", diagnostics: true, principal }, true);
    expect(disabled.diagnosticsIncluded).toBe(false);
  });
  test("caller paths, manifests, endpoints, env and identity substitution are rejected", async () => {
    const f = fixture();
    for (const extra of [{ path: "/tmp/file" }, { logs: ["../file"] }, { glob: "**/*" }, { env: true }, { endpoint: "https://evil.example" }]) {
      await expect(f.feedback.collect({ message: "note", ...extra }, false)).rejects.toMatchObject({ status: 400 });
    }
    await expect(f.feedback.collect({ message: "note" }, true)).rejects.toMatchObject({ status: 400 });
    await expect(f.feedback.collect({ message: "note", principal }, false)).rejects.toMatchObject({ status: 400 });
    await expect(f.feedback.upload({ id: "../../file" }, false)).rejects.toMatchObject({ status: 400 });
    expect(f.uploaded).toBe(0);
  });
  test("symlink sources and old log files never enter the report", async () => {
    const f = fixture();
    mkdirSync(join(f.dir, "logs", "base"), { recursive: true });
    const external = join(f.dir, "outside.log");
    writeFileSync(external, `${new Date().toISOString()} TypeError: outside`);
    symlinkSync(external, join(f.dir, "logs", MESH_REPORT_LOGS[0]));
    const old = join(f.dir, "logs", MESH_REPORT_LOGS[1]);
    writeFileSync(old, `${new Date().toISOString()} TypeError: old-file`); utimesSync(old, 0, 0);
    const receipt = await f.feedback.collect({ message: "note", diagnostics: true }, false);
    expect(f.report(receipt.id).report.logs).toEqual([]);
  });
  test("JSON expansion cannot exceed the persisted total cap", async () => {
    const f = fixture();
    for (const name of MESH_REPORT_LOGS) {
      const path = join(f.dir, "logs", name);
      mkdirSync(join(path, ".."), { recursive: true });
      const line = `${new Date(Date.now() - 1000).toISOString()} TypeError: ${"\0".repeat(500)}\n`;
      writeFileSync(path, line.repeat(25));
    }
    await expect(f.feedback.collect({ message: "note", diagnostics: true }, false)).rejects.toMatchObject({ code: "report_too_large" });
    expect(() => readdirSync(join(f.dir, "reports", "mesh"))).toThrow();
    expect(f.uploaded).toBe(0);
  });
  test("local and bridge note uploads are still separate explicit operations", async () => {
    const f = fixture();
    const receipt = await f.feedback.collect({ message: "just a note", principal }, true);
    expect(f.uploaded).toBe(0);
    expect(await f.feedback.upload({ id: receipt.id, principal }, true)).toEqual({ id: receipt.id, status: "uploaded" });
    expect(f.uploaded).toBe(1);
  });
});

test("feedback dependencies load after instance bootstrap", () => {
  const source = readFileSync(new URL("./broker-daemon.ts", import.meta.url), "utf8");
  expect(source.match(/^import .*$/m)?.[0]).toBe('import { openScoutCheckoutInstanceDefault, openScoutInstanceBootstrap } from "./instance-checkout-bootstrap.js";');
});
