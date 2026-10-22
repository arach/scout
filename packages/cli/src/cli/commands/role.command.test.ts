import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScoutOutput } from "../output.ts";
import { runRoleCommand } from "./role.ts";

// A runtime with no web app beside it: every role and mission-log command must
// reach the runtime's /v1 API and nothing else.

type Seen = { method: string; path: string; body: unknown };
const seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let socketServer: ReturnType<typeof Bun.serve>;
let socketRoot: string;

const ASSIGNMENT = { id: "ra-1", roleId: "orchestrator", agentId: "hudson", scope: { kind: "mission", missionId: "m-1" }, active: true };

beforeAll(() => {
  socketRoot = mkdtempSync(join(tmpdir(), "role-api-"));
  const handler = {
    async fetch(request: Request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json() : undefined;
      seen.push({ method: request.method, path: url.pathname + url.search, body });
      if (url.pathname === "/v1/roles/catalog") return Response.json({ roles: [{ id: "orchestrator", label: "Orchestrator", summary: "Runs the mission" }] });
      if (url.pathname === "/v1/roles/assignments" && request.method === "GET") return Response.json({ assignments: [ASSIGNMENT] });
      if (url.pathname === "/v1/roles/assignments") {
        if ((body as { agentId?: string }).agentId === "taken") return Response.json({ error: "mission m-1 already has orchestrator hudson" }, { status: 400 });
        return Response.json({ assignment: ASSIGNMENT }, { status: 201 });
      }
      if (url.pathname === "/v1/roles/assignments/ra-1/revoke") return Response.json({ assignment: { ...ASSIGNMENT, active: false } });
      if (url.pathname === "/v1/missions/m-1/log" && request.method === "GET") {
        return Response.json({ missionId: "m-1", entries: [{ seq: 1, kind: "status", intent: "build", status: "started", actorId: "hudson" }] });
      }
      if (url.pathname === "/v1/missions/m-1/log") return Response.json({ entry: { seq: 2, kind: "status", status: "done" } });
      if (url.pathname === "/v1/missions/m-2/log") return Response.json({ error: "roles_unavailable", detail: "control-plane roles store not open" }, { status: 503 });
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  };
  server = Bun.serve({ port: 0, ...handler });
  socketServer = Bun.serve({ unix: join(socketRoot, "runtime.sock"), ...handler });
});

afterAll(() => {
  server.stop(true);
  socketServer.stop(true);
  rmSync(socketRoot, { recursive: true, force: true });
});

function run(args: string[], transport: "tcp" | "unix") {
  const lines: string[] = [];
  const output: ScoutOutput = {
    mode: "plain",
    writeText: (text: string) => { lines.push(text); },
    writeValue: () => {},
  } as unknown as ScoutOutput;
  const context = {
    cwd: "/tmp/current",
    // the web URL points nowhere: a command that still needed the web app would fail
    env: {
      OPENSCOUT_BROKER_URL: transport === "unix" ? "http://127.0.0.1:9" : `http://127.0.0.1:${server.port}`,
      OPENSCOUT_BROKER_SOCKET_PATH: transport === "unix" ? join(socketRoot, "runtime.sock") : undefined,
      OPENSCOUT_WEB_URL: "http://127.0.0.1:9",
      OPENSCOUT_WEB_PORT: "9",
    },
    stdout: () => {},
    stderr: () => {},
    output,
    isTty: false,
  };
  return runRoleCommand(context as never, args).then(() => lines);
}

for (const transport of ["tcp", "unix"] as const) {
  const runForTransport = (args: string[]) => run(args, transport);
  describe(`scout role without a web app (${transport})`, () => {
    test("every command goes to the runtime's /v1 API", async () => {
      seen.length = 0;
      expect(await runForTransport(["catalog"])).toEqual(["orchestrator\tOrchestrator\tRuns the mission"]);
      expect(await runForTransport(["list", "--mission", "m-1"])).toEqual(["ra-1\torchestrator\thudson\tmission:m-1\tactive"]);
      expect(await runForTransport(["assign", "--role", "orchestrator", "--agent", "hudson", "--mission", "m-1"])).toEqual(["Assigned orchestrator → hudson (ra-1)"]);
      expect(await runForTransport(["revoke", "ra-1"])).toEqual(["Revoked ra-1"]);
      expect(await runForTransport(["log", "m-1"])).toEqual(["1\tstatus\tbuild\tstarted\thudson"]);
      expect(await runForTransport(["log-append", "m-1", "--actor", "hudson", "--kind", "status", "--intent", "build", "--status", "done"])).toEqual(["Logged seq=2 status: done"]);

      expect(seen.map((s) => `${s.method} ${s.path.split("?")[0]}`)).toEqual([
        "GET /v1/roles/catalog",
        "GET /v1/roles/assignments",
        "POST /v1/roles/assignments",
        "POST /v1/roles/assignments/ra-1/revoke",
        "GET /v1/missions/m-1/log",
        "POST /v1/missions/m-1/log",
      ]);
      expect(seen.every((s) => s.path.startsWith("/v1/"))).toBe(true);
    });

    test("the runtime's own error reaches the operator", async () => {
      await expect(runForTransport(["assign", "--role", "orchestrator", "--agent", "taken", "--mission", "m-1"])).rejects.toThrow("mission m-1 already has orchestrator hudson");
      await expect(runForTransport(["log", "m-2"])).rejects.toThrow("Roles are unavailable");
    });
  });
}
