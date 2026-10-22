import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { HerdrHostAttentionBinding, HerdrHostAttentionTarget, HostAttentionAnswerResult } from "@openscout/protocol";
import { collectHerdrHostAttention as collect, collectTmuxHostAttention, detectClaudeTmuxHostAttention,
  HERDR_HOST_ATTENTION_LIMITS as limits, type HerdrHostAttentionCapture, type HerdrHostAttentionCaptureEvidence,
  type HerdrHostAttentionAnswer, type TmuxHostAttentionAnswer } from "./host-attention.js";
import { livePermissionPrompt as pane } from "./test-helpers/tmux-host-attention-fixture.test.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const tmuxAlias: Equal<TmuxHostAttentionAnswer, HostAttentionAnswerResult> = true;
const herdrAlias: Equal<HerdrHostAttentionAnswer, HostAttentionAnswerResult> = true;
function target(): HerdrHostAttentionTarget {
  return { ref: { nodeId: "local", backend: "herdr", hostSession: "exact:session", paneId: "w1:p2" },
    terminalId: "term_real", workspaceId: "w1", tabId: "w1:t1", harness: "claude", label: "Claude", agentId: "agent",
    nativeSession: { agent: "claude", kind: "session_id", source: "hook", value: "native_real" } };
}
function evidence(row = target(), body = pane): HerdrHostAttentionCaptureEvidence {
  return { source: "herdr_visible", freshness: "live", before: structuredClone(row), after: structuredClone(row), body, truncated: false };
}
async function read(body = pane, row = target()) {
  return collect({ nodeId: "local", targets: [row], now: 123, capture: async () => evidence(row, body) });
}
async function version(body = pane, row = target()) { return (await read(body, row)).observations[0]!.prompt?.promptVersion; }
const cast = (value: unknown): HerdrHostAttentionCapture => async () => value as HerdrHostAttentionCaptureEvidence;

describe("strict injected Herdr observations, never actuation", () => {
  test("backend receipts are field-for-field aliases of the shared protocol result", () => {
    expect(tmuxAlias && herdrAlias).toBe(true);
    const reasons: HostAttentionAnswerResult["reason"][] = ["authority_refused", "claimed_elsewhere", "claim_unavailable", "audit_failed", "target_changed"];
    const receipts: HerdrHostAttentionAnswer[] = reasons.map(reason => ({ outcome: "refused", effect: "not_sent", reason }));
    const tmux: TmuxHostAttentionAnswer[] = receipts;
    expect(JSON.parse(JSON.stringify(tmux))).toEqual(receipts);
  });
  test("requires a callback but does no default host I/O; exact copied refs/context and serializable evidence", async () => {
    const row = target(); let calls = 0;
    const result = await collect({ nodeId: "local", targets: [row], now: 123, capture: async (copy, options) => {
      calls++; expect(copy).toEqual(row); expect(options.maxBytes).toBe(49152); expect(options.signal.aborted).toBe(false);
      const value = evidence(copy); copy.ref.hostSession = "mutation"; copy.nativeSession!.value = "mutation";
      return value;
    } });
    expect(calls).toBe(1);
    expect(result).toMatchObject({ schema: "scout.herdr-host-attention/v1", scope: "machine-local-operator", nodeId: "local",
      availability: "available", coverage: { requested: 1, scanned: 1, omitted: 0, complete: true } });
    expect(result.observations[0]).toMatchObject({ ref: row.ref, terminalId: "term_real", nativeSession: row.nativeSession,
      source: "herdr_visible", provenance: "inferred", prompt: { promptIdentity: null } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  test("the exact domain-separated full-content tuple defines the version, not the numeric legacy fingerprint", async () => {
    const row = target(), native = row.nativeSession!;
    const binding = JSON.stringify(["local", "herdr", "exact:session", "w1:p2", "term_real", "w1", "w1:t1", "claude",
      [native.agent, native.kind, native.source, native.value]]);
    const expected = `sha256:${createHash("sha256").update(JSON.stringify(["claude-herdr-permission-v1", binding, null, detectClaudeTmuxHostAttention(pane)!.content])).digest("hex")}`;
    expect(await version()).toBe(expected);
    const tmux = await collectTmuxHostAttention({ nodeId: "local", targets: [{ ref: { ...row.ref, backend: "tmux", paneId: "%42" }, harness: "claude", label: "Claude" }], capture: async () => pane });
    expect(await version()).not.toBe(tmux.observations[0]!.prompt!.promptVersion);
    expect(typeof await version()).toBe("string");
  });
  test("full command changes beyond the preview and native binding changes alter the version", async () => {
    const long = "x".repeat(700), a = pane.replace("   curl -s -m 5", `   ${long}A curl -s -m 5`), b = a.replace(long + "A", long + "B");
    expect(detectClaudeTmuxHostAttention(a)!.detail).toBe(detectClaudeTmuxHostAttention(b)!.detail);
    expect(await version(a)).not.toBe(await version(b));
    const original = await version();
    for (const key of ["terminalId", "workspaceId", "tabId"] as const) { const row = target(); row[key] += "changed"; expect(await version(pane, row)).not.toBe(original); }
    for (const key of ["hostSession", "paneId", "nodeId"] as const) {
      const row = target(); row.ref[key] += "changed";
      const result = await collect({ nodeId: row.ref.nodeId, targets: [row], capture: async () => evidence(row) });
      expect(result.observations[0]!.prompt!.promptVersion).not.toBe(original);
    }
    for (const key of ["kind", "source", "value"] as const) { const row = target(); row.nativeSession![key] += "changed"; expect(await version(pane, row)).not.toBe(original); }
  });
  test("presentation, time, cursor, and trailing task noise do not identify an incarnation", async () => {
    const row = target(); row.label = "renamed"; row.agentId = "other";
    const rendered = pane.replace("Bash command", "\x1b[32mBash command\x1b[0m").replace("❯ 2. No", "  2. No").replace("   1. Yes", " ❯ 1. Yes").replace("4 tasks", "9 tasks");
    expect(await version(rendered, row)).toBe(await version());
    expect(await version()).toBe(await version()); // Identical recurrence remains the same content version.
  });
  test("supplied identities and candidate count are snapshotted across callback awaits", async () => {
    const row = target(), targets = [row]; const expected = evidence(row);
    const result = await collect({ nodeId: "local", targets, capture: async () => {
      row.ref.nodeId = "mutated"; row.terminalId = "mutated"; row.nativeSession!.value = "mutated"; targets.push(target());
      await Bun.sleep(0); return expected;
    } });
    expect(result.observations[0]!.terminalId).toBe("term_real"); expect(result.observations[0]!.ref.nodeId).toBe("local");
    expect(result.observations[0]!.nativeSession!.value).toBe("native_real"); expect(result.coverage.requested).toBe(1);
    expect(result.availability).toBe("available");
  });
  test("unknown/nonlocal/invalid/unsupported refs and native links cannot start a callback", async () => {
    let calls = 0; const capture: HerdrHostAttentionCapture = async () => { calls++; return null; };
    expect((await collect({ nodeId: null, targets: [target()], capture })).observations[0]!.reason).toBe("local_identity_unknown");
    const remote = target(); remote.ref.nodeId = "remote";
    const noPane = target(); noPane.ref.paneId = "";
    const noTerminal = target(); noTerminal.terminalId = "";
    const badTab = target(); badTab.tabId = " bad ";
    const wrongBackend = target(); (wrongBackend.ref as { backend: string }).backend = "tmux";
    const unsupported = target(); unsupported.harness = "codex"; unsupported.nativeSession = undefined;
    const badNative = target(); badNative.nativeSession!.agent = "codex";
    const noNativeSource = target(); noNativeSource.nativeSession!.source = "";
    const result = await collect({ nodeId: "local", targets: [remote, noPane, noTerminal, badTab, wrongBackend, unsupported, badNative, noNativeSource], capture });
    expect(result.observations.map(row => row.reason)).toEqual(["nonlocal_ref", "invalid_ref", "invalid_ref", "invalid_ref", "invalid_ref", "unsupported_harness", "invalid_ref", "invalid_ref"]);
    expect(calls).toBe(0); expect(result.coverage.scanned).toBe(0);
  });
  test("malformed labels fail only their own rows closed", async () => {
    const malformed: unknown[] = [undefined, null, 0, {}, [], Symbol("bad label")];
    const targets = [target(), ...malformed.map(label => ({ ...target(), label: label as string })), target()];
    let calls = 0;
    const result = await collect({ nodeId: "local", targets, capture: async row => { calls++; return evidence(row); } });
    expect(calls).toBe(2); expect(result.availability).toBe("partial");
    expect(result.coverage).toMatchObject({ requested: 8, scanned: 2, omitted: 0, complete: false });
    for (const row of result.observations.slice(1, -1)) {
      expect(row).toMatchObject({ label: "", availability: "unknown", reason: "invalid_ref", prompt: null });
    }
    expect(result.observations[0]!.prompt).not.toBeNull(); expect(result.observations.at(-1)!.prompt).not.toBeNull();
  });
  test.each(["null", "plain", "missing_truncated", "error_envelope", "saved", "cached", "missing_binding"])("%s is not complete live capture evidence", async mode => {
    const value: unknown = mode === "null" ? null : mode === "plain" ? pane : mode === "error_envelope" ? { error: { code: "not_found" } }
      : mode === "saved" ? { ...evidence(), freshness: "saved" } : mode === "cached" ? { ...evidence(), freshness: "ttl_cached_probes" }
        : mode === "missing_binding" ? { ...evidence(), after: null } : { ...evidence(), truncated: undefined };
    const result = await collect({ nodeId: "local", targets: [target()], capture: cast(value) });
    expect(result.observations[0]).toMatchObject({ availability: "unavailable", reason: "capture_failed", prompt: null });
  });
  test("exceptions and rejections remain unavailable, never empty success", async () => {
    const result = await collect({ nodeId: "local", targets: [target()], capture: async () => { throw Error("native error text must not escape"); } });
    expect(result.availability).toBe("unavailable"); expect(result.observations[0]!.reason).toBe("capture_failed");
    expect(JSON.stringify(result)).not.toContain("native error text");
  });
  test.each(["before", "after"] as const)("%s binding replacement cannot mint a prompt", async side => {
    for (const field of ["terminalId", "workspaceId", "tabId", "harness", "nativeSession", "ref"] as const) {
      const value = evidence();
      if (field === "nativeSession") value[side].nativeSession!.value = "replacement";
      else if (field === "ref") value[side].ref.paneId = "w2:p3";
      else if (field === "harness") { value[side].harness = "codex"; value[side].nativeSession = undefined; }
      else value[side][field] += "replacement";
      const result = await collect({ nodeId: "local", targets: [target()], capture: cast(value) });
      expect(result.observations[0]).toMatchObject({ availability: "unavailable", reason: "target_changed", prompt: null });
    }
  });
  test("truncation and byte overflow cannot mint a version", async () => {
    for (const value of [{ ...evidence(), truncated: true }, evidence(target(), pane + "😀".repeat(13_000))]) {
      const result = await collect({ nodeId: "local", targets: [target()], capture: cast(value) });
      expect(result.availability).toBe("partial"); expect(result.observations[0]).toMatchObject({ reason: "capture_truncated", prompt: null });
      expect(result.observations[0]!.coverage.capturedBytes).toBeLessThanOrEqual(49152);
    }
  });
  test("a successful complete empty/live-composer capture has no recognized prompt", async () => {
    for (const body of ["", `${pane}\n❯ `]) {
      const result = await read(body); expect(result.availability).toBe("available"); expect(result.observations[0]!.prompt).toBeNull();
    }
  });
  test("candidate and concurrent worker bounds cannot be raised", async () => {
    let active = 0, maximum = 0, calls = 0;
    const result = await collect({ nodeId: "local", targets: Array.from({ length: 30 }, target),
      limits: { maxCandidates: 999, captureConcurrency: 999, captureTimeoutMs: 99999 }, capture: async row => {
        calls++; maximum = Math.max(maximum, ++active); await Bun.sleep(1); active--; return evidence(row);
      } });
    expect(calls).toBe(24); expect(maximum).toBe(6);
    expect(result).toMatchObject({ availability: "partial", coverage: { scanned: 24, omitted: 6, complete: false, maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2000 } });
    expect(limits.maxCaptureBytes).toBe(49152);
  });
  test("timeout aborts and retires worker slots while late callbacks cannot change results", async () => {
    const signals: AbortSignal[] = []; let finish!: (value: HerdrHostAttentionCaptureEvidence) => void;
    const pending = new Promise<HerdrHostAttentionCaptureEvidence>(resolve => { finish = resolve; });
    const result = await collect({ nodeId: "local", targets: Array.from({ length: 24 }, target), limits: { captureTimeoutMs: 5 },
      capture: async (_row, { signal }) => { signals.push(signal); return pending; } });
    expect(signals).toHaveLength(6); expect(signals.every(s => s.aborted)).toBe(true);
    expect(result.observations.filter(row => row.reason === "capture_timeout")).toHaveLength(6);
    expect(result.observations.filter(row => row.reason === "capture_capacity")).toHaveLength(18);
    const before = JSON.stringify(result); finish(evidence()); await Bun.sleep(0); expect(JSON.stringify(result)).toBe(before);
  });
  test("external abort before and during capture is explicit, not absence", async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    const before = await collect({ nodeId: "local", targets: [target()], signal: controller.signal, capture: async () => { calls++; return evidence(); } });
    expect(calls).toBe(0); expect(before.observations[0]!.reason).toBe("aborted");
    const during = new AbortController(); let observed!: AbortSignal;
    const result = await collect({ nodeId: "local", targets: [target()], signal: during.signal, capture: async (_row, { signal }) => {
      observed = signal; during.abort(); return new Promise<HerdrHostAttentionCaptureEvidence>(() => {});
    } });
    expect(observed.aborted).toBe(true); expect(result.observations[0]).toMatchObject({ availability: "unavailable", reason: "aborted", prompt: null });
  });
  test("zero, lower and nonfinite limits disclose omitted refs without claiming a fleet scan", async () => {
    const empty = await collect({ nodeId: "local", targets: [], capture: async () => { throw Error("never"); } });
    expect(empty).toMatchObject({ availability: "available", coverage: { kind: "provided_terminal_refs", requested: 0, complete: true } });
    const omitted = await collect({ nodeId: "local", targets: [target()], limits: { maxCandidates: 0 }, capture: async () => { throw Error("never"); } });
    expect(omitted).toMatchObject({ availability: "not_scanned", observations: [], coverage: { requested: 1, scanned: 0, omitted: 1, complete: false } });
    const lower = await collect({ nodeId: "local", targets: [target()], capture: async row => evidence(row), limits: { maxCandidates: NaN, captureConcurrency: Infinity, captureTimeoutMs: -1 } });
    expect(lower.coverage).toMatchObject({ maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 1 });
  });
});
