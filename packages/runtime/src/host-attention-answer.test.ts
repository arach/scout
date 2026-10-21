import { describe, expect, test } from "bun:test";
import type { TmuxHostAttentionTarget } from "@openscout/protocol";
import { collectTmuxHostAttention, createTmuxHostAttentionAnswerer, TMUX_HOST_ATTENTION_ANSWER_LIMITS,
  type TmuxHostAttentionAnswerInput, type TmuxHostAttentionCapture, type TmuxHostAttentionSendKeys } from "./host-attention.js";
import { livePermissionPrompt as pane } from "./test-helpers/tmux-host-attention-fixture.test.js";
const changed = pane.replaceAll("curl -s -m 5", "curl -v -m 5");
const target = (): TmuxHostAttentionTarget => ({ ref: { nodeId: "local", backend: "tmux", hostSession: "exact:session", paneId: "%42" }, harness: "claude", label: "Claude" });
async function request(body = pane, row = target()): Promise<TmuxHostAttentionAnswerInput> {
  const read = await collectTmuxHostAttention({ nodeId: "local", targets: [row], capture: async () => body });
  return { target: row, promptVersion: read.observations[0]!.prompt!.promptVersion, option: "approve" };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function fixture(body: string | null | { body: string; truncated?: boolean } = pane, overrides: {
  capture?: TmuxHostAttentionCapture; sendKeys?: TmuxHostAttentionSendKeys; limits?: Parameters<typeof createTmuxHostAttentionAnswerer>[0]["limits"];
} = {}) {
  const sent: string[][] = [], events: string[] = [];
  let reads = 0;
  const answer = createTmuxHostAttentionAnswerer({ nodeId: "local", limits: { maxVerificationCaptures: 1, ...overrides.limits },
    capture: overrides.capture ?? (async () => { events.push("capture"); return reads++ === 0 ? body : "❯ "; }),
    sendKeys: overrides.sendKeys ?? (async (ref, keys, context) => {
      events.push("send"); expect(ref).toEqual(target().ref); expect(context.signal.aborted).toBe(false); sent.push([...keys]);
    }),
  });
  return { answer, sent, events };
}

describe("fresh, bounded tmux permission answers", () => {
  test("recaptures before and after one exact-key send; normal disappearance is answered", async () => {
    const f = fixture();
    expect(await f.answer(await request())).toEqual({ outcome: "answered", reason: "dialog_disappeared", effect: "sent" });
    expect(f.events).toEqual(["capture", "send", "capture"]); expect(f.sent).toEqual([["1"]]);
  });
  test("a changed prompt is stale and never receives keys", async () => {
    const f = fixture(changed);
    expect(await f.answer(await request())).toEqual({ outcome: "stale", reason: "prompt_changed", effect: "not_sent" });
    expect(f.sent).toEqual([]); expect(f.events).toEqual(["capture"]);
  });
  test("a vanished prompt is gone, not answered", async () => {
    const f = fixture(`${pane}\n❯ `);
    expect(await f.answer(await request())).toEqual({ outcome: "gone", reason: "prompt_gone", effect: "not_sent" });
    expect(f.sent).toEqual([]);
  });
  test("a dialog that stays is unverified, never successful just because transport resolved", async () => {
    let sends = 0;
    const f = fixture(pane, { capture: async () => pane, sendKeys: async () => { sends++; } });
    expect(await f.answer(await request())).toEqual({ outcome: "unverified", reason: "dialog_still_present", effect: "sent" });
    expect(sends).toBe(1);
  });
  test("another prompt after the send is unverified and is never answered automatically", async () => {
    let reads = 0, sends = 0;
    const f = fixture(pane, { capture: async () => reads++ ? changed : pane, sendKeys: async () => { sends++; } });
    expect(await f.answer(await request())).toMatchObject({ outcome: "unverified", reason: "different_dialog", effect: "sent" });
    expect(sends).toBe(1); expect(reads).toBe(2);
  });
  test.each([["null", null], ["truncated", { body: pane, truncated: true }], ["oversize", { body: pane + "😀".repeat(13_000) }]] as const)("unreadable/incomplete preflight cannot send (%s)", async (_kind, body) => {
    const f = fixture(body);
    expect(await f.answer(await request())).toMatchObject({ outcome: "failed", effect: "not_sent" }); expect(f.sent).toEqual([]);
  });
  test("preflight exceptions are typed and do not send", async () => {
    const f = fixture(pane, { capture: async () => { throw Error("capture secret detail"); } });
    expect(await f.answer(await request())).toEqual({ outcome: "failed", reason: "capture_failed", effect: "not_sent" });
    expect(f.sent).toEqual([]);
  });
  test("capture timeout aborts, sends nothing, and a late resolution cannot resume the action", async () => {
    const pending = deferred<string>(), signals: AbortSignal[] = []; let sends = 0;
    const f = fixture(pane, { limits: { captureTimeoutMs: 5 }, capture: async (_r, { signal }) => { signals.push(signal); return pending.promise; }, sendKeys: async () => { sends++; } });
    const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "capture_timeout", effect: "not_sent" });
    expect(signals[0]!.aborted).toBe(true); expect(sends).toBe(0);
    expect(await f.answer(input)).toMatchObject({ outcome: "refused", reason: "busy" });
    pending.resolve(pane); await Bun.sleep(0); expect(sends).toBe(0);
  });
  test.each(["null", "throw", "truncated", "timeout"])("post-send %s capture is unverified", async mode => {
    let reads = 0; const signals: AbortSignal[] = [];
    const f = fixture(pane, { limits: { captureTimeoutMs: 5, verificationTimeoutMs: 20 }, capture: async (_r, { signal }) => {
      if (reads++ === 0) return pane;
      if (mode === "null") return null;
      if (mode === "throw") throw Error("gone");
      if (mode === "truncated") return { body: "", truncated: true };
      signals.push(signal); return new Promise<string>(() => {});
    } });
    const result = await f.answer(await request());
    expect(result).toMatchObject({ outcome: "unverified", effect: "sent" }); expect(f.sent).toEqual([["1"]]);
    if (mode === "timeout") { expect(result.reason).toBe("capture_timeout"); expect(signals[0]!.aborted).toBe(true); }
  });
  test("send rejection is an unknown effect and cannot be blindly replayed", async () => {
    let sends = 0;
    const f = fixture(pane, { sendKeys: async () => { sends++; throw Error("may already have sent"); } });
    const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "failed", reason: "send_failed", effect: "unknown" });
    expect(await f.answer(input)).toMatchObject({ outcome: "refused", reason: "already_attempted" }); expect(sends).toBe(1);
  });
  test("send timeout aborts and retains the busy slot until an ignoring transport settles", async () => {
    const pending = deferred<void>(); let transportSignal: AbortSignal | undefined, sends = 0;
    const f = fixture(pane, { limits: { sendTimeoutMs: 5 }, sendKeys: async (_r, _keys, { signal }) => { transportSignal = signal; sends++; await pending.promise; } });
    const input = await request();
    expect(await f.answer(input)).toEqual({ outcome: "unverified", reason: "send_timeout", effect: "unknown" });
    expect(transportSignal!.aborted).toBe(true);
    expect(await f.answer(input)).toMatchObject({ outcome: "refused", reason: "busy" });
    pending.resolve(); await Bun.sleep(0);
    expect(await f.answer(input)).toMatchObject({ outcome: "refused", reason: "already_attempted" }); expect(sends).toBe(1);
  });
  test("settled and uncertain attempts consume the version, including identical ABA content", async () => {
    const f = fixture(); const input = await request();
    expect((await f.answer(input)).outcome).toBe("answered");
    expect(await f.answer(input)).toMatchObject({ outcome: "refused", reason: "already_attempted" }); expect(f.sent).toHaveLength(1);
  });
  test("simultaneous answers for one pane, even host-session aliases, cannot both capture/send", async () => {
    const pending = deferred<string>(); let reads = 0;
    const f = fixture(pane, { capture: async () => { reads++; return pending.promise; } }); const input = await request();
    const first = f.answer(input);
    const alias = { ...input, target: { ...input.target, ref: { ...input.target.ref, hostSession: "alias" } } };
    expect(await f.answer(alias)).toMatchObject({ outcome: "refused", reason: "busy" });
    pending.resolve(""); expect((await first).outcome).toBe("gone"); expect(reads).toBe(1); expect(f.sent).toEqual([]);
  });
  test("aborted before capture, during capture, and after send never claims an answer", async () => {
    const stopped = new AbortController(); stopped.abort(); const f = fixture();
    expect(await f.answer({ ...await request(), signal: stopped.signal })).toMatchObject({ outcome: "failed", reason: "aborted", effect: "not_sent" }); expect(f.events).toEqual([]);
    const inCapture = new AbortController();
    const a = fixture(pane, { capture: async () => { inCapture.abort(); return pane; } });
    expect(await a.answer({ ...await request(), signal: inCapture.signal })).toMatchObject({ outcome: "failed", effect: "not_sent" }); expect(a.sent).toEqual([]);
    const inSend = new AbortController();
    const b = fixture(pane, { sendKeys: async () => { inSend.abort(); } });
    expect(await b.answer({ ...await request(), signal: inSend.signal })).toMatchObject({ outcome: "unverified", reason: "aborted", effect: "unknown" });
  });
  test("only exact local Claude pane refs and real version syntax can perform I/O", async () => {
    const input = await request(), f = fixture();
    const bad = [
      { ...input, promptVersion: "bad" }, { ...input, option: "always" },
      { ...input, target: { ...input.target, harness: "codex" } },
      { ...input, target: { ...input.target, ref: { ...input.target.ref, nodeId: "remote" } } },
      { ...input, target: { ...input.target, ref: { ...input.target.ref, paneId: undefined } } },
      { ...input, target: { ...input.target, ref: { ...input.target.ref, paneId: "pane-alias" } } },
      { ...input, target: { ...input.target, nativeSession: { nodeId: "other", harness: "claude", nativeSessionId: "x" } } },
    ];
    for (const value of bad) expect((await f.answer(value as TmuxHostAttentionAnswerInput)).outcome).toBe("refused");
    const unknown = createTmuxHostAttentionAnswerer({ nodeId: null, capture: async () => { throw Error("must not capture"); }, sendKeys: async () => { throw Error("must not send"); } });
    expect(await unknown(input)).toMatchObject({ outcome: "refused", reason: "local_identity_unknown" }); expect(f.events).toEqual([]);
  });
  test("ref, native identity, version and option are snapshotted across callbacks", async () => {
    const row = target(); row.nativeSession = { nodeId: "local", harness: "claude", nativeSessionId: "real" };
    const input = await request(pane, row); const refs: unknown[] = [];
    let reads = 0;
    const f = fixture(pane, { capture: async (ref, context) => {
      refs.push({ ...ref }); ref.nodeId = "mutated";
      context.target.nativeSession!.nativeSessionId = "mutated";
      input.target.ref.nodeId = "changed"; input.target.nativeSession!.nativeSessionId = "changed";
      input.promptVersion = "changed"; input.option = "deny";
      return reads++ === 0 ? pane : "❯ ";
    } });
    expect((await f.answer(input)).outcome).toBe("answered"); expect(f.sent).toEqual([["1"]]);
    expect(refs).toEqual([target().ref, target().ref]);
  });
  test("numeric keys ignore cursor drift; deny is plain No or Escape, never persistent allow", async () => {
    for (const [body, option, key] of [
      [pane.replace("❯ 2. No", "  2. No").replace("1. Yes", "❯ 1. Yes"), "approve", "1"],
      [pane, "deny", "2"],
      [pane.replace("2. No", "2. Yes, and don't ask again"), "deny", "Escape"],
    ] as const) {
      const f = fixture(body); expect((await f.answer({ ...await request(body), option })).outcome).toBe("answered"); expect(f.sent).toEqual([[key]]);
    }
  });
  test.each(["always", "duplicate", "gap", "wrapped"])("unsupported %s option layouts cannot send", async mode => {
    const body = mode === "always" ? pane.replace("1. Yes", "1. Yes always") : mode === "duplicate" ? pane.replace("2. No", "1. No") : mode === "gap" ? pane.replace("2. No", "3. No") : pane.replace("1. Yes", "1. Yes\n  wrapped option");
    const f = fixture(body); expect(await f.answer(await request(body))).toMatchObject({ outcome: "refused", reason: "unsupported_options" }); expect(f.sent).toEqual([]);
  });
  test("polls a delayed disappearance without sending again", async () => {
    let reads = 0;
    const f = fixture(pane, { limits: { maxVerificationCaptures: 3 }, capture: async () => ++reads < 3 ? pane : "❯ " });
    expect((await f.answer(await request())).outcome).toBe("answered"); expect(reads).toBe(3); expect(f.sent).toEqual([["1"]]);
  });
  test("verification timeout bounds polling independently of the capture timeout", async () => {
    let reads = 0;
    const f = fixture(pane, { limits: { verificationTimeoutMs: 5 }, capture: async () => reads++ ? new Promise<string>(() => {}) : pane });
    expect(await f.answer(await request())).toMatchObject({ outcome: "unverified", reason: "capture_timeout", effect: "sent" }); expect(reads).toBe(2);
  });
  test("six occupied callbacks retain the global ceiling after timeouts", async () => {
    const signals: AbortSignal[] = []; let reads = 0;
    const answer = createTmuxHostAttentionAnswerer({ nodeId: "local", limits: { captureTimeoutMs: 5, maxConcurrentAnswers: 999 },
      capture: async (_r, { signal }) => { signals.push(signal); reads++; return new Promise<string>(() => {}); }, sendKeys: async () => { throw Error("no sends"); } });
    const input = await request();
    const outcomes = await Promise.all(Array.from({ length: 7 }, (_, i) => answer({ ...input, target: { ...input.target, ref: { ...input.target.ref, paneId: `%${i}` } } })));
    expect(reads).toBe(6); expect(outcomes.filter(row => row.reason === "busy")).toHaveLength(1); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(await answer(input)).toMatchObject({ outcome: "refused", reason: "busy" });
  });
  test("attempt capacity cannot evict a replay tombstone or be exceeded by concurrent preflights", async () => {
    const first = deferred<string>(), second = deferred<string>(); let reads = 0;
    const answer = createTmuxHostAttentionAnswerer({ nodeId: "local", limits: { maxAttempts: 1, maxVerificationCaptures: 1 },
      capture: async () => ++reads === 1 ? first.promise : reads === 2 ? second.promise : "❯ ", sendKeys: async () => {} });
    const input = await request(); const another = await request(pane, { ...target(), ref: { ...target().ref, paneId: "%43" } });
    const one = answer(input), two = answer(another); await Bun.sleep(0);
    first.resolve(pane); second.resolve(pane);
    expect((await Promise.all([one, two])).map(r => r.outcome).sort()).toEqual(["answered", "refused"]);
    expect(await answer(input)).toMatchObject({ outcome: "refused", reason: "already_attempted" });
    expect(await answer(another)).toMatchObject({ outcome: "refused", reason: "attempt_capacity" });
  });
  test("limits can only lower hard ceilings", () => {
    expect(TMUX_HOST_ATTENTION_ANSWER_LIMITS).toMatchObject({ captureTimeoutMs: 2000, sendTimeoutMs: 2000, verificationTimeoutMs: 2000, maxConcurrentAnswers: 6, maxAttempts: 256 });
  });
});
