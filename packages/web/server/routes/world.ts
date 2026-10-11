import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import type { Hono } from "hono";
import { homedir } from "node:os";
import { createWorldWeekService, readQuota, worldDays } from "../world-week.ts";
import { createTeamWeekService } from "../world-team.ts";
import { createWorldStashStore, isWorldStash, WORLD_STASH_CAP } from "../world-stash.ts";
import { parseWorldContext, resolveWorldCommand, worldJevConfig } from "../world-command.ts";
import { previewKind } from "../world-files.ts";
import { createWorldLive, LIVE_HOURS, type WorldLive } from "../world-live.ts";
import { decodeOtlpRequest, encodeOtlpResponse, type OtlpEncoding } from "@openscout/runtime/otlp";

const TEXT_CAP = 400_000;
const missing = () => new Response("not found", { status: 404 });
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}
async function readBoundedJson(request: Request, cap: number): Promise<{ value?: unknown; response?: Response }> {
  if (Number(request.headers.get("content-length")) > cap) return { response: new Response("body too large", { status: 413 }) };
  if (!request.body) return { response: new Response("bad JSON", { status: 400 }) };
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) { await reader.cancel(); return { response: new Response("body too large", { status: 413 }) }; }
      chunks.push(value);
    }
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch { return { response: new Response("bad JSON", { status: 400 }) }; }
  finally { reader.releaseLock(); }
}
/** The body, or null once it passes cap bytes (read no further). */
async function readBoundedBytes(request: Request, cap: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch { return null; } finally { try { reader.releaseLock(); } catch {} }
}
async function openWorldFile(path: string, action: "open" | "reveal"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/open", action === "reveal" ? ["-R", path] : [path], { timeout: 5_000 }, error => error ? reject(error) : resolve());
  });
}
export type WorldRouteDeps = {
  week?: ReturnType<typeof createWorldWeekService>;
  /** ?data=team: the operator's machines as teammates, built from the snapshots world-team.ts collects */
  team?: ReturnType<typeof createTeamWeekService>;
  stash?: ReturnType<typeof createWorldStashStore>;
  openFile?: typeof openWorldFile;
  /** Words → ":" lines. Jev from the env (TYPESAFE_API_KEY) unless given; null forces the keyword parser. */
  command?: { jev?: { apiKey: string; endpoint: string } | null; fetcher?: typeof fetch };
  /** where the HUD's :tour files live (<name>.tour); default <control home>/world-tours */
  toursDir?: string;
  /** ?source=live|otlp: the World following us (world-live.ts); created on first use */
  live?: WorldLive;
  brokerUrl?: () => string;
};
/** OTLP/HTTP bodies the World accepts from an exporter; anything bigger is refused, not truncated */
export const WORLD_OTLP_CAP = 4 * 1024 * 1024;
const TOUR_CAP = 64 * 1024, TOUR_NAME = /^[\w.-]{1,64}$/;
/** Mounted after installScoutApiMiddleware; all routes require operator authority. */
export function mountWorldRoutes(app: Hono, deps: WorldRouteDeps = {}) {
  const week = deps.week ?? createWorldWeekService(), stash = deps.stash ?? createWorldStashStore();
  const team = deps.team ?? createTeamWeekService({ quota: from => readQuota(homedir(), from) });
  // allow-list membership, then containment re-checked on the realpath (symlinks included) and the deny list:
  // resolves to the real file to serve, or null
  const previewable = (p: unknown): Promise<string | null> => week.previewable(p);
  app.get("/api/ops/world-week", async (c) => {
    c.header("cache-control", "no-store");
    try {
      // ?data=team: every machine as a teammate (same schema), from the cached per-host snapshots
      if (c.req.query("data") === "team") {
        const gz = /\bgzip\b/.test(c.req.header("accept-encoding") || "");
        const body = gz ? await team.gzip() : await team.json();
        if (body == null) return c.json({ error: "no team snapshots yet: run bun design/studio/scripts/world-team.ts --hosts" }, 404);
        return new Response(body as BodyInit, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(gz ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) } });
      }
      return new Response(await week.json(worldDays(c.req.query("days"))), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    } catch (error) {
      console.error("[world-week]", error);
      return c.json({ error: "could not load World activity" }, 500);
    }
  });
  app.get("/api/ops/world-file", async (c) => {
    const p = c.req.query("p") || "";
    try {
      const real = await previewable(p); if (!real) return missing();
      const st = await stat(real); if (!st.isFile()) return missing();
      // sandbox CSP + nosniff on every preview; an SVG opened top-level comes back as its text
      const kind = previewKind(real, c.req.header("sec-fetch-dest"));
      const headers = { "cache-control": "no-store", "x-mtime": String(st.mtimeMs), "x-size": String(st.size), ...kind.headers };
      if (kind.binary) return new Response(Bun.file(real), { headers });
      const handle = await open(real, "r");
      try {
        const buf = Buffer.alloc(Math.min(st.size, TEXT_CAP));
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        return new Response(buf.subarray(0, bytesRead).toString("utf8"), {
          headers: { ...headers, "x-truncated": st.size > TEXT_CAP ? "1" : "0" },
        });
      } finally { await handle.close(); }
    } catch { return missing(); }
  });
  app.post("/api/ops/world-file", async (c) => {
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 16 * 1024);
    if (body.response) return body.response;
    const value = body.value as { p?: unknown; action?: unknown } | null;
    const p = value?.p, action = value?.action;
    try {
      const real = await previewable(p); if (!real) return missing();
      if (action !== "reveal" && action !== "open") return new Response("bad action", { status: 400 });
      await (deps.openFile ?? openWorldFile)(real, action);
      return c.json({ ok: true });
    } catch { return missing(); }
  });
  // natural language → the HUD's ":" lines: { text, context? } → ok | confirm | none (see world-command.ts)
  app.post("/api/ops/world-command", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 32 * 1024);
    if (body.response) return body.response;
    const value = body.value as { text?: unknown; context?: unknown } | null;
    if (typeof value?.text !== "string" || !value.text.trim() || value.text.length > 600) return c.json({ error: "text is required (≤ 600 chars)" }, 400);
    const jev = deps.command?.jev !== undefined ? deps.command.jev : worldJevConfig();
    return c.json(await resolveWorldCommand(value.text, parseWorldContext(value.context), { jev, fetcher: deps.command?.fetcher }));
  });
  // tours: timed lists of the HUD's ":" lines, one text file each; ?name= reads one, no name lists them
  const toursDir = () => deps.toursDir ?? join(resolveOpenScoutSupportPaths().controlHome, "world-tours");
  app.get("/api/ops/world-tour", async (c) => {
    c.header("cache-control", "no-store");
    const name = c.req.query("name");
    if (name == null) {
      try { return c.json((await readdir(toursDir())).filter(f => f.endsWith(".tour")).map(f => f.slice(0, -5)).filter(n => TOUR_NAME.test(n)).sort()); }
      catch { return c.json([]); }
    }
    if (!TOUR_NAME.test(name) || name.startsWith(".")) return new Response("bad tour name", { status: 400 });
    try {
      const path = join(toursDir(), `${name}.tour`), st = await stat(path);
      if (!st.isFile() || st.size > TOUR_CAP) return missing();
      return new Response(await readFile(path, "utf8"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    } catch { return missing(); }
  });
  // live: a seed (the engine's payload over the last hours) then deltas, as server-sent events
  let liveHub: WorldLive | null = deps.live ?? null;
  const hub = () => liveHub ??= createWorldLive({ brokerUrl: deps.brokerUrl, log: line => console.log("[world-live]", line) });
  app.get("/api/ops/world-live", async (c) => {
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const source = c.req.query("source") === "otlp" ? "otlp" : "live";
    const hours = Math.max(1, Math.min(LIVE_HOURS, Number(c.req.query("hours")) || LIVE_HOURS));
    const signal = c.req.raw.signal, enc = new TextEncoder();
    let close: (() => void) | null = null, beat: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(ctl) {
        let open = true;
        const end = () => { if (!open) return; open = false; close?.(); if (beat) clearInterval(beat); try { ctl.close(); } catch {} };
        const send = (event: string, data: unknown) => { if (!open) return; try { ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { end(); } };
        signal.addEventListener("abort", end);
        ctl.enqueue(enc.encode(": world-live\n\n"));
        beat = setInterval(() => { try { ctl.enqueue(enc.encode(": keepalive\n\n")); } catch { end(); } }, 15_000);
        try { close = await hub().subscribe(source, hours, send); if (!open) close(); }
        catch (error) { console.error("[world-live]", error); send("error", { error: "could not start the live World" }); end(); }
      },
      cancel() { close?.(); if (beat) clearInterval(beat); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  });
  app.get("/api/ops/world-live/status", (c) => { c.header("cache-control", "no-store"); return c.json(liveHub ? liveHub.status() : { started: false }); });
  // OTLP/HTTP ingest (JSON or protobuf): what an exporter sends shows up on ?source=otlp. Same trust gate as every
  // /api route; the runtime's codec decodes strictly, then fromOtlp() redacts and clips every field it keeps.
  for (const signal of ["traces", "logs", "metrics"] as const) {
    app.post(`/api/ops/world-otlp/v1/${signal}`, async (c) => {
      if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
      const type = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
      const encoding: OtlpEncoding | null = type === "application/json" ? "application/json" : type === "application/x-protobuf" ? "application/x-protobuf" : null;
      if (!encoding) return new Response("unsupported content-type", { status: 415 });
      if ((c.req.header("content-encoding") || "identity").toLowerCase() !== "identity") return new Response("unsupported content-encoding", { status: 415 });
      if (Number(c.req.header("content-length")) > WORLD_OTLP_CAP) return new Response("body too large", { status: 413 });
      const buf = await readBoundedBytes(c.req.raw, WORLD_OTLP_CAP);
      if (!buf) return new Response("body too large", { status: 413 });
      let req: Record<string, unknown>;
      try { req = decodeOtlpRequest(signal, buf, encoding, 32); } catch { return new Response("invalid OTLP request", { status: 400 }); }
      // metrics are accepted (an exporter that sends all three shouldn't error) and noted by name; they don't draw
      const res = hub().ingest(req as any, signal);
      return new Response(encodeOtlpResponse(signal, encoding, 0) as unknown as BodyInit, { headers: { "content-type": encoding, "x-world-used": String(res.used), "x-world-skipped": String(res.skipped) } });
    });
  }
  app.get("/api/ops/world-stash", async (c) => {
    c.header("cache-control", "no-store");
    try { return c.json(await stash.read()); }
    catch { return c.json({ error: "could not read World stash" }, 500); }
  });
  app.put("/api/ops/world-stash", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, WORLD_STASH_CAP);
    if (body.response) return body.response;
    if (!isWorldStash(body.value)) return c.json({ error: "stash must be an array of card objects" }, 400);
    try { await stash.write(body.value); return c.json({ ok: true }); }
    catch { return c.json({ error: "could not save World stash" }, 500); }
  });
}
