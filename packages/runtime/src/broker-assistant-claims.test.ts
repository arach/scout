import { describe, expect, test } from "bun:test";
import type { ActiveScoutBrokerService } from "./broker-api.js";
import { BrokerAssistantClaims, protectAssistantService } from "./broker-assistant-claims.js";

function fixture() {
  let now = 100;
  const claims = new BrokerAssistantClaims(["scoutbot"], { ttlMs: 30, now: () => now });
  return { claims, advance: (ms: number) => { now += ms; } };
}

describe("broker assistant answerer leases", () => {
  test("only one claimant, even with the same non-secret holder id", () => {
    const { claims } = fixture();
    const first = claims.acquire("scoutbot", "process-1");
    expect(first.token).toHaveLength(64);
    expect(() => claims.acquire("scoutbot", "process-2")).toThrow("assistant_claim_busy");
    expect(() => claims.acquire("scoutbot", "process-1")).toThrow("assistant_claim_busy");
    expect(JSON.stringify(claims.capability())).not.toContain(first.token);
    expect(() => claims.acquire("other-agent", "process-2")).toThrow("unsupported_assistant_identity");
  });

  test("renew requires the token; death expires the holder and fences all late answers", async () => {
    const { claims, advance } = fixture();
    const first = claims.acquire("scoutbot", "first");
    expect(() => claims.renew("scoutbot")).toThrow("assistant_claim_required");
    expect(() => claims.withToken("wrong", () => claims.renew("scoutbot"))).toThrow("assistant_claim_lost");
    advance(20);
    claims.withToken(first.token, () => claims.renew("scoutbot"));
    advance(20);
    expect(() => claims.acquire("scoutbot", "second")).toThrow("assistant_claim_busy");
    advance(10); // No renewal: the holder can be dead or alive but disconnected.
    expect(() => claims.withToken(first.token, () => claims.renew("scoutbot"))).toThrow("assistant_claim_lost");
    const next = claims.acquire("scoutbot", "second");
    expect(next.token).not.toBe(first.token);
    let writes = 0;
    await expect(claims.withToken(first.token, () => claims.admit("scoutbot", async () => ++writes))).rejects.toThrow("assistant_claim_lost");
    await claims.withToken(next.token, () => claims.admit("scoutbot", async () => ++writes));
    expect(writes).toBe(1);
  });

  test.each(["expiry", "release"])("an admitted write pins ownership through %s, before any replacement", async (mode) => {
    const { claims, advance } = fixture();
    const first = claims.acquire("scoutbot", "first");
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const admitted = claims.withToken(first.token, () => claims.admit("scoutbot", () => pending));
    if (mode === "expiry") advance(31);
    else expect(claims.withToken(first.token, () => claims.release("scoutbot")).draining).toBe(true);
    expect(() => claims.acquire("scoutbot", "second")).toThrow("assistant_claim_busy");
    await expect(claims.withToken(first.token, () => claims.admit("scoutbot", async () => {}))).rejects.toThrow("assistant_claim_lost");
    finish(); await admitted;
    expect(claims.acquire("scoutbot", "second").token).not.toBe(first.token);
  });

  test("failed writes release their admission pin; broker restart invalidates old tokens", async () => {
    const { claims, advance } = fixture(); const first = claims.acquire("scoutbot", "first");
    await expect(claims.withToken(first.token, () => claims.admit("scoutbot", async () => { throw new Error("write failed"); }))).rejects.toThrow("write failed");
    advance(31); const next = claims.acquire("scoutbot", "next");
    const restarted = new BrokerAssistantClaims(["scoutbot"]);
    restarted.acquire("scoutbot", "next");
    await expect(restarted.withToken(next.token, () => restarted.admit("scoutbot", async () => {}))).rejects.toThrow("assistant_claim_lost");
  });

  test("release cannot revoke a different holder; no token leaks into mutations", async () => {
    const { claims } = fixture(); const first = claims.acquire("scoutbot", "first");
    expect(() => claims.withToken("other", () => claims.release("scoutbot"))).toThrow("assistant_claim_lost");
    const messages: unknown[] = [];
    const service = protectAssistantService({ postConversationMessage: async message => { messages.push(message); }, executeCommand: async () => {} } as unknown as ActiveScoutBrokerService, claims);
    const message = { actorId: "scoutbot", body: "answer", metadata: { source: "scoutbot" } } as any;
    await claims.withToken(first.token, () => service.postConversationMessage!(message));
    expect(messages).toEqual([message]); expect(JSON.stringify(messages)).not.toContain(first.token);
    expect(claims.withToken(first.token, () => claims.release("scoutbot")).draining).toBe(false);
    expect(claims.acquire("scoutbot", "second").token).not.toBe(first.token);
  });
});

describe("common client boundary", () => {
  const commands: any[] = [
    { kind: "actor.upsert", actor: { id: "scoutbot" } },
    { kind: "agent.upsert", agent: { id: "scoutbot" } },
    { kind: "agent.endpoint.upsert", endpoint: { agentId: "scoutbot" } },
    { kind: "conversation.post", message: { actorId: "scoutbot" } },
    { kind: "agent.invoke", invocation: { requesterId: "operator", metadata: { source: "scoutbot" } } },
  ];
  test.each(commands)("unclaimed command is refused before mutation (%j)", async command => {
    const { claims } = fixture(); let writes = 0;
    const service = protectAssistantService({ executeCommand: async () => ++writes } as unknown as ActiveScoutBrokerService, claims);
    await expect(service.executeCommand(command)).rejects.toThrow("assistant_claim_required"); expect(writes).toBe(0);
    const lease = claims.acquire("scoutbot", "first");
    await claims.withToken(lease.token, () => service.executeCommand(command)); expect(writes).toBe(1);
  });

  test("answers without a claim are rejected even before the first claim and with forged metadata", async () => {
    const { claims } = fixture(); let writes = 0;
    const service = protectAssistantService({ postConversationMessage: async () => ++writes, executeCommand: async () => ++writes } as unknown as ActiveScoutBrokerService, claims);
    const message = { actorId: "scoutbot", metadata: { assistantClaim: "fake", completionReply: { version: 1 } } } as any;
    await expect(service.postConversationMessage!(message)).rejects.toThrow("assistant_claim_required");
    claims.acquire("scoutbot", "first");
    await expect(service.postConversationMessage!(message)).rejects.toThrow("assistant_claim_required"); expect(writes).toBe(0);
  });

  test("legacy web delegations require the claim, ordinary asks to the assistant do not", async () => {
    const { claims } = fixture(); let writes = 0;
    const service = protectAssistantService({
      executeCommand: async () => {}, invokeAgent: async () => ++writes, deliver: async () => (++writes, { kind: "test" }),
    } as unknown as ActiveScoutBrokerService, claims);
    await service.invokeAgent!({ requesterId: "operator", targetAgentId: "scoutbot" } as any);
    await service.deliver!({ requesterId: "operator", target: { kind: "agent_id", agentId: "scoutbot" } } as any);
    expect(writes).toBe(2);
    for (const key of ["source", "generatedBy"]) {
      await expect(service.invokeAgent!({ requesterId: "operator", metadata: { [key]: "scoutbot" } } as any)).rejects.toThrow("assistant_claim_required");
      await expect(service.deliver!({ requesterId: "operator", messageMetadata: { [key]: "scoutbot" } } as any)).rejects.toThrow("assistant_claim_required");
    }
    const lease = claims.acquire("scoutbot", "first");
    await claims.withToken(lease.token, () => service.invokeAgent!({ requesterId: "operator", metadata: { source: "scoutbot" } } as any));
    expect(writes).toBe(3);
  });

  test("parallel request contexts do not lend their token to unclaimed requests", async () => {
    const { claims } = fixture(); const lease = claims.acquire("scoutbot", "first");
    let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; });
    let writes = 0;
    const service = protectAssistantService({ executeCommand: async () => { writes++; await pending; } } as unknown as ActiveScoutBrokerService, claims);
    const first = claims.withToken(lease.token, () => service.executeCommand(commands[0]));
    await expect(service.executeCommand(commands[0])).rejects.toThrow("assistant_claim_required");
    finish(); await first; expect(writes).toBe(1);
  });
});
