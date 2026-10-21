import { failedDelivery } from "../../client/screens/requests/request-delivery.ts";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  stubs,
  createOpenScoutWebServer,
  makeBrokerDiagnostics,
  makeA2aBrokerContext,
  makePairingState,
  makeStaticRoot,
  sessionSnapshotWithAttention,
  upsertScoutConversationCalls,
  useIsolatedOpenScoutHome,
  installWebServerTestHooks,
  loadWebServerUnderTest,
} from "../web-server-test-harness.ts";

// Loads the server modules behind the harness mocks (see the harness for why
// this is awaited here rather than at the harness top level).
await loadWebServerUnderTest();
installWebServerTestHooks();

describe("createOpenScoutWebServer: attention routes", () => {
  test("shares a full attention refresh across concurrent and back-to-back polls", async () => {
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot(),
    });
    const before = stubs.getPairingStateCalls;
    const url = "http://localhost/api/operator-attention";
    const responses = await Promise.all(Array.from({ length: 5 }, () => server.app.request(url)));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect((await server.app.request(url)).status).toBe(200);
    expect(stubs.getPairingStateCalls - before).toBe(1);
  });

  test("suggests the current Scout MCP ask permission only for the current tool", async () => {
    stubs.brokerDiagnosticsResult = makeBrokerDiagnostics({
      totals: {
        successfulDispatches: 0,
        failedQueries: 0,
        failedDeliveries: 2,
        deliveryAttempts: 0,
        failedDeliveryAttempts: 0,
        dialogueMessages: 0,
      },
      failedDeliveries: [
        {
          id: "delivery:new-ask",
          kind: "failed_delivery",
          status: "failed",
          ts: 1_700_000_000_000,
          actorName: null,
          target: "claude-review",
          route: "mcp",
          detail: "Claude blocked mcp__scout__ask until permission is allowed.",
          conversationId: "c.claude-review",
          messageId: "msg-1",
          deliveryId: "delivery-1",
          invocationId: "inv-1",
          metadata: null,
        },
        {
          id: "delivery:old-invocation-ask",
          kind: "failed_delivery",
          status: "failed",
          ts: 1_700_000_000_001,
          actorName: null,
          target: "legacy-review",
          route: "mcp",
          detail: "Claude blocked mcp__scout__invocations_ask until permission is allowed.",
          conversationId: "c.legacy-review",
          messageId: "msg-2",
          deliveryId: "delivery-2",
          invocationId: "inv-2",
          metadata: null,
        },
      ],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{
        id: string;
        agentName: string | null;
        actions: Array<{ kind: string; value?: string }>;
      }>;
    };
    const askPermissionItems = body.items.filter((item) =>
      item.id.startsWith("config:mcp-scout-ask:"),
    );

    expect(askPermissionItems).toHaveLength(1);
    expect(askPermissionItems[0]?.agentName).toBe("claude-review");
    expect(askPermissionItems[0]?.actions).toContainEqual(
      expect.objectContaining({
        kind: "copy",
        value: "/allow mcp__scout__ask",
      }),
    );
    expect(body.items.some((item) => item.agentName === "legacy-review")).toBe(false);
  });

  test("includes session attention in operator attention and dedupes pairing approvals", async () => {
    useIsolatedOpenScoutHome();
    const { snapshot, approval } = sessionSnapshotWithAttention();
    stubs.pairingStateResult = makePairingState({
      pendingApprovals: [approval],
    });
    stubs.pairingSessionSnapshotsResult = [snapshot];

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      totals: { approvals: number; collaboration: number };
      items: Array<{
        id: string;
        kind: string;
        title: string;
        sourceLabel: string;
        actions: Array<{ kind: string; route?: Record<string, string> }>;
      }>;
    };
    const approvalId = "approval:pairing-session-1:turn-1:cmd-approval:v3";

    expect(body.totals.approvals).toBe(1);
    expect(body.items.filter((item) => item.id === approvalId)).toHaveLength(1);
    expect(body.items.find((item) => item.id === approvalId)?.actions)
      .toEqual([
        expect.objectContaining({ kind: "approve" }),
        expect.objectContaining({ kind: "deny" }),
        expect.objectContaining({
          kind: "open",
          route: expect.objectContaining({
            view: "follow",
            sessionId: "pairing-session-1",
            preferredView: "session",
          }),
        }),
      ]);
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-question:pairing-session-1:turn-1:question-1",
        kind: "question",
        title: "Deploy",
        sourceLabel: "codex question",
      }),
      expect.objectContaining({
        id: "session-action-failed:pairing-session-1:turn-1:tool-failed",
        kind: "session",
        title: "Tool call failed",
        sourceLabel: "codex action",
      }),
    ]));
    expect(body.items.find((item) => item.id === "session-action-failed:pairing-session-1:turn-1:tool-failed")?.actions)
      .toEqual([
        expect.objectContaining({
          kind: "open",
          route: expect.objectContaining({
            view: "follow",
            sessionId: "pairing-session-1",
            preferredView: "session",
          }),
        }),
      ]);
  });

  test("renders Claude Scout permission hints without a settings detour", async () => {
    const createdAt = 1_700_000_000_000;
    stubs.brokerDiagnosticsResult = makeBrokerDiagnostics({
      failedQueries: [{
        id: "failed-query-1",
        ts: createdAt,
        target: "claude.main",
        conversationId: "conv-claude",
        detail: "Claude blocked scout ask because allowedTools does not include Bash(scout:*).",
      }],
    });

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{
        id: string;
        title: string;
        detail: string | null;
        actions: Array<{ kind: string; label: string; route?: Record<string, string>; value?: string }>;
      }>;
    };
    const item = body.items.find((entry) => entry.id === "config:scout-ask-cli:failed-query-1");
    expect(item).toMatchObject({
      title: "Claude needs Scout CLI permission",
      detail: expect.stringContaining("Claude-session permission"),
      actions: [
        expect.objectContaining({
          kind: "copy",
          label: "Copy Claude fix",
          value: `{ "allowedTools": ["Bash(scout:*)"] }`,
        }),
        expect.objectContaining({
          kind: "open",
          label: "Open thread",
          route: { view: "conversation", conversationId: "conv-claude" },
        }),
      ],
    });
    expect(item?.actions.some((action) => action.kind === "configure")).toBe(false);
    expect(item?.actions.some((action) => action.route?.view === "settings")).toBe(false);
  });

  test("does not resurrect dismissed failed asks in operator attention", async () => {
    const now = 1_700_000_000_000;
    const failedAsk = (id: string, attention: "badge" | "silent") => ({
      invocationId: id,
      flightId: `flight-${id}`,
      agentId: "agent-1",
      agentName: "Agent One",
      conversationId: "conv-1",
      collaborationRecordId: null,
      task: `Task ${id}`,
      status: "failed",
      statusLabel: "Interrupted",
      acknowledgedAt: null,
      attention,
      agentState: "not_ready",
      harness: "claude",
      transport: "claude_stream_json",
      summary: `Summary ${id}`,
      startedAt: now - 2_000,
      updatedAt: now - 1_000,
    });
    stubs.queryFleetResult = {
      generatedAt: now,
      totals: { active: 0, recentCompleted: 2, needsAttention: 0, activity: 0 },
      activeAsks: [],
      recentCompleted: [
        failedAsk("inv-dismissed", "silent"),
        failedAsk("inv-visible", "badge"),
      ],
      needsAttention: [],
      activity: [],
    };

    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as {
      items: Array<{ id: string }>;
    };
    const ids = body.items.map((item) => item.id);
    expect(ids).not.toContain("ask:inv-dismissed");
    expect(ids).toContain("ask:inv-visible");
  });

  test("lists declared operator questions until the operator replies", async () => {
    const now = Date.now();
    const need = (id: string, conversationId: string, createdAt: number) => ({
      id, conversationId, actorId: "agent-1", body: "Ship to staging or prod?", createdAt,
      metadata: { operatorSignal: { kind: "need", question: "Ship to staging or prod?", options: ["staging", "prod"], blockedReason: "Deploy is ready" } },
    });
    stubs.scoutBrokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {
        actors: { "agent-1": { id: "agent-1", displayName: "Agent One" } },
        conversations: {},
        flights: {},
        messages: {
          open: need("msg-open", "chn-open", now - 60_000),
          answered: need("msg-answered", "c.answered", now - 120_000),
          reply: { id: "msg-reply", conversationId: "c.answered", actorId: "operator", body: "staging", createdAt: now - 30_000 },
        },
      },
    };
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });
    const response = await server.app.request("http://localhost/api/operator-attention");

    expect(response.status).toBe(200);
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    const questions = body.items.filter((item) => String(item.id).startsWith("need:"));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: "need:msg-open",
      kind: "question",
      title: "Ship to staging or prod?",
      summary: "Blocked: Deploy is ready",
      agentName: "Agent One",
      conversationId: "chn-open",
      answer: { conversationId: "chn-open", replyToMessageId: "msg-open", options: ["staging", "prod"] },
    });
  });

  test("persists a dismissed conversation failure on the broker conversation", async () => {
    stubs.scoutBrokerContextResult = {
      baseUrl: "http://broker.test",
      node: { id: "node-1" },
      snapshot: {
        conversations: {
          "c.agent-1": {
            id: "c.agent-1",
            kind: "direct",
            title: "Agent One",
            participantIds: ["operator", "agent-1"],
            metadata: { existing: "kept" },
          },
        },
        flights: {},
      },
    };
    const server = await createOpenScoutWebServer({
      currentDirectory: "/tmp/openscout",
      assetMode: "static",
      staticRoot: makeStaticRoot(),
    });

    const response = await server.app.request("http://localhost/api/operator-attention/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c.agent-1",
        messageId: "msg-1",
        itemUpdatedAt: 1_700_000_000_000,
      }),
    });

    expect(response.status).toBe(200);
    expect(upsertScoutConversationCalls).toHaveLength(1);
    expect(upsertScoutConversationCalls[0]).toMatchObject({
      id: "c.agent-1",
      metadata: {
        existing: "kept",
        operatorAttentionDismissedMessageId: "msg-1",
        operatorAttentionItemUpdatedAt: 1_700_000_000_000,
        operatorAttentionDismissedBy: "operator",
      },
    });
    expect(
      (upsertScoutConversationCalls[0]?.metadata as Record<string, unknown>)
        .operatorAttentionDismissedAt,
    ).toEqual(expect.any(Number));
  });

  describe("Herdr continuation", () => {
    const BASH_PERMISSION = `
 Bash command

   bun test packages/web/server

 Permission rule Bash(bun:*) requires confirmation for this command.

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for this command
   3. No

 Esc to cancel · Tab to amend
`;
    const herdrPane = {
      paneId: "w1:p2",
      terminalId: "term-p2",
      tabId: "w1:t1",
      workspaceId: "w1",
      label: "claude · openscout",
      agent: "claude",
      agentStatus: "blocked" as const,
      agentSession: null,
      cwd: "/Users/art/dev/openscout",
      foregroundCwd: "/Users/art/dev/openscout",
      focused: true,
      scroll: null,
    };
    const readTopology = async () => ({
      session: "default",
      running: true,
      observedAt: 1,
      workspaces: [{
        workspaceId: "w1",
        label: "main",
        number: 1,
        focused: true,
        activeTabId: "w1:t1",
        agentStatus: "blocked" as const,
        tabs: [{
          tabId: "w1:t1",
          workspaceId: "w1",
          label: "build",
          number: 1,
          focused: true,
          agentStatus: "blocked" as const,
          panes: [herdrPane],
          layout: null,
        }],
      }],
    });

    async function withOpenScoutHome<T>(home: string, run: () => Promise<T>): Promise<T> {
      const previous = process.env.OPENSCOUT_HOME;
      process.env.OPENSCOUT_HOME = home;
      try {
        return await run();
      } finally {
        if (previous === undefined) delete process.env.OPENSCOUT_HOME;
        else process.env.OPENSCOUT_HOME = previous;
      }
    }

    test("without a grant, surfaces the prompt and never sends keys", async () => {
      const home = join(useIsolatedOpenScoutHome(), ".openscout");
      const sent: unknown[] = [];
      await withOpenScoutHome(home, async () => {
        const server = await createOpenScoutWebServer({
          currentDirectory: "/tmp/openscout",
          assetMode: "static",
          staticRoot: makeStaticRoot(),
          herdrContinuation: {
            listSessions: async () => [{ name: "default", running: true }],
            readTopology,
            capture: async () => BASH_PERMISSION,
            sendKeys: async (...args) => {
              sent.push(args);
            },
          },
        });
        const response = await server.app.request("http://localhost/api/operator-attention");
        const attention = await response.json() as {
          items: Array<{ id: string; summary: string | null; actions: Array<{ route?: Record<string, string> }> }>;
        };
        const item = attention.items.find((entry) => entry.id === "herdr-continuation:default:term-p2");
        expect(item?.summary).toBe("bun test packages/web/server");
        expect(item?.actions[0]?.route).toMatchObject({
          view: "terminal",
          terminalBackend: "herdr",
          terminalSessionName: "default",
        });
      });
      expect(sent).toEqual([]);
      expect(existsSync(join(home, "logs", "continuation-audit.jsonl"))).toBe(false);
    });

    test("with a session grant, sends Yes once, audits it, and drops the row", async () => {
      const home = join(useIsolatedOpenScoutHome(), ".openscout");
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "continuation-policy.json"), JSON.stringify({
        version: 1,
        grants: [{ scope: "session", herdrSession: "default", paneId: "w1:p2", level: "workspace" }],
      }));
      const sent: Array<{ session: string; target: string; keys: readonly string[] }> = [];
      await withOpenScoutHome(home, async () => {
        const server = await createOpenScoutWebServer({
          currentDirectory: "/tmp/openscout",
          assetMode: "static",
          staticRoot: makeStaticRoot(),
          herdrContinuation: {
            listSessions: async () => [{ name: "default", running: true }],
            readTopology,
            capture: async () => BASH_PERMISSION,
            sendKeys: async (session, target, keys) => {
              sent.push({ session, target, keys });
            },
          },
        });
        const response = await server.app.request("http://localhost/api/operator-attention");
        const attention = await response.json() as { items: Array<{ id: string }> };
        expect(attention.items.find((entry) => entry.id === "herdr-continuation:default:term-p2")).toBeUndefined();
      });
      expect(sent).toEqual([{ session: "default", target: "term-p2", keys: ["enter"] }]);
      const audit = readFileSync(join(home, "logs", "continuation-audit.jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line) as { outcome: string; grant: string });
      expect(audit.map((entry) => entry.outcome)).toEqual(["attempt", "sent"]);
      expect(audit[0]?.grant).toBe("session:default:w1:p2");
    });
  });
});

describe("managed permission decisions", () => {
  test("existing API forwards exact request/version/scope to the broker", async () => {
    const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
    for (const decision of ["once", "project", "deny"]) {
      const response = await server.app.request("http://localhost/api/operator-attention/permissions/decide", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "permission-1", version: "fingerprint", decision }),
      });
      expect(response.status).toBe(200);
    }
    expect(stubs.permissionDecisions.map(value => value.decision)).toEqual(["once", "project", "deny"]);
  });
  test("malformed and dead-session decisions never report success", async () => {
    const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
    const post = (body: unknown) => server.app.request("http://localhost/api/operator-attention/permissions/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await post({ requestId: "p", version: "v", decision: "all" })).status).toBe(400);
    expect(stubs.permissionDecisions).toHaveLength(0);
    stubs.permissionDecisionFailure = true;
    const response = await post({ requestId: "p", version: "v", decision: "once" });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "Permission request has no live waiting process" });
  });
});

test("durable managed permissions project exact prompt, flight and project with backed scopes", async () => {
  stubs.scoutBrokerContextResult = { baseUrl: "http://broker.test", node: { id: "node-1" }, snapshot: {
    actors: { agent: { id: "agent", displayName: "Claude" } }, agents: {}, conversations: {}, flights: {}, messages: {}, endpoints: {},
    collaborationRecords: { p: { id: "p", kind: "question", state: "open", acceptanceState: "none", title: "Permission request",
      summary: "Exact permission prompt", createdById: "agent", ownerId: "operator", nextMoveOwnerId: "operator", conversationId: "chn-test",
      createdAt: Date.now(), updatedAt: Date.now(), metadata: { permissionRequest: { sessionId: "tmux-1", projectRoot: "/tmp/project", flightId: "flt-1", version: "v1", decisions: ["once", "project", "deny"] } },
    } },
  } };
  const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
  const response = await server.app.request("http://localhost/api/operator-attention");
  expect(response.status).toBe(200);
  const body = await response.json() as { items: Array<{ id: string; permission?: unknown; summary: string; actions: Array<{ label: string }> }> };
  const item = body.items.find(item => item.id === "permission:p");
  expect(item?.summary).toBe("Exact permission prompt");
  expect(item?.permission).toEqual({ requestId: "p", version: "v1", sessionId: "tmux-1", projectRoot: "/tmp/project", flightId: "flt-1" });
  expect(item?.actions.map(action => action.label)).toEqual(["Allow once", "Allow for project", "Deny", "Open conversation"]);
});


test("a cold broker snapshot does not duplicate a managed permission as an unactionable fleet question", async () => {
  stubs.scoutBrokerContextResult = null;
  stubs.queryFleetResult = {
    generatedAt: Date.now(), totals: { active: 0, recentCompleted: 0, needsAttention: 1, activity: 0 },
    activeAsks: [], recentCompleted: [], activity: [],
    needsAttention: [{ recordId: "permission-cold-test", kind: "question", title: "Permission request", state: "open", acceptanceState: "none", agentId: "test", updatedAt: Date.now(), conversationId: "chn-test" }],
  };
  const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
  const response = await server.app.request("http://localhost/api/operator-attention");
  const body = await response.json() as { items: Array<{ id: string }> };
  expect(body.items.some(item => item.id === "question:permission-cold-test")).toBe(false);
});

test("unconfirmed broker actuation remains unconfirmed in the client delivery model", async () => {
  stubs.permissionDecisionUnconfirmed = true;
  const server = await createOpenScoutWebServer({ currentDirectory: "/tmp/openscout", assetMode: "static", staticRoot: makeStaticRoot() });
  const response = await server.app.request("http://localhost/api/operator-attention/permissions/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "p", version: "v", decision: "once" }) });
  expect(response.status).toBe(502);
  const body = await response.json() as { error: string };
  expect(failedDelivery("Allow once", Object.assign(new Error(body.error), { status: response.status }), "Failed").state).toBe("unconfirmed");
});


test("an invalidated old capture cannot overwrite the postdecision attention cache", async () => {
  const attention = await import("../core/attention/operator-attention-state.ts");
  const broker = makeA2aBrokerContext({ agent: { capabilities: [] } });
  attention.invalidateAgentAttentionSnapshot();
  stubs.queryAgentsResult = [{ id: "agent-race", name: "Claude", harness: "claude", transport: "tmux", state: "waiting", terminalSurface: { backend: "tmux", sessionName: "pane-race" } }];
  let started!: () => void;
  const capturing = new Promise<void>(resolve => { started = resolve; });
  let release!: (value: { body: string }) => void;
  let calls = 0;
  const capture = (async () => {
    if (++calls === 1) { started(); return new Promise(resolve => { release = resolve; }); }
    return { body: "ready" };
  }) as Parameters<typeof attention.queryAgentAttentionSnapshot>[1];
  const old = attention.queryAgentAttentionSnapshot(broker, capture);
  await capturing;
  attention.invalidateAgentAttentionSnapshot();
  const fresh = await attention.queryAgentAttentionSnapshot(broker, capture);
  expect(fresh.hostItems).toHaveLength(0);
  release({ body: "Bash command\nls\nPermission rule Bash requires confirmation for this command.\nDo you want to proceed?\n1. Yes\n2. No\nEsc to cancel · Tab to amend" });
  expect((await old).hostItems).toHaveLength(1);
  expect(await attention.queryAgentAttentionSnapshot(broker, capture)).toBe(fresh);
  expect(calls).toBe(2);
});
