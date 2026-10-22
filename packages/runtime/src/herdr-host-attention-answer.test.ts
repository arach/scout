import { describe, expect, test } from "bun:test";
import type { HerdrHostAttentionTarget } from "@openscout/protocol";
import { collectHerdrHostAttention, collectTmuxHostAttention, createHerdrHostAttentionAnswerer, HERDR_HOST_ATTENTION_ANSWER_LIMITS,
  type HerdrHostAttentionAnswerDependencies as Deps, type HerdrHostAttentionAnswerInput as Input,
  type HerdrHostAttentionAttempt as Attempt, type HerdrHostAttentionClaim as Claim, type HerdrHostAttentionFinalization as Ending } from "./host-attention.js";
import type { HerdrHostAttentionCaptureEvidence as Evidence } from "./host-attention.js";
import { livePermissionPrompt as pane } from "./test-helpers/tmux-host-attention-fixture.test.js";
const changed = pane.replaceAll("curl -s -m 5", "curl -v -m 5");
const target = (): HerdrHostAttentionTarget => ({ ref: { nodeId: "local", backend: "herdr", hostSession: "exact", paneId: "w1:p2" },
  terminalId: "term_real", workspaceId: "w1", tabId: "w1:t1", harness: "claude", label: "Claude",
  nativeSession: { agent: "claude", kind: "session_id", source: "hook", value: "native" } });
const evidence = (row = target(), body = pane): Evidence => ({ source: "herdr_visible", freshness: "live", before: structuredClone(row), after: structuredClone(row), body, truncated: false });
async function request(body = pane, row = target()): Promise<Input> {
  const value = await collectHerdrHostAttention({ nodeId: "local", targets: [row], capture: async () => evidence(row, body) });
  return { target: row, promptVersion: value.observations[0]!.prompt!.promptVersion, option: "approve" };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Record = { claim: Claim; intent: boolean; preparedAt: number };
/** Synthetic durable-owner model only, not a production claim store. */
function journal(initial: Array<[string, Record]> = []) {
  const rows = new Map(initial), endings: Ending[] = [], audit: Array<{ attemptId: string; claimId: string }> = []; let now = 0;
  const owns = (attempt: Attempt, claim: Claim) => { const current = rows.get(attempt.paneKey); return current?.claim.id === claim.id && current.claim.attemptId === claim.attemptId; };
  return { rows, endings, audit, advance: (ms: number) => { now += ms; }, owns,
    admit: (async (attempt, _options?: { signal: AbortSignal }) => {
      if (rows.has(attempt.paneKey)) return { ok: false, reason: "claimed_elsewhere" };
      const claim = { id: "claim:" + attempt.attemptId, attemptId: attempt.attemptId };
      rows.set(attempt.paneKey, { claim: { ...claim }, intent: false, preparedAt: now }); return { ok: true, claim };
    }) satisfies Deps["admit"],
    intent: (async (attempt, claim, _options?: { signal: AbortSignal }) => {
      if (!owns(attempt, claim)) return { ok: false, reason: "claim_unavailable" };
      audit.push({ attemptId: attempt.attemptId, claimId: claim.id });
      rows.get(attempt.paneKey)!.intent = true; return { ok: true };
    }) satisfies Deps["writeSendIntent"],
    finalize: (async (input, _options?: { signal: AbortSignal }) => {
      endings.push(structuredClone(input));
      if (!owns(input.attempt, input.claim)) return { status: "not_owner" };
      if (input.disposition !== "retain_unresolved") rows.delete(input.attempt.paneKey);
      return { status: "settled" };
    }) satisfies Deps["finalize"],
  };
}
function fixture(overrides: Partial<Deps> = {}, store = journal()) {
  const events: string[] = [], sent: string[][] = [];
  let reads = 0, verifiedSends = 0;
  const deps: Deps = { nodeId: "local",
    capture: async row => { events.push("capture"); reads++; const gone = sent.length > verifiedSends; verifiedSends = sent.length; return evidence(row, gone ? "❯ " : pane); },
    admit: async (attempt, options) => { events.push("admit"); return store.admit(attempt, options); },
    writeSendIntent: async (attempt, claim, options) => { events.push("intent"); return store.intent(attempt, claim, options); },
    sendKeys: async (row, keys, options) => { events.push("send"); expect(row.terminalId).toBe("term_real"); expect(options.signal.aborted).toBe(false); sent.push([...keys]); },
    finalize: async (input, options) => { events.push("finalize"); return store.finalize(input, options); },
    ...overrides, limits: { maxVerificationCaptures: 1, ...overrides.limits },
  };
  const answer = createHerdrHostAttentionAnswerer(deps);
  return { answer, deps, events, sent, store, reads: () => reads, reconstruct: () => createHerdrHostAttentionAnswerer(deps) };
}

describe("inactive guarded Herdr answers", () => {
  test("all callbacks are mandatory; import/construction supplies no authority or default transport", () => {
    const f = fixture(); expect(f.events).toEqual([]);
    for (const name of ["capture", "admit", "writeSendIntent", "sendKeys", "finalize"] as const) {
      expect(() => createHerdrHostAttentionAnswerer({ ...f.deps, [name]: undefined } as unknown as Deps)).toThrow("callbacks are required");
    }
  });
  test("normal answer requires admission, durable intent, a fresh recheck and complete post-send disappearance", async () => {
    const f = fixture(); expect(await f.answer(await request())).toEqual({ outcome: "answered", reason: "dialog_disappeared", effect: "sent" });
    expect(f.events).toEqual(["capture", "admit", "capture", "intent", "capture", "send", "capture", "finalize"]);
    expect(f.sent).toEqual([["1"]]); expect(f.store.audit).toHaveLength(1); expect(f.store.rows.size).toBe(0); expect(f.store.endings[0]!.disposition).toBe("verified_answer");
  });
  test("stale content and pre-send disappearance do not send or acquire a claim", async () => {
    for (const [body, outcome, reason] of [[changed, "stale", "prompt_changed"], ["❯ ", "gone", "prompt_gone"]] as const) {
      const f = fixture({ capture: async row => evidence(row, body) });
      expect(await f.answer(await request())).toEqual({ outcome, reason, effect: "not_sent" }); expect(f.sent).toEqual([]); expect(f.store.rows.size).toBe(0);
    }
  });
  test("native send success with a remaining dialog is unverified, not answered", async () => {
    const f = fixture({ capture: async row => evidence(row) }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "dialog_still_present", effect: "sent" });
    expect(await f.answer({ ...input, option: "deny" })).toMatchObject({ outcome: "refused", reason: "already_attempted" });
    expect(f.sent).toHaveLength(1); expect([...f.store.rows.values()][0]!.intent).toBe(true);
  });
  test("another dialog after send is unverified and never answered automatically", async () => {
    let reads = 0; const f = fixture({ capture: async row => evidence(row, ++reads <= 3 ? pane : changed) });
    expect(await f.answer(await request())).toEqual({ outcome: "unverified", reason: "different_dialog", effect: "sent" }); expect(f.sent).toHaveLength(1);
  });
  test.each(["null", "error", "cached", "truncated", "oversize", "throw"])("post-send %s cannot masquerade as empty success", async mode => {
    let reads = 0;
    const f = fixture({ capture: async row => {
      if (++reads <= 3) return evidence(row);
      if (mode === "throw") throw Error("private capture error");
      return (mode === "null" ? null : mode === "error" ? { error: "missing" } : mode === "cached" ? { ...evidence(row), freshness: "cached" }
        : mode === "truncated" ? { ...evidence(row), truncated: true } : evidence(row, pane + "😀".repeat(13_000))) as Evidence;
    } });
    expect(await f.answer(await request())).toMatchObject({ outcome: "unverified", effect: "sent" }); expect(f.sent).toHaveLength(1);
  });
  test.each([1, 2, 3, 4])("terminal replacement on read %s is not a verified answer", async at => {
    let reads = 0;
    const f = fixture({ capture: async row => { const value = evidence(row, "❯ "); if (++reads < at) value.body = pane; else value.after.terminalId = "replacement"; return value; } });
    expect(await f.answer(await request())).toEqual({ outcome: at < 4 ? "stale" : "unverified", reason: "target_changed", effect: at < 4 ? "not_sent" : "sent" });
    expect(f.sent).toHaveLength(at < 4 ? 0 : 1);
  });
  test.each(["authority_refused", "claimed_elsewhere", "claim_unavailable", "audit_failed"] as const)("admission %s is not an uncertain transport effect", async reason => {
    const f = fixture({ admit: async () => ({ ok: false, reason }) });
    expect(await f.answer(await request())).toEqual({ outcome: reason === "authority_refused" || reason === "claimed_elsewhere" ? "refused" : "failed", reason, effect: "not_sent" });
    expect(f.sent).toEqual([]); expect(f.events).not.toContain("intent");
  });
  test("missing audit/intent prevents sends, and settled cancel_unsent releases the unsent attempt", async () => {
    const f = fixture({ writeSendIntent: async () => ({ ok: false, reason: "audit_failed" }) }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "audit_failed", effect: "not_sent" });
    expect(f.store.endings[0]!.disposition).toBe("cancel_unsent"); expect(f.store.rows.size).toBe(0);
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "audit_failed", effect: "not_sent" }); expect(f.sent).toEqual([]);
    expect(f.store.audit).toEqual([]);
  });
  test("intent rejection after persistence cancels an exclusively owned attempt that never invoked send", async () => {
    const store = journal(); let writes = 0;
    const f = fixture({ writeSendIntent: async (attempt, claim) => { const result = await store.intent(attempt, claim); if (++writes === 1) throw Error("ack lost"); return result; } }, store);
    const input = await request(); expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "claim_unavailable", effect: "not_sent" });
    expect(f.store.endings[0]!.disposition).toBe("cancel_unsent"); expect(f.store.rows.size).toBe(0); expect(f.sent).toEqual([]);
    expect((await f.answer(input)).outcome).toBe("answered");
    expect((await f.reconstruct()(input)).outcome).toBe("answered"); expect(f.sent).toHaveLength(2);
  });
  test.each([["gone", "❯ ", "prompt_gone"], ["stale", changed, "prompt_changed"]] as const)("%s after intent cancels without consuming a permanent attempt slot", async (outcome, body, reason) => {
    let reads = 0;
    const f = fixture({ limits: { maxAttempts: 1 }, capture: async row => evidence(row, ++reads === 3 ? body : reads === 7 ? "❯ " : pane) });
    const input = await request();
    expect(await f.answer(input)).toEqual({ outcome, reason, effect: "not_sent" });
    expect(f.store.endings[0]!.disposition).toBe("cancel_unsent"); expect(f.store.audit).toHaveLength(1);
    expect(f.store.rows.size).toBe(0); expect(f.sent).toEqual([]);
    expect((await f.answer(input)).outcome).toBe("answered"); expect(f.sent).toHaveLength(1);
  });
  test.each(["throw", "not_owner", "unavailable"] as const)("failed cancel_unsent (%s) retains the in-memory latch", async status => {
    const f = fixture({ writeSendIntent: async () => ({ ok: false, reason: "audit_failed" }), finalize: async input => {
      expect(input.disposition).toBe("cancel_unsent");
      if (status === "throw") throw Error("cancel unavailable");
      return { status };
    } }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "audit_failed", effect: "not_sent" });
    expect(await f.answer(input)).toMatchObject({ reason: "already_attempted", effect: "not_sent" }); expect(f.sent).toEqual([]);
  });
  test("failed cancel_unsent before intent adds a latch even though none existed yet", async () => {
    let reads = 0;
    const f = fixture({ capture: async row => evidence(row, ++reads === 2 ? changed : pane), finalize: async input => {
      expect(input.disposition).toBe("cancel_unsent"); return { status: "unavailable" };
    } }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "stale", reason: "prompt_changed", effect: "not_sent" });
    expect(await f.answer(input)).toMatchObject({ reason: "already_attempted" }); expect(f.store.audit).toEqual([]); expect(f.sent).toEqual([]);
  });
  test("cancel_unsent timeout retains the latch after its abort-ignoring finalizer eventually settles", async () => {
    const gate = deferred<void>(), store = journal(); let finalSignal!: AbortSignal;
    const f = fixture({ limits: { finalizationTimeoutMs: 5 }, writeSendIntent: async () => ({ ok: false, reason: "audit_failed" }), finalize: async (input, { signal }) => {
      finalSignal = signal; expect(input.disposition).toBe("cancel_unsent"); await gate.promise; return store.finalize(input);
    } }, store); const input = await request();
    expect(await f.answer(input)).toMatchObject({ reason: "audit_failed", effect: "not_sent" }); expect(finalSignal.aborted).toBe(true);
    expect(await f.answer(input)).toMatchObject({ reason: "busy" });
    gate.resolve(); await Bun.sleep(0);
    expect(await f.answer(input)).toMatchObject({ reason: "already_attempted" }); expect(f.sent).toEqual([]);
  });
  test("effect-unknown recurrence excludes decision from the key and never sends again", async () => {
    let sends = 0; const f = fixture({ sendKeys: async () => { sends++; throw Error("may have acted"); } }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "send_failed", effect: "unknown" });
    expect(await f.answer({ ...input, option: "deny" })).toEqual({ outcome: "refused", reason: "already_attempted", effect: "not_sent" });
    expect(sends).toBe(1); expect(f.store.endings[0]!.disposition).toBe("retain_unresolved");
  });
  test("uncertain intent survives age, disconnect and answerer/store reconstruction", async () => {
    const disconnected = new AbortController(); let sends = 0;
    const f = fixture({ sendKeys: async () => { sends++; disconnected.abort(); } }); const input = await request();
    expect(await f.answer({ ...input, signal: disconnected.signal })).toMatchObject({ outcome: "unverified", effect: "unknown" });
    f.store.advance(3_600_000);
    expect(await f.reconstruct()(input)).toMatchObject({ reason: "claimed_elsewhere", effect: "not_sent" });
    const restored = journal(JSON.parse(JSON.stringify([...f.store.rows])));
    const restarted = fixture({}, restored);
    expect(await restarted.answer(input)).toMatchObject({ reason: "claimed_elsewhere", effect: "not_sent" });
    expect(sends).toBe(1); expect(restarted.sent).toEqual([]); expect([...restored.rows.values()][0]!.intent).toBe(true);
  });
  test("verified recurrence evicts only the resolved occurrence and frees the attempt cap", async () => {
    const f = fixture({ limits: { maxAttempts: 1, maxVerificationCaptures: 1 } }); const input = await request();
    expect((await f.answer(input)).outcome).toBe("answered"); expect((await f.answer(input)).outcome).toBe("answered"); expect(f.sent).toEqual([["1"], ["1"]]);
  });
  test("failed finalization after observed disappearance retains the latch, never claims no effect", async () => {
    const f = fixture({ finalize: async () => { throw Error("journal unavailable"); } }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "claim_unavailable", effect: "sent" });
    expect(await f.answer(input)).toMatchObject({ reason: "already_attempted" }); expect(f.sent).toHaveLength(1);
  });
  test("late finalization carries the old owner token and cannot release a replacement claim", async () => {
    const gate = deferred<void>(), store = journal(); let ending!: Ending;
    const f = fixture({ limits: { finalizationTimeoutMs: 5 }, finalize: async input => {
      ending = input; await gate.promise; return store.finalize(input, { signal: new AbortController().signal });
    } }, store);
    const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "claim_unavailable", effect: "sent" });
    const replacement = { claim: { id: ending.claim.id, attemptId: "replacement-owner" }, intent: true, preparedAt: 1 };
    store.rows.set(ending.attempt.paneKey, replacement);
    expect(await f.answer(input)).toMatchObject({ reason: "busy" });
    gate.resolve(); await Bun.sleep(0);
    expect(store.rows.get(ending.attempt.paneKey)).toEqual(replacement);
    expect(await f.reconstruct()(input)).toMatchObject({ reason: "claimed_elsewhere" }); expect(f.sent).toHaveLength(1);
  });
  test("hung send keeps its slot and growing hold age, even after timeout", async () => {
    const gate = deferred<void>(); let transportSignal!: AbortSignal, sends = 0;
    const f = fixture({ limits: { sendTimeoutMs: 5 }, sendKeys: async (_row, _keys, { signal }) => { sends++; transportSignal = signal; await gate.promise; } });
    const input = await request(); expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "send_timeout", effect: "unknown" });
    expect(transportSignal.aborted).toBe(true);
    const first = await f.answer(input); expect(first.reason).toBe("busy"); expect(first.heldForMs!).toBeGreaterThanOrEqual(0);
    await Bun.sleep(10); const second = await f.answer(input); expect(second.heldForMs!).toBeGreaterThan(first.heldForMs!);
    gate.resolve(); await Bun.sleep(0); expect(await f.answer(input)).toMatchObject({ reason: "already_attempted" }); expect(sends).toBe(1);
  });
  test("late preflight capture cannot resume admission, intent or a send", async () => {
    const gate = deferred<Evidence>(); const f = fixture({ limits: { preflightTimeoutMs: 5 }, capture: async () => gate.promise }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "capture_timeout", effect: "not_sent" });
    expect(await f.answer(input)).toMatchObject({ reason: "busy" }); gate.resolve(evidence()); await Bun.sleep(0);
    expect(f.events).toEqual([]); expect(f.sent).toEqual([]);
  });
  test.each([false, true])("late intent cannot write after settled cancel_unsent (replacement=%s)", async replace => {
    const gate = deferred<void>(), store = journal(); let signal!: AbortSignal, late!: Awaited<ReturnType<Deps["writeSendIntent"]>>;
    const f = fixture({ limits: { preflightTimeoutMs: 5 }, writeSendIntent: async (attempt, claim, options) => {
      signal = options.signal; await gate.promise; return late = await store.intent(attempt, claim);
    } }, store); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "claim_unavailable", effect: "not_sent" }); expect(signal.aborted).toBe(true);
    const ending = store.endings[0]!; expect(ending.disposition).toBe("cancel_unsent"); expect(store.rows.size).toBe(0);
    expect(await f.answer(input)).toMatchObject({ reason: "busy" });
    const replacement = { claim: { id: ending.claim.id, attemptId: "replacement-owner" }, intent: false, preparedAt: 1 };
    if (replace) store.rows.set(ending.attempt.paneKey, replacement);
    gate.resolve(); await Bun.sleep(0); expect(late).toEqual({ ok: false, reason: "claim_unavailable" });
    expect(store.audit).toEqual([]); expect(f.sent).toEqual([]);
    if (replace) {
      expect(store.rows.get(ending.attempt.paneKey)).toEqual(replacement);
      expect(await f.answer(input)).toMatchObject({ reason: "claimed_elsewhere" });
    } else {
      expect((await f.answer(input)).outcome).toBe("answered"); expect(f.sent).toHaveLength(1);
    }
  });
  test("the whole preflight budget includes admission rather than restarting a deadline", async () => {
    const f = fixture({ limits: { preflightTimeoutMs: 5 }, admit: async () => new Promise<never>(() => {}) }); const input = await request();
    expect(await f.answer(input)).toMatchObject({ outcome: "failed", reason: "claim_unavailable", effect: "not_sent" }); expect(f.sent).toEqual([]);
  });
  test("caller cancellation before I/O is not an admission or transport attempt", async () => {
    const f = fixture(), input = await request(), stopped = new AbortController(); stopped.abort();
    expect(await f.answer({ ...input, signal: stopped.signal })).toEqual({ outcome: "failed", reason: "aborted", effect: "not_sent" });
    expect(f.events).toEqual([]); expect(f.sent).toEqual([]);
  });
  test("late admission cannot resume intent or transport after its budget", async () => {
    const gate = deferred<Awaited<ReturnType<Deps["admit"]>>>(); let attempt!: Attempt;
    const f = fixture({ limits: { preflightTimeoutMs: 5 }, admit: async value => { attempt = value; return gate.promise; } }); const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "claim_unavailable", effect: "not_sent" });
    gate.resolve({ ok: true, claim: { id: "late", attemptId: attempt.attemptId } }); await Bun.sleep(0);
    expect(f.events).not.toContain("intent"); expect(f.sent).toEqual([]);
  });
  test.each(["not_owner", "unavailable"] as const)("finalization %s cannot evict the attempt", async status => {
    const f = fixture({ finalize: async () => ({ status }) }), input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "claim_unavailable", effect: "sent" });
    expect(await f.answer(input)).toMatchObject({ reason: "already_attempted" }); expect(f.sent).toHaveLength(1);
  });
  test("concurrent preflights cannot exceed the unresolved-attempt ceiling", async () => {
    const gate = deferred<void>(), store = journal(); let admitted = 0, sends = 0;
    const f = fixture({ limits: { maxAttempts: 1 }, admit: async (attempt, options) => { admitted++; await gate.promise; return store.admit(attempt, options); },
      sendKeys: async () => { sends++; throw Error("unknown"); } }, store);
    const a = await request(), b = await request(pane, { ...target(), terminalId: "term_other" });
    const one = f.answer(a), two = f.answer(b); await Bun.sleep(0); expect(admitted).toBe(2); gate.resolve();
    const results = await Promise.all([one, two]); expect(results.filter(row => row.reason === "attempt_capacity")).toHaveLength(1); expect(sends).toBe(1);
  });
  test("local/Claude/ref checks reject numeric legacy and tmux versions without a send", async () => {
    const f = fixture(), input = await request();
    const invalid = [ { ...input, promptVersion: 123 }, { ...input, target: { ...input.target, label: null } },
      { ...input, target: { ...input.target, terminalId: "" } }, { ...input, target: { ...input.target, harness: "codex" } },
      { ...input, option: "always" } ];
    for (const value of invalid) expect(await f.answer(value as Input)).toMatchObject({ outcome: "refused", reason: "invalid_request", effect: "not_sent" });
    expect(await f.answer({ ...input, target: { ...input.target, ref: { ...input.target.ref, nodeId: "remote" } } })).toMatchObject({ reason: "nonlocal_ref" });
    expect(await createHerdrHostAttentionAnswerer({ ...f.deps, nodeId: null })(input)).toMatchObject({ reason: "local_identity_unknown" });
    const tmux = await collectTmuxHostAttention({ nodeId: "local", targets: [{ ref: { nodeId: "local", backend: "tmux", hostSession: "exact", paneId: "%42" }, harness: "claude", label: "Claude" }], capture: async () => pane });
    expect(await f.answer({ ...input, promptVersion: tmux.observations[0]!.prompt!.promptVersion })).toMatchObject({ reason: "prompt_changed", effect: "not_sent" }); expect(f.sent).toEqual([]);
  });
  test("snapshots input, callback context and claim ownership across callbacks", async () => {
    const input = await request(), store = journal(); let observedClaim!: Claim;
    const f = fixture({ admit: async (attempt, opts) => {
      const admitted = await store.admit(attempt, opts); input.target.terminalId = "mutation"; input.option = "deny";
      attempt.target.ref.hostSession = "mutation"; attempt.keys = ["enter"]; return admitted;
    }, writeSendIntent: async (attempt, claim, opts) => {
      observedClaim = claim; const result = await store.intent(attempt, claim, opts); claim.attemptId = "mutation"; attempt.target.terminalId = "mutation"; return result;
    } }, store);
    expect((await f.answer(input)).outcome).toBe("answered"); expect(observedClaim.attemptId).toBe("mutation"); expect(f.sent).toEqual([["1"]]); expect(store.rows.size).toBe(0);
  });
  test("admission cannot lend an old attempt's claim token to a new invocation", async () => {
    const f = fixture({ admit: async () => ({ ok: true, claim: { id: "old", attemptId: "old" } }) });
    expect(await f.answer(await request())).toEqual({ outcome: "failed", reason: "claim_unavailable", effect: "not_sent" }); expect(f.sent).toEqual([]);
  });
  test("a refused post-admission recheck cancels only its unsent preparation", async () => {
    let reads = 0; const f = fixture({ capture: async row => evidence(row, ++reads === 1 ? pane : changed) });
    expect(await f.answer(await request())).toEqual({ outcome: "stale", reason: "prompt_changed", effect: "not_sent" });
    expect(f.store.rows.size).toBe(0); expect(f.store.endings[0]!.disposition).toBe("cancel_unsent"); expect(f.sent).toEqual([]);
  });
  test.each([["approve", "1"], ["deny", "2"], ["escape", "esc"]] as const)("%s uses an exact numeric/Escape key, never cursor Enter", async (option, key) => {
    const body = option === "escape" ? pane.replace("2. No", "2. Yes, and don't ask again") : pane;
    let sends = 0; const seen: readonly string[][] = [];
    const f = fixture({ capture: async row => evidence(row, sends ? "❯ " : body), sendKeys: async (_row, keys) => { sends++; (seen as string[][]).push([...keys]); } });
    expect((await f.answer({ ...await request(body), option: option === "approve" ? "approve" : "deny" })).outcome).toBe("answered"); expect(seen).toEqual([[key]]);
  });
  test("unsupported numbering fails closed before any admission or send", async () => {
    const body = pane.replace("2. No", "3. No"), f = fixture({ capture: async row => evidence(row, body) });
    expect(await f.answer(await request(body))).toMatchObject({ reason: "unsupported_options", effect: "not_sent" }); expect(f.sent).toEqual([]); expect(f.store.rows.size).toBe(0);
  });
  test("physical-terminal aliases serialize even when pane coordinates differ", async () => {
    const gate = deferred<Evidence>(); const f = fixture({ capture: async () => gate.promise }); const input = await request();
    const one = f.answer(input); const alias = { ...input, target: { ...input.target, ref: { ...input.target.ref, paneId: "w2:p9" } } };
    expect(await f.answer(alias)).toMatchObject({ reason: "busy", effect: "not_sent" }); gate.resolve(evidence(target(), "❯ ")); expect((await one).outcome).toBe("gone"); expect(f.sent).toEqual([]);
  });
  test("hard concurrency and unresolved-attempt ceilings cannot be raised", async () => {
    const f = fixture({ limits: { maxConcurrentAnswers: 99, preflightTimeoutMs: 5 }, capture: async () => new Promise<never>(() => {}) }); const input = await request();
    const results = await Promise.all(Array.from({ length: 7 }, (_, i) => f.answer({ ...input, target: { ...input.target, terminalId: "term_" + i } })));
    expect(results.filter(row => row.reason === "busy")).toHaveLength(1); expect(f.sent).toEqual([]);
    const limited = fixture({ limits: { maxAttempts: 1 }, sendKeys: async () => { throw Error("unknown"); } });
    await limited.answer(input);
    expect(await limited.answer({ ...input, target: { ...input.target, terminalId: "term_other" } })).toMatchObject({ reason: "attempt_capacity", effect: "not_sent" });
    expect(HERDR_HOST_ATTENTION_ANSWER_LIMITS).toMatchObject({ maxAttempts: 256, maxConcurrentAnswers: 6, preflightTimeoutMs: 2000, finalizationTimeoutMs: 2000 });
  });
});
