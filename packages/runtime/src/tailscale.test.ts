import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  readTailscalePeers,
  readTailscaleSelf,
  readTailscaleSelfWebHostsSync,
  readTailscaleSelfWebHosts,
  readTailscaleStatusSummary,
  tailscaleStatusProbe,
} from "./tailscale";
import { resetScoutdProbeClientForTests } from "./system-probes";

const originalFixturePath = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
const originalProbesSocket = process.env.OPENSCOUT_PROBES_SOCKET;
const tempDirectories = new Set<string>();
const tailscaleModuleUrl = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "tailscale.ts"),
).href;

beforeEach(() => {
  const directory = mkdtempSync(
    join(tmpdir(), "openscout-tailscale-probes-disabled-"),
  );
  tempDirectories.add(directory);
  process.env.OPENSCOUT_PROBES_SOCKET = join(directory, "missing.sock");
  resetScoutdProbeClientForTests();
  tailscaleStatusProbe.invalidate("test.reset");
});

afterEach(() => {
  tailscaleStatusProbe.invalidate("test.reset");
  if (originalFixturePath === undefined) {
    delete process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  } else {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = originalFixturePath;
  }
  if (originalProbesSocket === undefined) {
    delete process.env.OPENSCOUT_PROBES_SOCKET;
  } else {
    process.env.OPENSCOUT_PROBES_SOCKET = originalProbesSocket;
  }
  resetScoutdProbeClientForTests();

  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

function writeFixture(body: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "openscout-tailscale-"));
  tempDirectories.add(directory);
  const filePath = join(directory, "status.json");
  writeFileSync(filePath, JSON.stringify(body, null, 2), "utf8");
  return filePath;
}

function writeRawFixture(body: string): string {
  const directory = mkdtempSync(join(tmpdir(), "openscout-tailscale-"));
  tempDirectories.add(directory);
  const filePath = join(directory, "status.json");
  writeFileSync(filePath, body, "utf8");
  return filePath;
}

function writeExecutable(name: string, body: string): string {
  const directory = mkdtempSync(join(tmpdir(), "openscout-tailscale-"));
  tempDirectories.add(directory);
  const filePath = join(directory, name);
  writeFileSync(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

describe("tailscale status readers", () => {
  test("reads peer candidates and self identity from a status fixture", async () => {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = writeFixture({
      BackendState: "Stopped",
      Health: ["Tailscale is stopped."],
      Self: {
        ID: "self-node",
        HostName: "workstation",
        DNSName: "workstation.tailnet.ts.net.",
        TailscaleIPs: ["100.64.0.10"],
        Online: true,
        OS: "macOS",
      },
      CurrentTailnet: {
        Name: "example.tailnet",
        MagicDNSSuffix: "tailnet.ts.net",
      },
      Peer: {
        peerA: {
          ID: "peer-a",
          HostName: "laptop",
          DNSName: "laptop.tailnet.ts.net.",
          TailscaleIPs: ["100.64.0.11"],
          Online: true,
          OS: "macOS",
          Tags: ["tag:dev"],
        },
      },
    });

    const [peers, self, summary] = await Promise.all([
      readTailscalePeers(),
      readTailscaleSelf(),
      readTailscaleStatusSummary(),
    ]);

    expect(peers).toEqual([
      {
        id: "peer-a",
        name: "laptop",
        dnsName: "laptop.tailnet.ts.net.",
        addresses: ["100.64.0.11"],
        online: true,
        hostName: "laptop",
        os: "macOS",
        tags: ["tag:dev"],
      },
    ]);

    expect(self).toEqual({
      id: "self-node",
      name: "workstation",
      dnsName: "workstation.tailnet.ts.net.",
      addresses: ["100.64.0.10"],
      online: true,
      hostName: "workstation",
      os: "macOS",
      tailnetName: "example.tailnet",
      magicDnsSuffix: "tailnet.ts.net",
    });

    expect(summary).toEqual({
      backendState: "Stopped",
      running: false,
      health: ["Tailscale is stopped."],
      peers,
      self,
    });

    expect(readTailscaleSelfWebHostsSync()).toEqual([]);
  });

  test("reads tailnet web hosts from a running self identity", () => {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = writeFixture({
      BackendState: "Running",
      Self: {
        ID: "self-node",
        HostName: "workstation",
        DNSName: "workstation.tailnet.ts.net.",
        TailscaleIPs: ["100.64.0.10"],
        Online: true,
        OS: "macOS",
      },
      CurrentTailnet: {
        Name: "example.tailnet",
        MagicDNSSuffix: "tailnet.ts.net",
      },
    });

    expect(readTailscaleSelfWebHostsSync()).toEqual([
      "workstation.tailnet.ts.net",
      "100.64.0.10",
    ]);
  });

  test("captures noisy sync tailscale status stderr", () => {
    const tailscale = writeExecutable(
      "tailscale",
      `#!/bin/sh
if [ "$1" = "status" ]; then
  echo 'Warning: client version "1.96.4-t41cb72f27" != tailscaled server version "1.94.1-t62c6f1cd7-g09fea6572"' >&2
  cat <<'JSON'
{"BackendState":"Running","Self":{"ID":"self-node","HostName":"workstation","DNSName":"workstation.tailnet.ts.net.","TailscaleIPs":["100.64.0.10"],"Online":true}}
JSON
  exit 0
fi
exit 64
`,
    );
    // First-launch validation of a new executable is not the status reader's
    // stderr-capture contract. Warm only this owned fixture, outside its unchanged
    // 1500ms production timeout, and prove the fixture really emits the warning.
    const fixture = spawnSync(tailscale, ["status", "--json"], {
      encoding: "utf8",
    });
    expect(fixture.status).toBe(0);
    expect(fixture.stderr).toContain("client version");
    const env = {
      ...process.env,
      OPENSCOUT_TAILSCALE_AUTO_HOSTS: "1",
      OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS: undefined,
      OPENSCOUT_TAILSCALE_BIN: tailscale,
    };
    delete env.OPENSCOUT_TAILSCALE_STATUS_JSON;

    const result = spawnSync(
      "bun",
      [
        "--silent",
        "-e",
        `import { readTailscaleSelfWebHostsSync } from ${JSON.stringify(tailscaleModuleUrl)};
const hosts = readTailscaleSelfWebHostsSync();
const expected = ${JSON.stringify(
          JSON.stringify(["workstation.tailnet.ts.net", "100.64.0.10"]),
        )};
if (JSON.stringify(hosts) !== expected) {
  console.error(\`unexpected hosts: \${JSON.stringify(hosts)}\`);
  process.exit(3);
}`,
      ],
      {
        encoding: "utf8",
        env,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("client version");
    expect(result.stderr).not.toContain("tailscaled server version");
  });

  test("treats malformed status fixtures as unavailable", async () => {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON =
      writeRawFixture("not valid json");

    await expect(readTailscaleStatusSummary()).resolves.toBeNull();
    await expect(readTailscalePeers()).resolves.toEqual([]);
    await expect(readTailscaleSelf()).resolves.toBeNull();
  });
});

const readerEnvKeys = [
  "OPENSCOUT_TAILSCALE_BIN",
  "OPENSCOUT_TAILSCALE_AUTO_HOSTS",
  "OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS",
  "OPENSCOUT_TAILSCALE_STATUS_JSON",
] as const;
const fixtureHosts = ["fixture.tailnet.ts.net", "100.64.0.42"];
const runningStatus = {
  BackendState: "Running",
  Self: {
    ID: "fixture",
    DNSName: "fixture.tailnet.ts.net.",
    TailscaleIPs: ["100.64.0.42"],
  },
};
async function withProcessHostEnv<T>(
  env: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(
    readerEnvKeys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of readerEnvKeys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return await body();
  } finally {
    for (const key of readerEnvKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}
async function untilHost(check: () => boolean) {
  for (let i = 0; i < 4000 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(check()).toBe(true);
}
async function hostCommand(
  initial: {
    gate?: boolean;
    exit?: number;
    raw?: string;
    status?: unknown;
    noise?: boolean;
    ignoreTerm?: boolean;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "openscout-tailscale-async-"));
  tempDirectories.add(directory);
  const binary = join(directory, "tailscale"),
    script = join(directory, "child.js");
  const config = join(directory, "config.json"),
    count = join(directory, "count.jsonl");
  const started = join(directory, "started"),
    gate = join(directory, "release");
  const configure = (value: typeof initial) =>
    writeFileSync(config, JSON.stringify(value));
  configure(initial);
  writeFileSync(
    script,
    `import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
if (process.argv[2] !== '--fixture-warmup') {
  appendFileSync(${JSON.stringify(count)}, JSON.stringify(process.argv.slice(2))+'\\n');
  ${initial.ignoreTerm ? "process.on('SIGTERM', ()=>{});" : ""}
  writeFileSync(${JSON.stringify(started)}, String(process.pid));
  const config=JSON.parse(readFileSync(${JSON.stringify(config)},'utf8'));
  while(config.gate && !existsSync(${JSON.stringify(gate)})) await new Promise(r=>setTimeout(r,1));
  if(config.noise) process.stderr.write('owned fixture warning\\n');
  process.stdout.write(config.raw ?? JSON.stringify(config.status ?? ${JSON.stringify(runningStatus)}));
  process.exitCode=config.exit ?? 0;
}
`,
  );
  writeFileSync(
    binary,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`,
  );
  chmodSync(binary, 0o755);
  // Warm validation of this owned executable separately, without changing the
  // production reader's 1500ms budget or pretending resolution failure is lag.
  await new Promise<void>((yes, no) =>
    execFile(binary, ["--fixture-warmup"], { timeout: 8000 }, (error) =>
      error ? no(error) : yes(),
    ),
  );
  return {
    binary,
    started,
    gate,
    configure,
    env: {
      OPENSCOUT_TAILSCALE_BIN: binary,
      OPENSCOUT_TAILSCALE_AUTO_HOSTS: "1",
    },
    count: () =>
      existsSync(count)
        ? readFileSync(count, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : [],
    release: () => writeFileSync(gate, "release"),
  };
}

describe("asynchronous Tailscale host reader", () => {
  test("gated real child leaves the parent loop responsive before lookup completion", async () => {
    const child = await hostCommand({ gate: true });
    let progress = false,
      heldTicks = 0,
      progressAtCompletion = false;
    const pulse = setInterval(() => {
      if (existsSync(child.started) && ++heldTicks >= 3) {
        progress = true;
        child.release();
      }
    }, 1);
    let work: Promise<string[]> | undefined;
    try {
      work = readTailscaleSelfWebHosts(child.env);
      const hosts = await work.then((value) => {
        progressAtCompletion = progress;
        return value;
      });
      expect(existsSync(child.started)).toBe(true); // fail here means an invalid instrument
      expect(progressAtCompletion).toBe(true); // old sync control must fail HERE
      expect(hosts).toEqual(fixtureHosts);
      expect(child.count()).toEqual([["status", "--json"]]);
    } finally {
      clearInterval(pulse);
      child.release();
      await work;
    }
  }, 20_000);

  test("concurrent same-key reads share one real command and completed success with sync", async () => {
    const child = await hostCommand({ gate: true, noise: true });
    await withProcessHostEnv(child.env, async () => {
      const a = readTailscaleSelfWebHosts(),
        b = readTailscaleSelfWebHosts();
      try {
        await untilHost(() => existsSync(child.started));
        expect(child.count()).toHaveLength(1);
      } finally {
        child.release();
        await Promise.all([a, b]);
      }
      expect(await a).toEqual(fixtureHosts);
      expect(await b).toEqual(fixtureHosts);
      expect(readTailscaleSelfWebHostsSync()).toEqual(fixtureHosts);
      expect(child.count()).toHaveLength(1);
    });
  }, 20_000);

  test("sync success warms the async cache without a second command", async () => {
    const child = await hostCommand();
    await withProcessHostEnv(child.env, async () => {
      expect(readTailscaleSelfWebHostsSync()).toEqual(fixtureHosts);
      expect(await readTailscaleSelfWebHosts()).toEqual(fixtureHosts);
      expect(child.count()).toHaveLength(1);
    });
  }, 20_000);

  for (const mode of ["exit", "malformed", "stopped"] as const)
    test(`failed/unavailable ${mode} lookup is cached for async and sync callers`, async () => {
      const child = await hostCommand(
        mode === "exit"
          ? { exit: 1 }
          : mode === "malformed"
            ? { raw: "invalid" }
            : { status: { ...runningStatus, BackendState: "Stopped" } },
      );
      await withProcessHostEnv(child.env, async () => {
        expect(await readTailscaleSelfWebHosts()).toEqual([]);
        child.configure({});
        expect(await readTailscaleSelfWebHosts()).toEqual([]);
        expect(readTailscaleSelfWebHostsSync()).toEqual([]);
        expect(child.count()).toHaveLength(1);
      });
    }, 20_000);

  test("custom env reads bypass completed cache but coalesce identical in-flight execution keys", async () => {
    const child = await hostCommand({ gate: true });
    const a = readTailscaleSelfWebHosts(child.env),
      b = readTailscaleSelfWebHosts({ ...child.env });
    try {
      await untilHost(() => existsSync(child.started));
      expect(child.count()).toHaveLength(1);
    } finally {
      child.release();
      await Promise.all([a, b]);
    }
    expect(await readTailscaleSelfWebHosts(child.env)).toEqual(fixtureHosts);
    expect(child.count()).toHaveLength(2);
    await withProcessHostEnv(child.env, async () => {
      // A custom-env result did not populate the process-env cache.
      expect(await readTailscaleSelfWebHosts()).toEqual(fixtureHosts);
      expect(child.count()).toHaveLength(3);
      expect(await readTailscaleSelfWebHosts({})).toEqual([]);
      expect(child.count()).toHaveLength(3);
    });
  }, 20_000);

  test("disabled and fixture modes bypass commands and completed cache", async () => {
    const child = await hostCommand();
    expect(
      await readTailscaleSelfWebHosts({
        ...child.env,
        OPENSCOUT_TAILSCALE_AUTO_HOSTS: "0",
      }),
    ).toEqual([]);
    const path = writeFixture(runningStatus);
    const env = { ...child.env, OPENSCOUT_TAILSCALE_STATUS_JSON: path };
    expect(await readTailscaleSelfWebHosts(env)).toEqual(fixtureHosts);
    writeFileSync(path, "invalid");
    expect(await readTailscaleSelfWebHosts(env)).toEqual([]);
    writeFileSync(path, JSON.stringify(runningStatus));
    expect(await readTailscaleSelfWebHosts(env)).toEqual(fixtureHosts);
    expect(
      await readTailscaleSelfWebHosts({
        ...env,
        OPENSCOUT_TAILSCALE_STATUS_JSON: path + "-absent",
      }),
    ).toEqual([]);
    expect(child.count()).toHaveLength(0);
  }, 20_000);

  test("cache key retains raw timeout/auto flags and the thirty-second failure TTL", async () => {
    const child = await hostCommand({ exit: 1 });
    await withProcessHostEnv(child.env, async () => {
      expect(await readTailscaleSelfWebHosts()).toEqual([]);
      child.configure({});
      const now = Date.now;
      try {
        Date.now = () => now() + 30_001;
        expect(await readTailscaleSelfWebHosts()).toEqual(fixtureHosts);
      } finally {
        Date.now = now;
      }
      process.env.OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS = "1501";
      expect(await readTailscaleSelfWebHosts()).toEqual(fixtureHosts);
      process.env.OPENSCOUT_TAILSCALE_AUTO_HOSTS = "yes";
      expect(await readTailscaleSelfWebHosts()).toEqual(fixtureHosts);
      expect(child.count()).toHaveLength(4);
    });
  }, 20_000);

  test("missing binary failure is cached even if the path appears before expiry", async () => {
    const child = await hostCommand();
    const missing = child.binary + "-missing";
    await withProcessHostEnv(
      { ...child.env, OPENSCOUT_TAILSCALE_BIN: missing },
      async () => {
        expect(await readTailscaleSelfWebHosts()).toEqual([]);
        writeFileSync(missing, readFileSync(child.binary));
        chmodSync(missing, 0o755);
        expect(await readTailscaleSelfWebHosts()).toEqual([]);
        expect(readTailscaleSelfWebHostsSync()).toEqual([]);
        expect(child.count()).toHaveLength(0);
      },
    );
  }, 20_000);

  test("retained sync failure also warms the async negative cache", async () => {
    const child = await hostCommand({ exit: 1 });
    await withProcessHostEnv(child.env, async () => {
      expect(readTailscaleSelfWebHostsSync()).toEqual([]);
      child.configure({});
      expect(await readTailscaleSelfWebHosts()).toEqual([]);
      expect(child.count()).toHaveLength(1);
    });
  }, 20_000);

  test("a newer sync result is not overwritten by an older async completion", async () => {
    const child = await hostCommand({ gate: true });
    await withProcessHostEnv(child.env, async () => {
      const old = readTailscaleSelfWebHosts();
      try {
        await untilHost(() => existsSync(child.started));
        child.configure({
          status: {
            ...runningStatus,
            Self: { ...runningStatus.Self, DNSName: "new.ts.net." },
          },
        });
        expect(readTailscaleSelfWebHostsSync()).toEqual([
          "new.ts.net",
          "100.64.0.42",
        ]);
      } finally {
        child.release();
        await old;
      }
      expect(await old).toEqual(fixtureHosts);
      expect(await readTailscaleSelfWebHosts()).toEqual([
        "new.ts.net",
        "100.64.0.42",
      ]);
      expect(child.count()).toHaveLength(2);
    });
  }, 20_000);

  test("timeout settles even when the held child ignores SIGTERM", async () => {
    const child = await hostCommand({ gate: true, ignoreTerm: true });
    const work = readTailscaleSelfWebHosts({
      ...child.env,
      OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS: "1500",
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await untilHost(() => existsSync(child.started));
      const result = await Promise.race([
        work.then((hosts) => ({ hosts, settled: true })),
        new Promise<{ hosts: string[]; settled: boolean }>((resolve) => {
          deadline = setTimeout(() => resolve({ hosts: [], settled: false }), 4000);
        }),
      ]);
      expect(result.settled).toBe(true);
      expect(result.hosts).toEqual([]);
      const pid = Number(readFileSync(child.started, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      clearTimeout(deadline);
      if (existsSync(child.started)) {
        const pid = Number(readFileSync(child.started, "utf8"));
        try {
          process.kill(pid, "SIGKILL");
        } catch {} // The timeout should already have reaped this owned child.
      }
      child.release();
      await work;
    }
  }, 20_000);

  test("configured timeout fails closed and reaps the exact held child", async () => {
    const child = await hostCommand({ gate: true });
    try {
      expect(
        await readTailscaleSelfWebHosts({
          ...child.env,
          OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS: "1500",
        }),
      ).toEqual([]);
      expect(existsSync(child.started)).toBe(true);
      const pid = Number(readFileSync(child.started, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      child.release();
    }
  }, 20_000);
});
