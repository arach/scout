import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { createCoreRepoDiffRead, createRepoDiffReadHandler, parseRepoDiffRead, REPO_DIFF_READ_LIMITS } from "./broker-repo-diff-read.js";
import { createBrokerHttpRouter, type BrokerHttpRouterDeps } from "./broker-http-router.js";
import { meshRouteTierFor, grantSatisfiesRouteTier } from "./mesh-route-matrix.js";
import type { ScoutRepoDiffSnapshot, RepoDiffSnapshotOptions } from "./repo-diff/index.js";
const root = realpathSync(mkdtempSync(join(tmpdir(), "scout-repo-read-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const url = (query = "") => new URL(`http://local/v1/repo-diff/worktree?path=${encodeURIComponent(root)}${query}`);
const snapshot = { schema: "openscout.repo.diff/v1", worktreePath: root, layers: [], coverage: { files: 0 } } as unknown as ScoutRepoDiffSnapshot;

test("worktree read carries fixed budgets, exact filters and refs to the public diff producer", async () => {
  let received: RepoDiffSnapshotOptions | undefined;
  const read = createRepoDiffReadHandler(async options => { received = options; return snapshot; });
  const result = await read(url("&file=src/a.ts&file=src/a.ts&layers=staged&baseRef=main&tier=summary"));
  expect(result.status).toBe(200);
  expect(received).toMatchObject({ worktreePath: root, paths: ["src/a.ts"], layers: ["staged"], baseRef: "main", limits: { ...REPO_DIFF_READ_LIMITS, includeRawPatch: false, includeParsedHunks: false } });
  expect(result.body).toMatchObject({ layers: [], scope: { kind: "worktree", filteredPaths: ["src/a.ts"] } });
});

test("invalid queries never reach a backend", async () => {
  let calls = 0;
  const read = createRepoDiffReadHandler(async () => { calls++; return snapshot; });
  for (const query of ["&file=../secret", "&file=/tmp/secret", "&file=:(glob)**", "&file=*.ts", "&layers=branch,branch", "&layers=nope", "&tier=nope", "&baseRef=-o", "&path=/other", "&timeoutMs=999999", "&file=.", ...["&file=x".repeat(201)]]) {
    expect((await read(url(query))).status, query).toBe(400);
  }
  expect(calls).toBe(0);
  await expect(parseRepoDiffRead(new URL("http://local/?path=relative"))).rejects.toThrow();
});

test("missing worktree/backend is unavailable, not a successful empty diff", async () => {
  const read = createRepoDiffReadHandler(async () => { throw new Error("missing scoutd capability"); });
  expect(await read(url())).toEqual({ status: 503, body: { error: "repo_diff_unavailable" } });
  expect((await read(new URL(`http://local/?path=${root}/missing`))).status).toBe(503);
  expect((await createRepoDiffReadHandler(async () => snapshot)(url())).status).toBe(200);
});

test("overload is bounded and releases its slot on failure", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const read = createRepoDiffReadHandler(async () => { await pending; throw new Error("unavailable"); });
  const first = read(url()), second = read(url());
  expect(await read(url())).toMatchObject({ status: 503, body: { error: "repo_diff_busy" } });
  finish(); await Promise.all([first, second]);
  expect((await read(url())).body).toEqual({ error: "repo_diff_unavailable" });
});

class Response extends EventEmitter {
  status = 0; body = ""; writableEnded = false;
  writeHead(status: number) { this.status = status; }
  end(body = "") { this.body += body; this.writableEnded = true; }
}
test("router mounts a local-only read and never invokes web control", async () => {
  let calls = 0;
  const route = createBrokerHttpRouter({ brokerService: {} as never, host: "localhost", port: 1, runtime: {},
    readRepoDiff: async () => { calls++; return snapshot; },
    webControl: new Proxy({}, { get() { throw new Error("must not access web"); } }),
  } as unknown as BrokerHttpRouterDeps);
  for (const context of [undefined, { transport: "remote", grant: { tier: "control" } }, { transport: "local", scoped: {} }, { transport: "local", guest: {} }]) {
    const response = new Response();
    await route({ method: "GET", url: url().pathname + url().search, headers: {}, transportContext: context } as any, response as any);
    expect(response.status).toBe(context ? 403 : 200);
  }
  expect(calls).toBe(1);
  const tier = meshRouteTierFor("GET", "/v1/repo-diff/worktree");
  expect(tier).toBe("local");
  expect(grantSatisfiesRouteTier("observe", tier)).toBe(false);
  expect(grantSatisfiesRouteTier("control", tier)).toBe(false);
});


test("production adapter uses scoutd only, with no spawn/Cargo fallback and exact response identity", async () => {
  let captured: unknown[] = [];
  const read = createCoreRepoDiffRead(async (...args) => { captured = args; return snapshot; });
  const options = await parseRepoDiffRead(url("&layers=unstaged"));
  expect((await read(options)).worktreePath).toBe(root);
  expect(captured[0]).toBeNull();
  expect(captured[2]).toBe(6_500);
  expect(captured[3]).toBe("diff");
  expect(captured[1]).toMatchObject({ worktreePath: root, limits: REPO_DIFF_READ_LIMITS });
  await expect(createCoreRepoDiffRead(async () => ({ ...snapshot, worktreePath: "/other" }))(options)).rejects.toThrow();
});
