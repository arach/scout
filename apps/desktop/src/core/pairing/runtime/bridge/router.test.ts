import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { pairedRouterFixture } from "../../../../../../../scripts/fixtures/paired-router-context.ts";

import type { Bridge } from "./bridge.ts";
import { bridgeRouter, lookupMobileInboxItemForEvent } from "./router.ts";
import type { SessionState } from "@openscout/agent-sessions";

// Durable fixture setup is separate from the bounded resolver/Noise tests.
setDefaultTimeout(30_000);
let transports: ReturnType<typeof pairedRouterFixture>;
beforeAll(() => { transports = pairedRouterFixture(); }, 120_000);
afterAll(() => transports?.dispose());

function createBridgeStub() {
  const replayCalls: string[] = [];
  const currentSeqCalls: string[] = [];
  const oldestBufferedSeqCalls: string[] = [];

  const bridge = {
    getSessionSummaries() {
      return [
        {
          sessionId: "older-session",
          name: "Older",
          adapterType: "codex",
          status: "active",
          turnCount: 1,
          currentTurnStatus: null,
          startedAt: 100,
          lastActivityAt: 100,
        },
        {
          sessionId: "latest-session",
          name: "Latest",
          adapterType: "codex",
          status: "active",
          turnCount: 2,
          currentTurnStatus: null,
          startedAt: 200,
          lastActivityAt: 200,
        },
      ];
    },
    listSessions() {
      return [{ sessionId: "older-session" }, { sessionId: "latest-session" }];
    },
    replay(sessionId: string, afterSeq: number) {
      replayCalls.push(sessionId);
      return [{ seq: afterSeq + 1, event: { event: "session:closed", sessionId }, timestamp: 1_000 }];
    },
    currentSeq(sessionId: string) {
      currentSeqCalls.push(sessionId);
      return sessionId === "latest-session" ? 42 : 7;
    },
    oldestBufferedSeq(sessionId: string) {
      oldestBufferedSeqCalls.push(sessionId);
      return sessionId === "latest-session" ? 9 : 3;
    },
  } as unknown as Bridge;

  return {
    bridge,
    replayCalls,
    currentSeqCalls,
    oldestBufferedSeqCalls,
  };
}

const disposeCallers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposeCallers.splice(0)) dispose();
});

function createCaller(
  bridge: Bridge,
  context: {
    deviceId?: string;
    secureTransport?: boolean;
    trustedPeer?: boolean;
    reconnectRoom?: string;
    relayUrls?: string[];
  } = {},
) {
  const fixture = transports.bind({ bridge, cwd: "/tmp/openscout", ...context });
  disposeCallers.push(fixture.dispose);
  return bridgeRouter.createCaller(fixture.ctx);
}

describe("mobile reconnect coordinates", () => {
  test.each(["paired-without-device-id", "local-service"] as const)(
    "mobile.endpoints refuses a live %s context at its paired-device gate", async (kind) => {
      const { bridge } = createBridgeStub();
      const fixture = transports.bind({ bridge, cwd: "/tmp/scout",
        deviceId: kind === "local-service" ? "local-reader" : undefined,
      }, { local: kind === "local-service" });
      disposeCallers.push(fixture.dispose);
      const caller = bridgeRouter.createCaller(fixture.ctx);
      // Prove the opaque transport passed the real outer live guard first.
      expect(await caller.sync.status()).toMatchObject({ sessionCount: 2 });
      await expect(caller.mobile.endpoints()).rejects.toMatchObject({
        code: "UNAUTHORIZED", message: "Trusted encrypted mobile transport required",
      });
    },
  );

  test("requires a trusted encrypted transport and reports its reconnect room", async () => {
    const { bridge } = createBridgeStub();
    await expect(bridgeRouter.createCaller({ bridge, cwd: "/tmp/scout" }).mobile.endpoints())
      .rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Live authenticated transport required" });
    await expect(bridgeRouter.createCaller({ bridge, cwd: "/tmp/scout", deviceId: "phone",
      secureTransport: true, trustedPeer: true }).mobile.endpoints())
      .rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Live authenticated transport required" });
    const caller = createCaller(bridge, { deviceId: "phone",
      secureTransport: true, trustedPeer: true, reconnectRoom: "stable-reconnect-room",
      relayUrls: ["wss://relay.example.test"] });
    const result = await caller.mobile.endpoints();
    expect(result.relay.reconnectRoom).toBe("stable-reconnect-room");
    expect(result.endpoints.relayUrls).toEqual(["wss://relay.example.test"]);
  });
});

describe("bridgeRouter sync compatibility", () => {
  test("sync.status falls back to the most recent session when sessionId is omitted", async () => {
    const stub = createBridgeStub();

    const result = await createCaller(stub.bridge).sync.status();

    expect(result).toEqual({
      currentSeq: 42,
      oldestBufferedSeq: 9,
      sessionCount: 2,
    });
    expect(stub.currentSeqCalls).toEqual(["latest-session"]);
    expect(stub.oldestBufferedSeqCalls).toEqual(["latest-session"]);
  });

  test("sync.status returns empty counters when there are no sessions", async () => {
    const bridge = {
      getSessionSummaries() {
        return [];
      },
      listSessions() {
        return [];
      },
    } as unknown as Bridge;

    const result = await createCaller(bridge).sync.status();

    expect(result).toEqual({
      currentSeq: 0,
      oldestBufferedSeq: 0,
      sessionCount: 0,
    });
  });

  test("sync.replay falls back to the most recent session when sessionId is omitted", async () => {
    const stub = createBridgeStub();

    const result = await createCaller(stub.bridge).sync.replay({ lastSeq: 11 });

    expect(result.events).toEqual([
      { seq: 12, event: { event: "session:closed", sessionId: "latest-session" }, timestamp: 1_000 },
    ]);
    expect(stub.replayCalls).toEqual(["latest-session"]);
  });
});

describe("bridgeRouter mobile inbox", () => {
  test("projects session attention items, not only approval requests", async () => {
    const snapshot: SessionState = {
      session: {
        id: "session-attention",
        name: "Attention session",
        adapterType: "claude-code",
        status: "active",
      },
      currentTurnId: "turn-1",
      turns: [
        {
          id: "turn-1",
          status: "streaming",
          startedAt: 1_000,
          blocks: [
            {
              status: "streaming",
              block: {
                id: "question-1",
                turnId: "turn-1",
                type: "question",
                status: "streaming",
                index: 0,
                header: "Pick a path",
                question: "Which implementation should the agent use?",
                options: [{ label: "Simple" }],
                multiSelect: false,
                questionStatus: "awaiting_answer",
              },
            },
            {
              status: "streaming",
              block: {
                id: "action-1",
                turnId: "turn-1",
                type: "action",
                status: "streaming",
                index: 1,
                action: {
                  kind: "command",
                  command: "npm test",
                  output: "",
                  status: "awaiting_approval",
                  approval: {
                    version: 2,
                    description: "Run npm test",
                    risk: "medium",
                  },
                },
              },
            },
          ],
        },
      ],
    };

    const bridge = {
      getSessionSummaries() {
        return [
          {
            sessionId: snapshot.session.id,
            name: snapshot.session.name,
            adapterType: snapshot.session.adapterType,
            status: snapshot.session.status,
            turnCount: snapshot.turns.length,
            currentTurnStatus: "streaming",
            startedAt: 1_000,
            lastActivityAt: 1_000,
          },
        ];
      },
      getSessionSnapshot(sessionId: string) {
        return sessionId === snapshot.session.id ? snapshot : null;
      },
    } as unknown as Bridge;

    const result = await createCaller(bridge).mobile.inbox();

    expect(result.items.map((item) => item.kind).sort()).toEqual(["approval", "question"]);

    const question = result.items.find((item) => item.kind === "question");
    expect(question).toMatchObject({
      id: "session-question:session-attention:turn-1:question-1",
      title: "Pick a path",
      turnId: "turn-1",
      blockId: "question-1",
      version: null,
    });
    expect(question?.actionKind).toBeUndefined();
    expect(question?.actionStatus).toBeUndefined();

    const approval = result.items.find((item) => item.kind === "approval");
    expect(approval).toMatchObject({
      id: "approval:session-attention:turn-1:action-1:v2",
      title: "Approve Command",
      turnId: "turn-1",
      blockId: "action-1",
      version: 2,
      actionKind: "command",
      actionStatus: "awaiting_approval",
    });

    const eventItem = lookupMobileInboxItemForEvent(bridge, {
      event: "block:start",
      sessionId: snapshot.session.id,
      turnId: "turn-1",
      block: snapshot.turns[0]!.blocks[0]!.block,
    });
    expect(eventItem?.kind).toBe("question");
  });
});

describe("bridgeRouter terminal permission compatibility", () => {
  test.each(["approve", "deny"] as const)("%s returns the canonical refusal for a non-terminal item without host access", async (decision) => {
    const caller = createCaller(createBridgeStub().bridge);

    const result = await caller.mobile.answerTerminalPermission({
      itemId: "session-attention:synthetic",
      version: 1,
      decision,
    });

    expect(result).toEqual({
      ok: false,
      code: "not_found",
      message: "That isn't a terminal permission prompt.",
    });
  });

  test.each([
    { version: 1.5, decision: "approve" },
    { version: 1, decision: "allow" },
  ])("rejects invalid permission input %j before invoking the helper", async (input) => {
    const caller = createCaller(createBridgeStub().bridge);
    // The non-terminal item also makes the fixture non-actuating if validation regresses.
    const invalid = { itemId: "session-attention:synthetic", ...input };

    await expect(caller.mobile.answerTerminalPermission(
      invalid as Parameters<typeof caller.mobile.answerTerminalPermission>[0],
    )).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
