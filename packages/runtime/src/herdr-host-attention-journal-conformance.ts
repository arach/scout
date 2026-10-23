/** Opt-in test instrument. Import performs no tests, construction or host I/O. */
import assert from "node:assert/strict";
import type { HerdrHostAttentionTarget } from "@openscout/protocol";
import { collectHerdrHostAttention, type HerdrHostAttentionCaptureEvidence } from "./herdr-host-attention.js";
import { createHerdrHostAttentionAnswerer, type HerdrHostAttentionAttempt as Attempt,
  type HerdrHostAttentionClaim as Claim, type HerdrHostAttentionFinalization as Ending,
  type HerdrHostAttentionAnswerDependencies as Dependencies } from "./herdr-host-attention-answer.js";
import type { HerdrHostAttentionJournal, HerdrHostAttentionJournalAudit, HerdrHostAttentionJournalIntent } from "./herdr-host-attention-journal.js";

/** Implement these hooks against an isolated instance of the REAL candidate
 * store. connect creates a new callback binding, not a new backing store.
 * crash must discard uncommitted/un-synced writes and reconstruct from durable
 * state, without a graceful close/flush. Advance the store's clock, not a sleep.
 * failNextSync must fail its next actual durability barrier, not the callback
 * entry. readAudit must inspect stored rows, not echo callback inputs.
 * A memory snapshot pretending to be a disk crash cannot prove fsync safety.
 */
export type HerdrHostAttentionJournalConformanceHarness = {
  connect: (deviceId: string) => HerdrHostAttentionJournal;
  crash: () => Promise<void>;
  advanceTime: (ms: number) => Promise<void>;
  readAudit: () => Promise<readonly HerdrHostAttentionJournalAudit[]>;
  readIntents: () => Promise<readonly HerdrHostAttentionJournalIntent[]>;
  failNextSync: (operation: "claim" | "intent") => Promise<void>;
  close: () => Promise<void>;
};
export type HerdrHostAttentionJournalConformanceFactory = () => Promise<HerdrHostAttentionJournalConformanceHarness>;
export type HerdrHostAttentionJournalConformanceCase = {
  name: string;
  run: (create: HerdrHostAttentionJournalConformanceFactory) => Promise<void>;
};

const device = "paired-device-a", otherDevice = "paired-device-b";
const pane = `
⏺ Bash(printf hello)
 Bash command
   printf hello
 Permission rule Bash(printf:*) requires confirmation for this command.
 Do you want to proceed?
   1. Yes
 ❯ 2. No
 Esc to cancel · Tab to amend · ctrl+e to explain
`;
const target = (): HerdrHostAttentionTarget => ({
  ref: { nodeId: "local", backend: "herdr", hostSession: "exact", paneId: "w1:p2" },
  terminalId: "term_real", workspaceId: "w1", tabId: "w1:t1", harness: "claude", label: "Claude",
  nativeSession: { agent: "claude", kind: "session_id", source: "hook", value: "native" },
});
const evidence = (row = target(), body = pane): HerdrHostAttentionCaptureEvidence => ({
  source: "herdr_visible", freshness: "live", before: structuredClone(row), after: structuredClone(row), body, truncated: false,
});
const options = () => ({ signal: new AbortController().signal });
async function request() {
  const row = target();
  const read = await collectHerdrHostAttention({ nodeId: "local", targets: [row], capture: async () => evidence(row) });
  const prompt = read.observations[0]?.prompt;
  assert(prompt, "conformance fixture must be recognized by the reviewed detector");
  return { target: row, promptVersion: prompt.promptVersion, option: "approve" as const };
}
async function attempt(id = "attempt-a", option: "approve" | "deny" = "approve"): Promise<Attempt> {
  const input = await request();
  const paneKey = JSON.stringify(["local", "exact", "term_real"]);
  return { ...input, option, attemptId: id, paneKey,
    attemptKey: JSON.stringify(["herdr-answer-attempt-v1", paneKey, input.promptVersion]), keys: [option === "approve" ? "1" : "2"] };
}
async function claim(journal: HerdrHostAttentionJournal, row: Attempt) {
  const result = await journal.admit(row, options());
  assert(result.ok, "first owner must be admitted");
  assert.equal(result.claim.attemptId, row.attemptId, "claim must bind the attempt owner");
  assert(result.claim.id.trim(), "claim ID must be nonempty");
  return result.claim;
}
function ending(row: Attempt, owner: Claim, disposition: Ending["disposition"] = "cancel_unsent"): Ending {
  return { attempt: row, claim: owner, disposition,
    result: disposition === "cancel_unsent" ? { outcome: "stale", reason: "prompt_changed", effect: "not_sent" }
      : { outcome: "failed", reason: "send_failed", effect: "unknown" } };
}
function answerer(journal: HerdrHostAttentionJournal, overrides: Partial<Dependencies> = {}) {
  return createHerdrHostAttentionAnswerer({ nodeId: "local",
    admit: (row, opts) => journal.admit(row, opts),
    writeSendIntent: (row, owner, opts) => journal.writeSendIntent(row, owner, opts),
    finalize: (input, opts) => journal.finalize(input, opts),
    capture: async row => evidence(row), sendKeys: async () => {},
    limits: { maxVerificationCaptures: 1 }, ...overrides });
}
function check(name: string, run: (h: HerdrHostAttentionJournalConformanceHarness) => Promise<void>): HerdrHostAttentionJournalConformanceCase {
  return { name, async run(create) { const h = await create(); try { await run(h); } finally { await h.close(); } } };
}

/** Extracted from the kernel's synthetic owner/CAS, intent, restart and stale
 * observation tests. Each case gets a fresh isolated store. No Bun/test-runner
 * dependency; a private host can register each name with its own test runner.
 */
export const herdrHostAttentionJournalConformanceCases: readonly HerdrHostAttentionJournalConformanceCase[] = [
  check("exclusive claim across writers and opposite decisions", async h => {
    const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => attempt(`attempt-${i}`, i % 2 ? "deny" : "approve")));
    const results = await Promise.all(rows.map((row, i) => h.connect(i % 2 ? otherDevice : device).admit(row, options())));
    assert.equal(results.filter(r => r.ok).length, 1, "one shared physical-terminal owner, not one per writer/decision");
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.ok) assert.equal(result.claim.attemptId, rows[i]!.attemptId);
      else assert.equal(result.reason, "claimed_elsewhere");
    }
  }),
  check("owner-token CAS compares both fields for intent and finalization", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    for (const forged of [{ ...owner, id: owner.id + "-wrong" }, { ...owner, attemptId: "wrong-attempt" }]) {
      assert.equal((await journal.writeSendIntent(row, forged, options())).ok, false);
      assert.equal((await journal.finalize(ending(row, forged), options())).status, "not_owner");
    }
    const wrongAttempt = { ...row, attemptId: "borrowed-owner" };
    assert.equal((await journal.writeSendIntent(wrongAttempt, owner, options())).ok, false);
    assert.equal((await journal.finalize(ending(wrongAttempt, owner), options())).status, "not_owner");
    assert.equal((await h.readAudit()).length, 0, "unowned intent must not append audit");
    assert.equal((await journal.writeSendIntent(row, owner, options())).ok, true);
    assert.equal((await journal.admit(await attempt("second", "deny"), options())).ok, false);
  }),
  check("late old owner cannot mutate a replacement claim", async h => {
    const journal = h.connect(device), old = await attempt(), oldOwner = await claim(journal, old);
    assert.equal((await journal.finalize(ending(old, oldOwner), options())).status, "settled");
    const replacement = await attempt("replacement"), newOwner = await claim(journal, replacement);
    assert.equal((await journal.writeSendIntent(old, oldOwner, options())).ok, false);
    assert.equal((await journal.finalize(ending(old, oldOwner), options())).status, "not_owner");
    assert.equal((await journal.writeSendIntent(replacement, newOwner, options())).ok, true);
    assert.equal((await journal.admit(await attempt("third"), options())).ok, false);
  }),
  check("aborted intent and finalization do not mutate ownership", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    const controller = new AbortController(); controller.abort();
    let accepted = false;
    try { accepted = (await journal.writeSendIntent(row, owner, { signal: controller.signal })).ok; } catch { /* abort rejection is allowed */ }
    assert.equal(accepted, false);
    let settled = false;
    try { settled = (await journal.finalize(ending(row, owner), { signal: controller.signal })).status === "settled"; } catch { /* abort rejection is allowed */ }
    assert.equal(settled, false);
    assert.equal((await h.readAudit()).length, 0);
    assert.equal((await journal.admit(await attempt("second"), options())).ok, false);
  }),
  check("second answer refused by a reconstructed kernel", async h => {
    let sends = 0;
    const make = () => answerer(h.connect(device), { sendKeys: async () => { sends++; } });
    const input = await request();
    assert.equal((await make()(input)).effect, "sent");
    const second = await make()({ ...input, option: "deny" });
    assert.equal(second.reason, "claimed_elsewhere"); assert.equal(second.effect, "not_sent");
    assert.equal(sends, 1);
  }),
  check("unresolved physical terminal blocks a changed version and pane alias", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    assert.equal((await journal.writeSendIntent(row, owner, options())).ok, true);
    const next = await attempt("changed-version", "deny");
    next.promptVersion = "sha256:" + "a".repeat(64);
    next.attemptKey = JSON.stringify(["herdr-answer-attempt-v1", next.paneKey, next.promptVersion]);
    next.target.ref.paneId = "w1:p9"; // Same opaque terminal; movable pane is not the lock key.
    assert.deepEqual(await h.connect(otherDevice).admit(next, options()), { ok: false, reason: "claimed_elsewhere" });
  }),
  check("ambiguous send survives crash and age without silent retry", async h => {
    let sends = 0;
    const input = await request();
    const first = await answerer(h.connect(device), { sendKeys: async () => { sends++; throw Error("accepted input, lost acknowledgement"); } })(input);
    assert.equal(first.effect, "unknown");
    await h.advanceTime(3_600_000); await h.crash();
    const next = await answerer(h.connect(otherDevice), { sendKeys: async () => { sends++; } })({ ...input, option: "deny" });
    assert.equal(next.reason, "claimed_elsewhere"); assert.equal(next.effect, "not_sent"); assert.equal(sends, 1);
  }),
  ...([1, 2, 3] as const).flatMap(at => (["stale", "replaced"] as const).map(mode =>
    check(`${mode} prompt refused on pre-send read ${at}`, async h => {
      let reads = 0, sends = 0;
      const input = await request();
      const result = await answerer(h.connect(device), {
        capture: async row => {
          const value = evidence(row); reads++;
          if (reads === at) {
            if (mode === "stale") value.body = pane.replaceAll("printf hello", "printf changed");
            else value.after.terminalId = "replacement";
          }
          return value;
        }, sendKeys: async () => { sends++; },
      })(input);
      assert.equal(result.outcome, "stale"); assert.equal(result.reason, mode === "stale" ? "prompt_changed" : "target_changed");
      assert.equal(result.effect, "not_sent"); assert.equal(sends, 0);
      assert.equal((await h.readAudit()).length, at === 3 ? 1 : 0);
      // The kernel can cancel only its exclusively owned, never-sent attempt.
      await claim(h.connect(device), await attempt("after-stale"));
    }))),
  check("audit binds actual device and attempt owner before input", async h => {
    const input = await request(); let sends = 0;
    const result = await answerer(h.connect(otherDevice), { sendKeys: async () => {
      const rows = await h.readAudit(); assert.equal(rows.length, 1);
      const audit = rows[0]!;
      assert.equal(audit.schema, "scout.herdr-answer-audit/v1");
      assert.equal(audit.deviceId, otherDevice);
      assert.equal(audit.owner.attemptId, audit.attempt.attemptId); assert(audit.owner.id.trim());
      assert.equal(audit.attempt.promptVersion, input.promptVersion);
      assert.deepEqual(audit.attempt.target, input.target);
      assert.equal(audit.attempt.option, input.option); assert.deepEqual(audit.attempt.keys, ["1"]);
      assert(Number.isFinite(audit.committedAt)); sends++;
    } })(input);
    assert.equal(result.effect, "sent"); assert.equal(sends, 1);
  }),
  check("claim acknowledgement survives loss of un-synced writes", async h => {
    await claim(h.connect(device), await attempt()); await h.crash();
    const next = await h.connect(otherDevice).admit(await attempt("after-crash"), options());
    assert.deepEqual(next, { ok: false, reason: "claimed_elsewhere" });
  }),
  check("intent and matching audit survive loss of un-synced appends", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    assert.equal((await journal.writeSendIntent(row, owner, options())).ok, true);
    const before = await h.readAudit(); assert.equal(before.length, 1);
    assert.deepEqual(before[0]!.attempt, row); assert.deepEqual(before[0]!.owner, owner); assert.equal(before[0]!.deviceId, device);
    const intents = await h.readIntents(); assert.equal(intents.length, 1);
    assert.equal(intents[0]!.schema, "scout.herdr-answer-intent/v1");
    assert.deepEqual(intents[0]!.attempt, row); assert.deepEqual(intents[0]!.owner, owner);
    assert(Number.isFinite(intents[0]!.committedAt));
    await h.crash(); assert.deepEqual(await h.readAudit(), before, "acknowledged audit must be crash durable, not append-only");
    assert.deepEqual(await h.readIntents(), intents, "acknowledged intent must survive a crash too");
    assert.equal((await h.connect(device).admit(await attempt("after-crash"), options())).ok, false);
  }),
  check("unresolved intent never expires as a TTL claim", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    assert.equal((await journal.writeSendIntent(row, owner, options())).ok, true);
    assert.equal((await journal.finalize(ending(row, owner, "retain_unresolved"), options())).status, "settled");
    await h.advanceTime(3_600_000);
    assert.deepEqual(await h.connect(otherDevice).admit(await attempt("after-ttl", "deny"), options()), { ok: false, reason: "claimed_elsewhere" });
  }),
  check("owned unsent cancellation is durable and retains audit", async h => {
    const journal = h.connect(device), row = await attempt(), owner = await claim(journal, row);
    assert.equal((await journal.writeSendIntent(row, owner, options())).ok, true);
    const before = await h.readAudit();
    assert.equal((await journal.finalize(ending(row, owner), options())).status, "settled");
    await h.crash(); assert.deepEqual(await h.readAudit(), before);
    await claim(h.connect(otherDevice), await attempt("new-occurrence"));
  }),
  check("claim sync failure cannot acknowledge admission", async h => {
    await h.failNextSync("claim"); let accepted = false;
    try { accepted = (await h.connect(device).admit(await attempt(), options())).ok; } catch { /* I/O rejection is allowed */ }
    assert.equal(accepted, false, "un-synced admission must not acknowledge ownership");
  }),
  check("intent or audit sync failure prevents all input", async h => {
    await h.failNextSync("intent"); let sends = 0;
    const result = await answerer(h.connect(device), { sendKeys: async () => { sends++; } })(await request());
    assert.equal(result.effect, "not_sent"); assert.equal(sends, 0);
    assert.notEqual(result.outcome, "answered");
  }),
];
