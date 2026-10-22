import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrokerCapabilityMatrixService,
  CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS,
  type BrokerCapabilityMatrixServiceOptions,
} from "./broker-capability-matrix-service.js";
import {
  evaluateHarnessReadinessAsync,
  findHarnessEntry,
  type HarnessCatalogSnapshot,
} from "./harness-catalog.js";
import { discoverConfiguredMcpServers } from "./mcp-discovery.js";

const roots: string[] = [],
  services: BrokerCapabilityMatrixService[] = [];
const originalPath = process.env.PATH;
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  process.env.PATH = originalPath;
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "matrix-refresh-"));
  roots.push(path);
  return path;
}
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 1));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 5000 && !predicate(); i++) await tick();
  expect(predicate()).toBe(true);
}
function catalog(at: number): HarnessCatalogSnapshot {
  return { version: 1, generatedAt: at, entries: [] };
}
function fixture(
  overrides: Partial<BrokerCapabilityMatrixServiceOptions> = {},
) {
  const dir = root();
  let now = 1000,
    mono = 0;
  const calls = { catalog: 0, model: 0, mcp: 0, writes: 0 };
  const options: BrokerCapabilityMatrixServiceOptions = {
    nodeId: "fixture",
    now: () => now,
    monotonicNow: () => mono,
    cachePath: () => join(dir, "matrix.json"),
    loadHarnessCatalogSnapshot: async ({ now }) => {
      calls.catalog++;
      return catalog(now());
    },
    loadRuntimeModelCatalogInput: async () => {
      calls.model++;
      return { input: null, warnings: [] };
    },
    loadRuntimeMcpServerCatalog: async () => {
      calls.mcp++;
      return { servers: [], warnings: [] };
    },
    writeTextFile: async (path, content, encoding) => {
      calls.writes++;
      await writeFile(path, content, encoding);
    },
    ...overrides,
  };
  const service = new BrokerCapabilityMatrixService(options);
  services.push(service);
  return {
    service,
    options,
    calls,
    dir,
    wall: (n: number) => {
      now = n;
    },
    age: (n: number) => {
      mono = n;
    },
  };
}
test("concurrent refreshes join once, including force; start-time env and clock stay fixed", async () => {
  const gate = deferred(),
    entered = deferred();
  const old = process.env.MATRIX_TEST_INPUT;
  process.env.MATRIX_TEST_INPUT = "before";
  let calls = 0,
    input: string | undefined;
  const f = fixture({
    loadHarnessCatalogSnapshot: async ({ now, env }) => {
      calls++;
      input = env?.MATRIX_TEST_INPUT;
      const at = now();
      entered.resolve();
      await gate.promise;
      return catalog(at);
    },
  });
  try {
    const first = f.service.read({ force: true });
    await entered.promise;
    process.env.MATRIX_TEST_INPUT = "after";
    f.wall(2000);
    const others = Array.from({ length: 20 }, (_, i) =>
      f.service.read({ force: i % 2 === 0 }),
    );
    gate.resolve();
    const snapshots = await Promise.all([first, ...others]);
    expect(calls).toBe(1);
    expect(input).toBe("before");
    expect(new Set(snapshots).size).toBe(1);
    expect(snapshots[0].generatedAt).toBe(1000);
    expect(f.calls.model).toBe(1);
    expect(f.calls.mcp).toBe(1);
    expect(f.calls.writes).toBe(1);
    expect((await f.service.read({ force: true })).generatedAt).toBe(2000);
    expect(input).toBe("after");
    expect(calls).toBe(2);
  } finally {
    if (old === undefined) delete process.env.MATRIX_TEST_INPUT;
    else process.env.MATRIX_TEST_INPUT = old;
    gate.resolve();
  }
});
test("force promotes pending disk read without joining that I/O; its late hit cannot publish", async () => {
  const disk = deferred<string>();
  let reads = 0;
  const f = fixture({
    readTextFile: async () => {
      reads++;
      return disk.promise;
    },
  });
  const first = f.service.read(),
    second = f.service.read();
  expect(reads).toBe(1);
  f.wall(2000);
  const forced = f.service.read({ force: true });
  expect((await forced).generatedAt).toBe(2000);
  expect(await first).toBe(await forced);
  expect(await second).toBe(await forced);
  disk.resolve(
    JSON.stringify({
      generatedAt: 1000,
      sources: [],
      capabilities: [],
      warnings: ["old disk"],
    }),
  );
  await tick();
  expect((await f.service.read()).warnings).toEqual([]);
  expect(f.calls.catalog).toBe(1);
  // A completed persisted hit cannot satisfy a subsequent force either.
  const persisted = fixture({
    readTextFile: async () =>
      JSON.stringify({
        generatedAt: 1000,
        sources: [],
        capabilities: [],
        warnings: ["disk"],
      }),
  });
  expect((await persisted.service.read()).warnings).toEqual(["disk"]);
  expect(persisted.calls.catalog).toBe(0);
  expect((await persisted.service.read({ force: true })).warnings).toEqual([]);
  expect(persisted.calls.catalog).toBe(1);
});
test("aged forced read replaces a never-resolving refresh; late fulfillment cannot publish or clear replacement", async () => {
  const first = deferred<HarnessCatalogSnapshot>(),
    next = deferred<HarnessCatalogSnapshot>();
  let calls = 0;
  const f = fixture({
    loadHarnessCatalogSnapshot: async () => {
      calls++;
      return calls === 1 ? first.promise : next.promise;
    },
  });
  const old = f.service.read({ force: true });
  const oldRejected = old.catch((error) => error);
  f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS - 1);
  expect(f.service.read({ force: true })).toBe(old);
  expect(calls).toBe(1);
  f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS);
  f.wall(2000);
  const fresh = f.service.read({ force: true });
  expect(await oldRejected).toMatchObject({ name: "AbortError" });
  expect(calls).toBe(2);
  first.resolve(catalog(1000));
  await tick();
  expect(f.service.read({ force: true })).toBe(fresh);
  expect(calls).toBe(2);
  expect(f.calls.writes).toBe(0);
  next.resolve(catalog(2000));
  expect((await fresh).generatedAt).toBe(2000);
  expect((await f.service.read()).generatedAt).toBe(2000);
  expect(f.calls.writes).toBe(1);
});
test("retired late rejection is observed; failures clear a slot without stale-on-error success", async () => {
  const late = deferred<HarnessCatalogSnapshot>();
  let calls = 0;
  const unhandled: unknown[] = [];
  const handler = (e: unknown) => {
    unhandled.push(e);
  };
  process.on("unhandledRejection", handler);
  const f = fixture({
    loadHarnessCatalogSnapshot: async ({ now }) => {
      calls++;
      if (calls === 1) return late.promise;
      if (calls === 3) throw new Error("failed evaluation");
      return catalog(now());
    },
  });
  try {
    const old = f.service.read({ force: true });
    const rejected = old.catch(() => undefined);
    f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS);
    f.wall(2000);
    await f.service.read({ force: true });
    await rejected;
    late.reject(new Error("late rejected work"));
    await tick();
    await expect(f.service.read({ force: true })).rejects.toThrow(
      "failed evaluation",
    );
    expect(calls).toBe(3);
    f.wall(3000);
    expect((await f.service.read({ force: true })).generatedAt).toBe(3000);
    expect(calls).toBe(4);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", handler);
  }
});
test("zero TTL coalesces overlaps but reevaluates sequential reads; separate instances do not share flights", async () => {
  const gate = deferred();
  let calls = 0;
  const f = fixture({
    env: { OPENSCOUT_CAPABILITY_MATRIX_CACHE_TTL_MS: "0" },
    loadHarnessCatalogSnapshot: async ({ now }) => {
      calls++;
      await gate.promise;
      return catalog(now());
    },
  });
  const a = f.service.read({ force: true }),
    b = f.service.read({ force: true });
  expect(a).toBe(b);
  gate.resolve();
  await a;
  await f.service.read();
  expect(calls).toBe(2);
  expect(f.calls.writes).toBe(0);
  const other = fixture();
  await other.service.read({ force: true });
  expect(other.calls.catalog).toBe(1);
});
test("fresh memory is returned during force, negative readiness is cached, timestamp boundaries are unchanged", async () => {
  let calls = 0;
  const held = deferred();
  const f = fixture({
    loadHarnessCatalogSnapshot: async ({ now }) => {
      calls++;
      if (calls === 2) await held.promise;
      return catalog(now());
    },
  });
  const first = await f.service.read({ force: true });
  f.wall(1100);
  const force = f.service.read({ force: true });
  expect(await f.service.read()).toBe(first);
  held.resolve();
  await force;
  f.wall(61100);
  expect(await f.service.read()).toBe(await force);
  expect(calls).toBe(2);
  f.wall(61101);
  await f.service.read();
  expect(calls).toBe(3);
  const cursor = {
    ...findHarnessEntry("cursor")!,
    readinessReport: await evaluateHarnessReadinessAsync(
      findHarnessEntry("cursor")!,
      { whichBinary: () => "/fixture", runCommand: () => false },
    ),
  };
  const negative = fixture({
    loadHarnessCatalogSnapshot: async ({ now }) => ({
      version: 1,
      generatedAt: now(),
      entries: [{ ...cursor, source: "builtin" }],
    }),
  });
  const no = await negative.service.read({ force: true });
  expect(JSON.stringify(no)).toContain('"ready":false');
  expect(await negative.service.read()).toBe(no);
  expect(negative.calls.writes).toBe(1);
  negative.service.stop();
  await expect(negative.service.read()).rejects.toMatchObject({
    name: "AbortError",
  });
});
test("stop rejects immediately during a held child; direct work closes, later commands and reads refuse", async () => {
  const dir = root(),
    marker = join(dir, "entered"),
    path = join(dir, "sh"),
    count = join(dir, "commands");
  writeFileSync(
    path,
    `#!${process.execPath}\nimport{writeFileSync,appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(count)},'command\\n');writeFileSync(${JSON.stringify(marker)},'1');await Bun.sleep(10000);process.exit(0);`,
  );
  chmodSync(path, 0o755);
  process.env.PATH = dir;
  let work: Promise<HarnessCatalogSnapshot> | undefined,
    settled = false;
  const f = fixture({
    loadHarnessCatalogSnapshot: ({ signal, now }) => {
      const e = {
        ...findHarnessEntry("cursor")!,
        name: "fixture",
        readiness: { healthcheckCommand: "must-not-run-after-cancel" },
        install: { binary: "fixture", verify: "held" },
      };
      work = evaluateHarnessReadinessAsync(e, {
        whichBinary: () => "/fixture",
        signal,
      })
        .then(() => catalog(now()))
        .finally(() => {
          settled = true;
        });
      return work;
    },
  });
  const first = f.service.read({ force: true }),
    second = f.service.read({ force: true });
  const observed = Promise.allSettled([first, second]);
  await until(() => existsSync(marker));
  let parent = false;
  await new Promise<void>((resolve) =>
    setTimeout(() => {
      parent = true;
      resolve();
    }, 0),
  );
  expect(parent).toBe(true);
  expect(settled).toBe(false);
  f.service.stop();
  f.service.stop();
  const results = await observed;
  expect(results.every((x) => x.status === "rejected")).toBe(true);
  await expect(f.service.read()).rejects.toMatchObject({ name: "AbortError" });
  await expect(f.service.read({ force: true })).rejects.toMatchObject({
    name: "AbortError",
  });
  await work!.catch(() => undefined);
  expect(settled).toBe(true);
  expect(readFileSync(count, "utf8")).toBe("command\n");
  expect(f.calls.model).toBe(0);
  expect(f.calls.writes).toBe(0);
}, 15_000);
test("stop cancels owned MCP transport and prevents the next server spawn", async () => {
  const dir = root(),
    marker = join(dir, "first"),
    second = join(dir, "second");
  const script = join(dir, "mcp.ts");
  writeFileSync(
    script,
    `import{writeFileSync}from'node:fs';writeFileSync(process.argv[2], '1');await Bun.sleep(10000);`,
  );
  let finished = false;
  const f = fixture({
    discoverConfiguredMcpServers: async (options) => {
      try {
        return await discoverConfiguredMcpServers(options);
      } finally {
        finished = true;
      }
    },
    loadRuntimeMcpServerCatalog: async () => ({
      servers: [
        { id: "first", command: process.execPath, args: [script, marker] },
        { id: "second", command: process.execPath, args: [script, second] },
      ],
      warnings: [],
    }),
  });
  const read = f.service.read({ force: true });
  const handled = read.catch(() => undefined);
  await until(() => existsSync(marker));
  f.service.stop();
  await handled;
  await until(() => finished);
  expect(existsSync(second)).toBe(false);
  expect(f.calls.writes).toBe(0);
}, 15_000);
test("abandoned staged writes cannot rename/publish; stop prevents late mkdir completion from starting a write", async () => {
  const held = deferred();
  let writes = 0;
  const f = fixture({
    writeTextFile: async (path, content, encoding) => {
      writes++;
      if (writes === 1) await held.promise;
      await writeFile(path, content, encoding);
    },
  });
  const old = f.service.read({ force: true });
  const handled = old.catch(() => undefined);
  await until(() => writes === 1);
  f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS);
  f.wall(2000);
  await f.service.read({ force: true });
  held.resolve();
  await handled;
  await tick();
  await tick();
  expect(
    JSON.parse(readFileSync(join(f.dir, "matrix.json"), "utf8")).generatedAt,
  ).toBe(2000);
  expect((await f.service.read()).generatedAt).toBe(2000);
  const mkdirGate = deferred();
  let ensuring = false;
  const stopped = fixture({
    ensureDirectory: async () => {
      ensuring = true;
      await mkdirGate.promise;
    },
  });
  const pending = stopped.service.read({ force: true });
  const rejection = pending.catch(() => undefined);
  await until(() => ensuring);
  stopped.service.stop();
  await rejection;
  mkdirGate.resolve();
  await tick();
  expect(stopped.calls.writes).toBe(0);
});
test("already-issued rename commits are serialized; new publication wins after old commit completes", async () => {
  const held = deferred();
  let commits = 0;
  const f = fixture({
    renameFile: async (from, to) => {
      commits++;
      if (commits === 1) await held.promise;
      await rename(from, to);
    },
  });
  const old = f.service.read({ force: true }),
    observed = old.catch(() => undefined);
  await until(() => commits === 1);
  f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS);
  f.wall(2000);
  const next = f.service.read({ force: true });
  await until(() => f.calls.writes === 2);
  expect(commits).toBe(1);
  held.resolve();
  await observed;
  await next;
  expect(commits).toBe(2);
  expect(
    JSON.parse(readFileSync(join(f.dir, "matrix.json"), "utf8")).generatedAt,
  ).toBe(2000);
});
test("cache filesystem errors stay advisory; stop during a pending file read refuses its late hit", async () => {
  const f = fixture({
    writeTextFile: async () => {
      throw new Error("disk full");
    },
  });
  expect((await f.service.read({ force: true })).generatedAt).toBe(1000);
  const disk = deferred<string>();
  const g = fixture({ readTextFile: async () => disk.promise });
  const pending = g.service.read();
  const rejected = pending.catch((error) => error);
  g.service.stop();
  expect(await rejected).toMatchObject({ name: "AbortError" });
  disk.resolve(
    JSON.stringify({
      generatedAt: 1000,
      sources: [],
      capabilities: [],
      warnings: ["late"],
    }),
  );
  await tick();
  await expect(g.service.read()).rejects.toMatchObject({ name: "AbortError" });
  expect(g.calls.catalog).toBe(0);
});

test("MCP children inherit refresh-start env, not late ambient additions; server overrides still win", async () => {
  const dir = root(),
    marker = join(dir, "env.json"),
    script = join(dir, "env.ts"),
    gate = deferred();
  const keys = ["MATRIX_MCP_EXISTING", "MATRIX_MCP_ADDED"];
  const before = keys.map((key) => process.env[key]);
  process.env.MATRIX_MCP_EXISTING = "before";
  delete process.env.MATRIX_MCP_ADDED;
  writeFileSync(
    script,
    `import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify({existing:process.env.MATRIX_MCP_EXISTING,added:process.env.MATRIX_MCP_ADDED,override:process.env.MATRIX_MCP_OVERRIDE}));`,
  );
  const f = fixture({
    loadHarnessCatalogSnapshot: async ({ now }) => {
      await gate.promise;
      return catalog(now());
    },
    loadRuntimeMcpServerCatalog: async () => ({
      servers: [
        {
          id: "env",
          command: process.execPath,
          args: [script, marker],
          env: { MATRIX_MCP_OVERRIDE: "server" },
        },
      ],
      warnings: [],
    }),
  });
  try {
    const read = f.service.read({ force: true });
    process.env.MATRIX_MCP_EXISTING = "after";
    process.env.MATRIX_MCP_ADDED = "late";
    gate.resolve();
    await read;
    expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({
      existing: "before",
      override: "server",
    });
  } finally {
    for (let i = 0; i < keys.length; i++) {
      if (before[i] === undefined) delete process.env[keys[i]];
      else process.env[keys[i]] = before[i];
    }
  }
}, 15_000);

test("stop is not subtree absence: direct probe exits while its pipe-owning descendant lives", async () => {
  const dir = root(),
    parentFile = join(dir, "parent"),
    descendantFile = join(dir, "descendant"),
    release = join(dir, "release"),
    shell = join(dir, "sh");
  const descendant = `import{writeFileSync,existsSync,fstatSync}from'node:fs';const out=fstatSync(1);writeFileSync(${JSON.stringify(descendantFile)},JSON.stringify({pid:process.pid,stdoutIsPipe:out.isFIFO()||out.isSocket()}));const end=Date.now()+10000;setInterval(()=>{if(existsSync(${JSON.stringify(release)})||Date.now()>end)process.exit(0)},5);`;
  writeFileSync(
    shell,
    `#!${process.execPath}\nimport{spawn}from'node:child_process';import{writeFileSync}from'node:fs';spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});writeFileSync(${JSON.stringify(parentFile)},String(process.pid));setInterval(()=>{},1000);`,
  );
  chmodSync(shell, 0o755);
  process.env.PATH = dir;
  let work: Promise<HarnessCatalogSnapshot> | undefined,
    workSettled = false;
  const f = fixture({
    loadHarnessCatalogSnapshot: ({ now, signal }) => {
      const entry = {
        ...findHarnessEntry("cursor")!,
        name: "fixture",
        readiness: undefined,
        install: { binary: "fixture" },
      };
      work = evaluateHarnessReadinessAsync(entry, {
        signal,
      })
        .then(() => catalog(now()))
        .finally(() => {
          workSettled = true;
        });
      return work;
    },
  });
  const pending = f.service.read({ force: true }),
    observed = pending.catch((error) => error);
  let parent = 0,
    child = 0;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    await until(() => existsSync(parentFile) && existsSync(descendantFile));
    parent = Number(readFileSync(parentFile, "utf8"));
    child = JSON.parse(readFileSync(descendantFile, "utf8")).pid;
    expect(JSON.parse(readFileSync(descendantFile, "utf8")).stdoutIsPipe).toBe(
      true,
    );
    f.service.stop();
    expect(await observed).toMatchObject({ name: "AbortError" });
    await until(() => !alive(parent));
    expect(alive(child)).toBe(true);
    console.log(
      JSON.stringify({
        fixture: "catalog-subtree",
        bun: Bun.version,
        directExited: true,
        descendantAlive: true,
        workSettledBeforePipeRelease: workSettled,
      }),
    );
    expect(f.calls.writes).toBe(0);
    expect(f.calls.model).toBe(0);
  } finally {
    writeFileSync(release, "1");
    f.service.stop();
    if (!parent && existsSync(parentFile))
      parent = Number(readFileSync(parentFile, "utf8"));
    if (!child && existsSync(descendantFile))
      child = JSON.parse(readFileSync(descendantFile, "utf8")).pid;
    if (parent && alive(parent)) process.kill(parent, "SIGKILL");
    await work?.catch(() => undefined);
    if (child) await until(() => !alive(child));
  }
}, 15_000);

test("broker shutdown stops shared catalog owner before its first awaited drain", () => {
  const daemon = readFileSync(
    new URL("./broker-daemon.ts", import.meta.url),
    "utf8",
  );
  const shutdown = daemon.slice(
    daemon.indexOf("async function shutdownBroker("),
  );
  expect(shutdown.indexOf("capabilityMatrixService.stop();")).toBeGreaterThan(
    shutdown.indexOf("shuttingDown = true;"),
  );
  expect(shutdown.indexOf("capabilityMatrixService.stop();")).toBeLessThan(
    shutdown.indexOf("await "),
  );
});

test("an abort listener forcing a replacement joins it instead of starting it twice", async () => {
  const oldWork = deferred<HarnessCatalogSnapshot>();
  let calls = 0,
    reentered: Promise<unknown> | undefined;
  const f = fixture({
    loadHarnessCatalogSnapshot: async ({ signal, now }) => {
      calls++;
      if (calls === 1) {
        signal!.addEventListener(
          "abort",
          () => {
            reentered = f.service.read({ force: true });
          },
          { once: true },
        );
        return oldWork.promise;
      }
      return catalog(now());
    },
  });
  const old = f.service.read({ force: true }),
    observed = old.catch((error) => error);
  f.age(CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS);
  const fresh = f.service.read({ force: true });
  expect(reentered).toBe(fresh);
  await fresh;
  await reentered;
  expect(await observed).toMatchObject({ name: "AbortError" });
  expect(calls).toBe(2);
  expect(f.calls.writes).toBe(1);
  oldWork.resolve(catalog(0));
  await tick();
  expect(calls).toBe(2);
});

test("stop fences an injected loader's late rejection without an unhandled rejection", async () => {
  const work = deferred<HarnessCatalogSnapshot>();
  const unhandled: unknown[] = [];
  const handler = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", handler);
  try {
    const f = fixture({ loadHarnessCatalogSnapshot: async () => work.promise });
    const read = f.service.read({ force: true });
    const outcome = read.catch((error) => error);
    f.service.stop();
    expect(await outcome).toMatchObject({ name: "AbortError" });
    work.reject(new Error("late after stop"));
    await tick();
    await tick();
    expect(f.calls.model).toBe(0);
    expect(f.calls.writes).toBe(0);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", handler);
  }
});
