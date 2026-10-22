import { describe, expect, test } from "bun:test";
import { herdrHostAttentionJournalConformanceCases as cases,
  type HerdrHostAttentionJournal, type HerdrHostAttentionJournalClaim as Row,
  type HerdrHostAttentionJournalAudit as Audit, type HerdrHostAttentionJournalIntent as Intent,
  type HerdrHostAttentionJournalConformanceHarness as Harness } from "./host-attention.js";

type Fault = "memory" | "ttl" | "unsynced-audit" | "unsynced-intent" | "weak-cas" | "generic-device" | "ignore-sync";
type State = { claims: Map<string, Row>; audit: Audit[]; intents: Intent[] };
/** Test-only model extracted from the kernel's synthetic Map journal. durable
 * is a simulated sync boundary, not evidence of real fsync. No export, no store
 * shipped to callers. The private host must supply its actual storage/crash hooks.
 */
async function model(fault?: Fault): Promise<Harness> {
  const empty = (): State => ({ claims: new Map(), audit: [], intents: [] });
  let state = empty(), durable = empty(), now = 0, next = 0;
  let fail: "claim" | "intent" | undefined;
  const sync = (operation: "claim" | "intent" | "finalize") => {
    if (fail === operation && fault !== "ignore-sync") { fail = undefined; throw Error("injected fsync failure"); }
    if (fault === "memory") return;
    const snapshot = structuredClone(state);
    if (fault === "unsynced-audit") snapshot.audit = structuredClone(durable.audit);
    if (fault === "unsynced-intent") snapshot.intents = structuredClone(durable.intents);
    durable = snapshot;
  };
  const connect = (deviceId: string): HerdrHostAttentionJournal => {
    const owns = (row: Parameters<HerdrHostAttentionJournal["writeSendIntent"]>[0], owner: Parameters<HerdrHostAttentionJournal["writeSendIntent"]>[1]) => {
      const current = state.claims.get(row.paneKey);
      return !!current && (fault === "weak-cas" || (current.owner.id === owner.id && current.owner.attemptId === owner.attemptId && owner.attemptId === row.attemptId));
    };
    return {
      async admit(attempt, { signal }) {
        if (signal.aborted) return { ok: false, reason: "claim_unavailable" };
        const held = state.claims.get(attempt.paneKey);
        if (fault === "ttl" && held && now - held.preparedAt > 30_000) state.claims.delete(attempt.paneKey);
        if (state.claims.has(attempt.paneKey)) return { ok: false, reason: "claimed_elsewhere" };
        const owner = { id: `claim-${++next}`, attemptId: attempt.attemptId };
        state.claims.set(attempt.paneKey, { schema: "scout.herdr-answer-claim/v1", attempt: structuredClone(attempt), owner, preparedAt: now });
        sync("claim"); return { ok: true, claim: { ...owner } };
      },
      async writeSendIntent(attempt, owner, { signal }) {
        if (signal.aborted || !owns(attempt, owner)) return { ok: false, reason: "claim_unavailable" };
        state.intents.push({ schema: "scout.herdr-answer-intent/v1", attempt: structuredClone(attempt), owner: { ...owner }, committedAt: now });
        state.audit.push({ schema: "scout.herdr-answer-audit/v1", attempt: structuredClone(attempt), owner: { ...owner },
          deviceId: fault === "generic-device" ? "operator:remote" : deviceId, committedAt: now });
        sync("intent"); return { ok: true };
      },
      async finalize(input, { signal }) {
        if (signal.aborted) return { status: "unavailable" };
        if (!owns(input.attempt, input.claim)) return { status: "not_owner" };
        if (input.disposition !== "retain_unresolved") state.claims.delete(input.attempt.paneKey);
        sync("finalize"); return { status: "settled" };
      },
    };
  };
  return { connect, async crash() { state = structuredClone(durable); },
    async advanceTime(ms) { now += ms; },
    async readAudit() { return structuredClone(state.audit); },
    async readIntents() { return structuredClone(state.intents); },
    async failNextSync(operation) { fail = operation; }, async close() {},
  };
}

describe("reusable Herdr journal conformance instrument", () => {
  for (const entry of cases) test(entry.name, () => entry.run(() => model()));
  test("case names are unique and stable for host test registration", () => {
    expect(new Set(cases.map(c => c.name)).size).toBe(cases.length);
  });
  const teeth: Array<[Fault, string[]]> = [
    ["memory", ["claim acknowledgement survives loss of un-synced writes", "intent and matching audit survive loss of un-synced appends", "ambiguous send survives crash and age without silent retry"]],
    ["ttl", ["unresolved intent never expires as a TTL claim", "ambiguous send survives crash and age without silent retry"]],
    ["unsynced-audit", ["intent and matching audit survive loss of un-synced appends"]],
    ["unsynced-intent", ["intent and matching audit survive loss of un-synced appends"]],
    ["weak-cas", ["owner-token CAS compares both fields for intent and finalization", "late old owner cannot mutate a replacement claim"]],
    ["generic-device", ["audit binds actual device and attempt owner before input", "intent and matching audit survive loss of un-synced appends"]],
    ["ignore-sync", ["claim sync failure cannot acknowledge admission", "intent or audit sync failure prevents all input"]],
  ];
  for (const [fault, names] of teeth) {
    test(`deliberately weak ${fault} journal fails named obligations`, async () => {
      const failed: string[] = [];
      for (const entry of cases) {
        try { await entry.run(() => model(fault)); } catch { failed.push(entry.name); }
      }
      for (const name of names) expect(failed).toContain(name);
    });
  }
  test("case cleanup runs even when a candidate fails", async () => {
    let closed = 0;
    const entry = cases.find(c => c.name === "claim acknowledgement survives loss of un-synced writes")!;
    await expect(entry.run(async () => ({ ...await model("memory"), close: async () => { closed++; } }))).rejects.toThrow();
    expect(closed).toBe(1);
  });
});
