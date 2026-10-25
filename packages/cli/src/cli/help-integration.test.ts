import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readinessBootstrapImports, readinessWarmupExit, warmReadinessFixture } from "./test-fixtures/warm-readiness-fixture.ts";

const entry = fileURLToPath(new URL("../main.ts", import.meta.url));

// File creation and import-only warming are fixture setup, not the behavior
// under test. Each argv still invokes the real entry once with the throwing
// maintenance preload; no warm-up runs help/status or caches their output.
for (const args of [[], ["--help"], ["--version"], ["doctor", "--help"], ["help", "doctor"], ["relay", "doctor", "--help"], ["setup", "--help"], ["runtimes", "--help"], ["status"], ["help", "--detail"], ["help", "not-a-command"]]) {
  const name = `help and plain status never enter startup maintenance: ${JSON.stringify(args)}`;
  describe(name, () => {
    let directory: string;
    let preload: string;
    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), "scout-help-test-"));
      preload = join(directory, "no-maintenance.ts");
      await writeFile(preload, `import { mock } from "bun:test";
        mock.module(${JSON.stringify(fileURLToPath(new URL("./broker-update.ts", import.meta.url)))}, () => ({
          brokerUpdateDebugEnabled: () => false,
          ensureBrokerUptodate: () => { throw new Error("HELP TRIGGERED MAINTENANCE"); },
        }));`);
      const command = args.includes("--help")
        ? args.find(arg => ["setup", "doctor", "runtimes"].includes(arg)) : undefined;
      const imports = [...readinessBootstrapImports, ...(command
        ? [fileURLToPath(new URL(`./commands/${command}.ts`, import.meta.url))] : [])];
      const warmup = join(directory, "imports-only.ts");
      await writeFile(warmup, `import ${JSON.stringify(preload)};
        ${readinessWarmupExit(imports)}
        throw new Error("This fixture only warms imports");`);
      await warmReadinessFixture(warmup);
    });
    afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
    test(name, async () => {
      const child = Bun.spawn([process.execPath, "--preload", preload, entry, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (args[1] === "not-a-command") {
        expect(code).toBe(1);
        expect(stderr).toContain("unknown command: not-a-command");
      } else {
        expect({ args, stderr, code }).toEqual({ args, stderr: "", code: 0 });
        expect(stdout.length).toBeGreaterThan(0);
      }
    });
  });
}

describe("source worker fixture", () => {
  let directory: string;
  let fixture: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "scout-core-worker-test-"));
    fixture = join(directory, "fixture.ts");
    await writeFile(fixture, `import { expect } from "bun:test";
      import { runDoctorCheck } from ${JSON.stringify(fileURLToPath(new URL("./doctor-checks.ts", import.meta.url)))};
      import { healthyCoreReport } from ${JSON.stringify(fileURLToPath(new URL("./test-fixtures/core-report.ts", import.meta.url)))};
      ${readinessWarmupExit(readinessBootstrapImports)}
      let reads = 0;
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
        expect(new URL(request.url).pathname).toBe("/health"); reads++;
        return Response.json(healthyCoreReport().service.health.payload);
      } });
      try {
        const check = await runDoctorCheck("broker", {
          timeoutMs: 2000, cwd: process.cwd(),
          env: { ...process.env, OPENSCOUT_BROKER_URL: server.url.href, OPENSCOUT_BROKER_SOCKET_PATH: "", OPENSCOUT_NODE_ID: "node-test" },
          command: [process.execPath, ${JSON.stringify(entry)}, "__doctor-check", "broker"],
        });
        expect(check).toMatchObject({ name: "broker", state: "working" });
        expect(check.detail).toContain("Scout core is available."); expect(reads).toBe(1);
      } finally { server.stop(true); }
      process.exit(0);`);
    await warmReadinessFixture(fixture, { cwd: directory });
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  test("source worker round trip observes only selected core health", async () => {
    const child = Bun.spawn([process.execPath, fixture], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ stdout, stderr, code }).toEqual({ stdout: "", stderr: "", code: 0 });
    } finally { clearTimeout(timer); child.kill(); }
  }, 10_000);
});

describe("streamed doctor fixture", () => {
  let directory: string;
  let fixture: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "scout-doctor-output-test-"));
    fixture = join(directory, "fixture.ts");
    const checksModule = fileURLToPath(new URL("./doctor-checks.ts", import.meta.url));
    const mainModule = fileURLToPath(new URL("./main.ts", import.meta.url));
    await writeFile(fixture, `import { mock } from "bun:test";
      import * as actual from ${JSON.stringify(checksModule)};
      const runCheck = actual.runDoctorCheck;
      mock.module(${JSON.stringify(checksModule)}, () => ({ ...actual,
        runDoctorCheck: (name, input) => runCheck(name, { ...input, timeoutMs: 1000 }),
        collectDoctorCheck: async name => {
          if (name === "native") return new Promise(() => setInterval(() => {}, 1000));
          return {name, state: name === "probes" ? "impaired" : "working",
            detail: name === "probes" ? "Probe observation failed." : "Check completed.",
            ...(name === "probes" ? {next: "scout doctor --detail"} : {})};
        },
      }));
      ${readinessWarmupExit([...readinessBootstrapImports, fileURLToPath(new URL("./commands/doctor.ts", import.meta.url))])}
      await import(${JSON.stringify(mainModule)});`);
    await warmReadinessFixture(fixture);
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  test("default doctor streams partial results and finishes with a concise assessment", async () => {
    const child = Bun.spawn([process.execPath, fixture, "doctor"], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ stderr, code }).toEqual({ stderr: "", code: 0 });
    expect(stdout).toContain("OK broker: Check completed.");
    expect(stdout).toContain("FAIL probes: Probe observation failed.");
    expect(stdout).toContain("? native: No result within 1s");
    expect(stdout.indexOf("OK broker:")).toBeLessThan(stdout.indexOf("? native:"));
    expect(stdout).toContain("3 working, 1 impaired, 1 inconclusive");
    expect(stdout).toContain("Next: scout doctor --detail");
    expect(stdout.split("\n").length).toBeLessThan(17);
    expect(stdout).not.toContain("Discovering projects");
  });
});
