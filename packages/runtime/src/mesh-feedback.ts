import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { z } from "zod";
import type { DiagnosticReport } from "./diagnostic-report.js";
import { diagnosticLogLines, redactDiagnosticText } from "./diagnostic-report.js";
import { mcpEventPrincipalSchema } from "./broker-mcp-events.js";

export const MESH_REPORT_MAX_BYTES = 128 * 1024;
export const MESH_REPORT_MAX_AGE_MS = 24 * 60 * 60_000;
const LOG_BYTES = 16 * 1024;
// Runtime-owned manifest. No caller may add a path or expand the manifest.
export const MESH_REPORT_LOGS = ["base/broker.stderr.log", "base/mesh-bridge.stderr.log", "probes/stderr.log"] as const;
const collectSchema = z.object({ message: z.string().max(8000), diagnostics: z.boolean().default(false), principal: mcpEventPrincipalSchema.optional() }).strict();
const uploadSchema = z.object({ id: z.string().uuid(), principal: mcpEventPrincipalSchema.optional() }).strict();
type Principal = z.infer<typeof mcpEventPrincipalSchema>;
const principalKey = (p: Principal) => createHash("sha256").update(JSON.stringify([p.kind, p.id, p.ownerKey, p.node, p.agentId, p.userId ?? null])).digest("hex");
export class MeshFeedbackError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** Containment, no symlink leaf, bounded descriptor reads; never follows user paths. */
async function readFixed(root: string, name: string, max: number, tail = false) {
  const path = join(root, name);
  const [base, resolved] = await Promise.all([realpath(root), realpath(path)]);
  if (!resolved.startsWith(base + sep)) throw new Error("outside manifest root");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (typeof process.getuid === "function" && stat.uid !== process.getuid())) throw new Error("invalid source");
    if (!tail && stat.size > max) throw new Error("source too large");
    const bytes = Buffer.alloc(Math.min(max, stat.size));
    const result = await file.read(bytes, 0, bytes.length, tail ? Math.max(0, stat.size - max) : 0);
    let text = bytes.subarray(0, result.bytesRead).toString("utf8");
    if (tail && stat.size > max) text = text.slice(text.indexOf("\n") + 1);
    return { text, modifiedAt: stat.mtimeMs };
  } finally { await file.close(); }
}

export class MeshFeedback {
  private active = false;
  private windowStart = 0;
  private used = 0;
  constructor(private readonly deps: {
    supportDirectory: string; endpoint: string;
    health: () => { ready: boolean; advertiseScope: "local" | "mesh";
      tailscale?: { unavailable: boolean; running: boolean | null; stale: boolean; at: number | null } };
    fetch?: typeof fetch; now?: () => number;
  }) {}
  private now() { return (this.deps.now ?? Date.now)(); }
  private async allowed(p: Principal) {
    try {
      const config = JSON.parse((await readFixed(this.deps.supportDirectory, "mcp-bridge.json", 64 * 1024)).text);
      if (config.enabled === false) return false;
      const list = z.array(mcpEventPrincipalSchema).max(128).safeParse(config.remoteDiagnostics);
      return list.success && list.data.some(identity => principalKey(identity) === principalKey(p));
    } catch { return false; }
  }
  private async enter() {
    if (this.now() - this.windowStart >= 60_000) { this.windowStart = this.now(); this.used = 0; }
    if (this.active || this.used >= 10) throw new MeshFeedbackError(429, "feedback_rate_limited");
    this.active = true; this.used++;
  }
  async collect(input: unknown, bridge: boolean) {
    const parsed = collectSchema.safeParse(input);
    if (!parsed.success || (bridge ? !parsed.data.principal : !!parsed.data.principal)) throw new MeshFeedbackError(400, "invalid_feedback_request");
    await this.enter();
    try {
      const { message, principal } = parsed.data;
      // A relay principal without consent still gets a note, never diagnostic material.
      const diagnostics = parsed.data.diagnostics && (!bridge || await this.allowed(principal!));
      const now = this.now();
      const report: DiagnosticReport = {
        id: randomUUID(), timestamp: new Date(now).toISOString(),
        system: { os: "omitted", osVersion: "omitted", chip: "omitted", memory: "omitted" }, apps: {},
        context: { source: bridge ? "Scout bridge v1" : "Scout runtime v1", userDescription: message, reportSections: [] }, logs: [],
      };
      const add = (id: string, data: unknown) => report.context.reportSections.push({ id, title: id, entries: [{ label: "Evidence", value: JSON.stringify(data) }] });
      if (diagnostics) {
        const health = this.deps.health();
        add("health", { ready: health.ready, advertiseScope: health.advertiseScope, observedAt: now,
          tailscale: health.tailscale ? { unavailable: health.tailscale.unavailable, running: health.tailscale.running,
            stale: health.tailscale.stale, at: health.tailscale.at } : null });
        try {
          const raw = JSON.parse((await readFixed(this.deps.supportDirectory, "settings.json", 32 * 1024)).text);
          add("settings", Object.fromEntries(["brokerPort", "meshEnabled"].filter(key => ["number", "boolean"].includes(typeof raw[key])).map(key => [key, raw[key]])));
        } catch { add("settings", { unavailable: true }); }
        for (const name of MESH_REPORT_LOGS) {
          try {
            const tail = await readFixed(join(this.deps.supportDirectory, "logs"), name, LOG_BYTES, true);
            if (tail.modifiedAt < now - MESH_REPORT_MAX_AGE_MS || tail.modifiedAt > now + 1_000) { add(name, { unavailable: true, reason: "outside_age_window" }); continue; }
            const recent = tail.text.split("\n").flatMap(line => {
              // Untimestamped lines cannot prove age and are omitted, including stack continuations.
              const match = /^\[?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\]?\s+(.*)$/.exec(line);
              const at = match ? Date.parse(match[1]!) : NaN;
              return Number.isFinite(at) && at >= now - MESH_REPORT_MAX_AGE_MS && at <= now ? [match![2]!] : [];
            });
            const lines = diagnosticLogLines(recent.join("\n"));
            report.logs.push(...lines.map(line => `[${name}] ${line}`));
            add(name, { modifiedAt: tail.modifiedAt, tailBytes: LOG_BYTES, includedLines: lines.length });
          } catch { add(name, { unavailable: true }); }
        }
      }
      // Explicit opt-in can be revoked while collection awaits file I/O.
      if (diagnostics && bridge && !await this.allowed(principal!)) throw new MeshFeedbackError(403, "diagnostic_consent_revoked");
      const clean = (value: unknown): unknown => typeof value === "string" ? redactDiagnosticText(value)
        : Array.isArray(value) ? value.map(clean)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)])) : value;
      const redacted = clean(report) as DiagnosticReport;
      // Consent/provenance stays local, outside the upload payload.
      const envelope = JSON.stringify({ report: redacted, diagnostics, principal: principal ? principalKey(principal) : null });
      if (Buffer.byteLength(envelope) > MESH_REPORT_MAX_BYTES) throw new MeshFeedbackError(413, "report_too_large");
      const directory = join(this.deps.supportDirectory, "reports", "mesh");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, `${report.id}.json`), envelope, { mode: 0o600, flag: "wx" });
      return { id: report.id, status: "saved", diagnosticsIncluded: diagnostics };
    } finally { this.active = false; }
  }
  async upload(input: unknown, bridge: boolean) {
    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success || (bridge ? !parsed.data.principal : !!parsed.data.principal)) throw new MeshFeedbackError(400, "invalid_feedback_request");
    await this.enter();
    try {
      const { id, principal } = parsed.data;
      const saved = JSON.parse((await readFixed(join(this.deps.supportDirectory, "reports", "mesh"), `${id}.json`, MESH_REPORT_MAX_BYTES)).text);
      if (saved.principal !== (principal ? principalKey(principal) : null)) throw new MeshFeedbackError(403, "report_identity_mismatch");
      if (saved.diagnostics && bridge && !await this.allowed(principal!)) throw new MeshFeedbackError(403, "diagnostic_consent_revoked");
      const endpoint = new URL(this.deps.endpoint);
      if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new MeshFeedbackError(503, "invalid_feedback_destination");
      const body = JSON.stringify(saved.report);
      if (Buffer.byteLength(body) > MESH_REPORT_MAX_BYTES) throw new MeshFeedbackError(413, "report_too_large");
      const signal = AbortSignal.timeout(10_000);
      const response = await (this.deps.fetch ?? fetch)(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal, redirect: "error" });
      const reader = response.body?.getReader();
      if (!reader) throw new MeshFeedbackError(502, "feedback_upload_failed");
      const chunks: Uint8Array[] = []; let bytes = 0;
      const abort = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted(); const chunk = await reader.read(); signal.throwIfAborted();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 8192) throw new MeshFeedbackError(502, "feedback_upload_failed");
          chunks.push(chunk.value);
        }
      } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!response.ok || result.success !== true || result.id !== id) throw new MeshFeedbackError(502, "feedback_upload_failed");
      return { id, status: "uploaded" };
    } finally { this.active = false; }
  }
}
