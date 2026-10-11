import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installScoutApiMiddleware } from "../server-core.ts";
import { createWorldWeekService } from "../world-week.ts";
import { createWorldStashStore, WORLD_STASH_CAP } from "../world-stash.ts";
import { createTeamWeekService } from "../world-team.ts";
import { mountWorldRoutes } from "./world.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const headers = { authorization: "Bearer operator-test", "content-type": "application/json", origin: "http://localhost" };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "world-routes-")); roots.push(root);
  // home is the temp root; the session works in ~/dev/proj, the only approved preview root
  const project = join(root, ".claude/projects/p"), cwd = join(root, "dev/proj");
  await Promise.all([mkdir(project, { recursive: true }), mkdir(cwd, { recursive: true }), mkdir(join(root, "notes"), { recursive: true })]);
  const file = join(cwd, "allowed.txt"), image = join(cwd, "image.png"), svg = join(cwd, "pic.svg"), html = join(cwd, "page.html"), pdf = join(cwd, "doc.pdf"), now = Date.now();
  const outside = join(root, "notes/secret.txt"), escape = join(cwd, "link.txt"), dotenv = join(cwd, ".env"), traversal = `${cwd}/../notes/secret.txt`;
  await writeFile(file, "A".repeat(400_001)); await writeFile(image, new Uint8Array([1, 2, 3]));
  await writeFile(svg, `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>`);
  await writeFile(html, "<script>alert(1)</script>"); await writeFile(pdf, "%PDF-1.4\n");
  await writeFile(outside, "outside the roots"); await writeFile(dotenv, "OPENAI_API_KEY=sk-x");
  await symlink(outside, escape);
  const read = [file, image, svg, html, pdf, outside, escape, dotenv, traversal];
  await writeFile(join(project, "fixture-session.jsonl"), JSON.stringify({ type: "assistant", timestamp: new Date(now - 10).toISOString(), cwd, message: { content: read.map(path => ({ type: "tool_use", name: "Read", input: { file_path: path } })) } }));
  const week = createWorldWeekService({ home: root, readBroker: () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] });
  const stashPath = join(root, "state/world-modale-stash.json"), opened: [string, string][] = [];
  const app = new Hono();
  installScoutApiMiddleware(app, "world-test", { authToken: "operator-test" });
  const teamDir = join(root, "world-team");
  const toursDir = join(root, "world-tours");
  mountWorldRoutes(app, { week, team: createTeamWeekService({ dir: teamDir }), stash: createWorldStashStore(stashPath), openFile: async (p, action) => { opened.push([p, action]); }, toursDir });
  return { app, root, file, image, svg, html, pdf, outside, escape, dotenv, traversal, stashPath, opened, teamDir, now, toursDir };
}
const api = "http://localhost/api/ops";
describe("World routes behind the existing trust gate", () => {
  test("requires operator authentication for every route and rejects foreign origins", async () => {
    const { app } = await fixture();
    for (const path of ["world-week", "world-file", "world-stash", "world-tour"]) {
      expect((await app.request(`${api}/${path}`)).status).toBe(401);
      expect((await app.request(`${api}/${path}`, { headers: { ...headers, origin: "https://foreign.example" } })).status).toBe(403);
    }
  });
  test("serves tours by name from the tours folder, lists them, and refuses names that could leave it", async () => {
    const { app, toursDir, root } = await fixture();
    expect(await (await app.request(`${api}/world-tour`, { headers })).json()).toEqual([]);
    await mkdir(toursDir, { recursive: true });
    await writeFile(join(toursDir, "the-week.tour"), "name The Week\nt=0 speed 1h/s\n");
    await writeFile(join(toursDir, "notes.txt"), "not a tour");
    await writeFile(join(root, "outside.tour"), "t=0 play\n");
    const one = await app.request(`${api}/world-tour?name=the-week`, { headers });
    expect(one.status).toBe(200); expect(await one.text()).toBe("name The Week\nt=0 speed 1h/s\n");
    expect(one.headers.get("content-type")).toContain("text/plain");
    expect(await (await app.request(`${api}/world-tour`, { headers })).json()).toEqual(["the-week"]);
    expect((await app.request(`${api}/world-tour?name=missing`, { headers })).status).toBe(404);
    for (const bad of ["../outside", "..", "a/b", ".hidden", ""]) expect((await app.request(`${api}/world-tour?name=${encodeURIComponent(bad)}`, { headers })).status).toBe(400);
    await writeFile(join(toursDir, "huge.tour"), "#".repeat(64 * 1024 + 1));
    expect((await app.request(`${api}/world-tour?name=huge`, { headers })).status).toBe(404);
  });
  test("returns the week contract with a capped days query", async () => {
    const { app } = await fixture();
    const response = await app.request(`${api}/world-week?days=99`, { headers });
    const data = await response.json();
    expect(response.status).toBe(200); expect(data.now - data.from).toBe(14 * 864e5);
    expect(data.events).toHaveLength(9); expect(data.events[0]).toHaveLength(7);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  test("serves the machines-as-team week from collected snapshots, and says how to collect when there are none", async () => {
    const { app, teamDir, now } = await fixture();
    const empty = await app.request(`${api}/world-week?data=team`, { headers });
    expect(empty.status).toBe(404); expect((await empty.json()).error).toContain("world-team.ts --hosts");
    await mkdir(join(teamDir, "snapshots"), { recursive: true });
    await writeFile(join(teamDir, "hosts.json"), JSON.stringify({ hosts: [{ host: "mini", persona: "Mini", ssh: "mini" }] }));
    await writeFile(join(teamDir, "snapshots/mini.json"), JSON.stringify({
      v: 1, host: "mini", home: "/Users/arach", at: now, from: now - 7 * 864e5, now, sessions: [{ sid: "dddd4444", h: "claude" }],
      raw: [[now - 60_000, "~/dev/lattices", "claude", "dddd4444", "Bash", "bun test"]], inbound: [[now - 70_000, "dddd4444", "Run the lattices tests"]],
      usage: [], files: {}, roots: {}, repos: { "~/dev/lattices": { origin: "", branches: [], worktrees: [] } }, broker: null, ms: 1,
    }));
    const response = await app.request(`${api}/world-week?data=team`, { headers });
    const a = await response.json(), b = await (await app.request(`${api}/world-week?data=team`, { headers })).json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(a.label).toBe("TEAM · 1 MACHINE"); expect(a.now - a.from).toBe(7 * 864e5);
    expect(a.actors.filter((x: { kind: string }) => x.kind === "person").map((x: { name: string }) => x.name)).toEqual(["Mini"]);
    expect(a.hosts).toMatchObject([{ name: "Mini", host: "mini", stale: false }]);
    expect(a.events[0]).toHaveLength(7); expect(a.allow).toEqual([]); expect(b).toEqual(a);
    const zipped = await app.request(`${api}/world-week?data=team`, { headers: { ...headers, "accept-encoding": "gzip, br" } });
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(JSON.parse(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await zipped.arrayBuffer()))))).toEqual(a);
  });
  test("denies /etc/passwd and relative aliases with 404 for both methods", async () => {
    const { app, opened } = await fixture();
    for (const p of ["/etc/passwd", "allowed.txt"]) {
      expect((await app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers })).status).toBe(404);
      expect((await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p, action: "open" }) })).status).toBe(404);
    }
    expect(opened).toEqual([]);
  });
  test("previews only realpaths inside an approved root: no traversal, symlink escape, deny-listed or outside-root files", async () => {
    const { app, file, outside, escape, dotenv, traversal, opened } = await fixture();
    const week = await (await app.request(`${api}/world-week`, { headers })).json();
    expect(week.allow).toContain(file);
    for (const p of [outside, escape, dotenv, traversal]) {
      expect(week.allow).not.toContain(p);
      expect((await app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers })).status).toBe(404);
      expect((await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p, action: "open" }) })).status).toBe(404);
    }
    expect(opened).toEqual([]);
  });
  test("re-checks containment at open time: a file swapped for an escaping symlink after the week was built is refused", async () => {
    const { app, file, outside } = await fixture();
    expect((await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers })).status).toBe(200);
    await rm(file); await symlink(outside, file);
    expect((await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers })).status).toBe(404);
  });
  test("every preview carries the sandbox CSP and nosniff; an SVG opened top-level comes back as text", async () => {
    const { app, file, image, svg, html, pdf } = await fixture();
    const get = (p: string, dest?: string) => app.request(`${api}/world-file?p=${encodeURIComponent(p)}`, { headers: dest ? { ...headers, "sec-fetch-dest": dest } : headers });
    for (const [p, dest, type] of [[svg, "image", "image/svg+xml"], [svg, "document", "text/plain; charset=utf-8"], [svg, "iframe", "text/plain; charset=utf-8"], [html, "document", "text/plain; charset=utf-8"],
      [html, undefined, "text/plain; charset=utf-8"], [file, undefined, "text/plain; charset=utf-8"], [image, "image", "image/png"], [pdf, "iframe", "application/pdf"]] as const) {
      const r = await get(p, dest);
      expect(r.status).toBe(200); expect(r.headers.get("content-type")).toBe(type);
      const csp = r.headers.get("content-security-policy") || "";
      expect(csp.split(";")[0].trim()).toBe("sandbox"); expect(csp).toContain("default-src 'none'");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
  test("serves capped text and binary with the Studio metadata headers", async () => {
    const { app, file, image } = await fixture();
    const text = await app.request(`${api}/world-file?p=${encodeURIComponent(file)}`, { headers });
    expect(text.status).toBe(200); expect((await text.text()).length).toBe(400_000);
    expect(text.headers.get("x-truncated")).toBe("1"); expect(text.headers.get("x-size")).toBe("400001");
    expect(Number(text.headers.get("x-mtime"))).toBeGreaterThan(0);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const binary = await app.request(`${api}/world-file?p=${encodeURIComponent(image)}`, { headers });
    expect(binary.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  test("rejects foreign POST with 403 and bad action with 400; forwards open/reveal as arguments", async () => {
    const { app, file, opened } = await fixture();
    const foreign = await app.request(`${api}/world-file`, { method: "POST", headers: { ...headers, origin: "https://foreign.example" }, body: JSON.stringify({ p: file, action: "open" }) });
    expect(foreign.status).toBe(403);
    const bad = await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p: file, action: "delete" }) });
    expect(bad.status).toBe(400); expect(opened).toEqual([]);
    for (const action of ["open", "reveal"]) {
      const result = await app.request(`${api}/world-file`, { method: "POST", headers, body: JSON.stringify({ p: file, action }) });
      expect(await result.json()).toEqual({ ok: true });
    }
    const real = await realpath(file);
    expect(opened).toEqual([[real, "open"], [real, "reveal"]]);
  });
  test("persists opaque cards across store instances, caps bytes, and rejects invalid stash JSON", async () => {
    const { app, stashPath } = await fixture();
    expect(await (await app.request(`${api}/world-stash`, { headers })).json()).toEqual([]);
    const cards = [{ f: { abs: "/anything", disp: "whatever" }, ctx: null, x: 10, y: 20, future: { keep: true } }];
    const put = await app.request(`${api}/world-stash`, { method: "PUT", headers, body: JSON.stringify(cards) });
    expect(await put.json()).toEqual({ ok: true });
    expect(await (await app.request(`${api}/world-stash`, { headers })).json()).toEqual(cards);
    expect(await createWorldStashStore(stashPath).read()).toEqual(cards);
    expect(JSON.parse(await readFile(stashPath, "utf8"))).toEqual(cards);
    expect((await stat(stashPath)).mode & 0o777).toBe(0o600);
    for (const body of ["{}", "[null]", "[1]", "bad json"]) {
      expect((await app.request(`${api}/world-stash`, { method: "PUT", headers, body })).status).toBe(400);
    }
    expect((await app.request(`${api}/world-stash`, { method: "PUT", headers, body: JSON.stringify([{ huge: "x".repeat(WORLD_STASH_CAP) }]) })).status).toBe(413);
    expect((await app.request(`${api}/world-stash`, { method: "PUT", headers: { ...headers, origin: "https://foreign.example" }, body: "[]" })).status).toBe(403);
    expect(await createWorldStashStore(stashPath).read()).toEqual(cards);
  });
});
