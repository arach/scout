import { describe, expect, spyOn, test } from "bun:test";
import type { TmuxHostAttentionTarget } from "@openscout/protocol";
import {
  collectTmuxHostAttention as collect, detectClaudeTmuxHostAttention as detect,
  TMUX_HOST_ATTENTION_LIMITS as limits,
} from "./host-attention.js";
import { livePermissionPrompt as pane } from "./test-helpers/tmux-host-attention-fixture.test.js";

function target(overrides: Partial<TmuxHostAttentionTarget> = {}): TmuxHostAttentionTarget {
  return { ref: { nodeId: "node-1", backend: "tmux", hostSession: "session:exact", paneId: "%42" },
    harness: "claude", label: "Agent One", agentId: "agent-1", ...overrides };
}
async function read(body: string = pane, row = target()) {
  return collect({ nodeId: "node-1", targets: [row], capture: async () => body, now: 123 });
}
async function version(body = pane, row = target()) {
  return (await read(body, row)).observations[0]!.prompt?.promptVersion;
}

describe("pure Claude tmux dialog detector", () => {
  test("preserves the active permission fixture and bounded previews", () => {
    expect(detect(pane)).toMatchObject({
      title: "Claude needs permission", summary: "Permission rule Bash(curl:*) requires confirmation.",
      detail: "curl -s -m 5 http://127.0.0.1:29980/api/files",
      content: { permissionRule: "Bash(curl:*)", question: "Do you want to proceed?",
        options: ["1. Yes", "2. No"] },
    });
  });
  test("does not resurrect an old prompt once tool output follows it", () => {
    expect(detect(`${pane}\n⏺ Read(src/model.ts)\n  ⎿ Read 20 lines`)).toBeNull();
  });
  test.each([["inline", "❯ "], ["boxed", "│ > "]])("clears a resolved %s composer", (_kind, composer) => {
    expect(detect(`${pane}\n${composer}`)).toBeNull();
  });
  test("requires a nearby rule, question and confirmation footer", () => {
    expect(detect("")).toBeNull();
    expect(detect(pane.replace("Do you want to proceed?", "Finished."))).toBeNull();
    expect(detect(pane.replace("Esc to cancel", "done"))).toBeNull();
    expect(detect(pane.replace("Permission rule", "Rule"))).toBeNull();
    expect(detect(pane.replace("Do you want to proceed?", "\n".repeat(20) + "Do you want to proceed?"))).toBeNull();
  });
  test("rejects over-limit UTF-8 rather than parsing an unbounded body", () => {
    expect(detect(pane + "😀".repeat(limits.maxCaptureBytes / 4))).toBeNull();
  });
});

describe("bounded machine-local host reads", () => {
  test("passes exact refs and context, serializes host provenance and has no native prompt id", async () => {
    const row = target({ nativeSession: { nodeId: "node-1", harness: "claude", nativeSessionId: "native-real" } });
    const result = await collect({ nodeId: "node-1", targets: [row], now: 123, capture: async (ref, context) => {
      expect(ref).toEqual(row.ref);
      expect(context.target).toEqual({ harness: row.harness, label: row.label, agentId: row.agentId, nativeSession: row.nativeSession });
      expect(context.maxBytes).toBe(49_152);
      expect(context.signal.aborted).toBe(false);
      ref.hostSession = "callback cannot change identity";
      return pane;
    } });
    expect(result).toMatchObject({ schema: "scout.tmux-host-attention/v1", scope: "machine-local-operator",
      availability: "available", coverage: { requested: 1, scanned: 1, omitted: 0, complete: true } });
    expect(result.observations[0]).toMatchObject({ ref: row.ref, observedAt: 123,
      source: "tmux_pane", provenance: "inferred", detector: "claude_permission_dialog",
      availability: "available", prompt: { promptIdentity: null } });
    expect(result.observations[0]!.prompt!.promptVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  test("native session remains absent unless supplied; pane is not a harness session", async () => {
    const row = (await read()).observations[0]!;
    expect(row.nativeSession).toBeUndefined();
    expect(row.prompt?.promptIdentity).toBeNull();
    expect((await read(pane, target({ ref: { nodeId: "node-1", backend: "tmux", hostSession: "only-session" } })))
      .observations[0]?.ref).toEqual({ nodeId: "node-1", backend: "tmux", hostSession: "only-session" });
  });
  test("null, throw, and rejection are unavailable, empty text is a successful no-prompt read", async () => {
    const result = await collect({ nodeId: "node-1", targets: Array.from({ length: 4 }, (_, i) => target({ agentId: String(i) })),
      capture: async (_ref, { target: row }) => {
        if (row.agentId === "0") return null;
        if (row.agentId === "1") throw new Error("gone");
        if (row.agentId === "2") return Promise.reject(new Error("gone"));
        return "";
      } });
    expect(result.availability).toBe("partial");
    expect(result.observations.map(row => [row.availability, row.reason, row.prompt])).toEqual([
      ["unavailable", "capture_failed", null], ["unavailable", "capture_failed", null],
      ["unavailable", "capture_failed", null], ["available", null, null],
    ]);
  });
  test("unknown local identity, remote refs, invalid refs/session links, unsupported harness do not capture", async () => {
    let calls = 0;
    const capture = async () => { calls++; return pane; };
    const unknown = await collect({ nodeId: null, targets: [target()], capture });
    expect(unknown.availability).toBe("unknown");
    expect(unknown.observations[0]?.reason).toBe("local_identity_unknown");
    const result = await collect({ nodeId: "node-1", capture, targets: [
      target({ ref: { ...target().ref, nodeId: "node-2" } }),
      target({ ref: { ...target().ref, hostSession: " bad " } }),
      target({ ref: { ...target().ref, paneId: "\u0000" } }),
      target({ harness: "codex" }),
      target({ nativeSession: { nodeId: "node-2", harness: "claude", nativeSessionId: "x" } }),
      target({ nativeSession: { nodeId: "node-1", harness: "codex", nativeSessionId: "x" } }),
      target({ nativeSession: { nodeId: "node-1", harness: "claude", nativeSessionId: "" } }),
    ] });
    expect(result.observations.map(row => row.reason)).toEqual(["nonlocal_ref", "invalid_ref", "invalid_ref",
      "unsupported_harness", "invalid_ref", "invalid_ref", "invalid_ref"]);
    expect(result.coverage.scanned).toBe(0);
    expect(calls).toBe(0);
  });
  test("all failed and zero-ref reads do not claim a complete fleet scan", async () => {
    expect((await collect({ nodeId: "node-1", targets: [target()], capture: async () => null })).availability).toBe("unavailable");
    const empty = await collect({ nodeId: "node-1", targets: [], capture: async () => { throw new Error("never"); } });
    expect(empty).toMatchObject({ availability: "available", coverage: { kind: "provided_terminal_refs", requested: 0, complete: true } });
  });
  test("enforces the 24 candidate ceiling and 6 concurrent captures", async () => {
    let active = 0, maximum = 0, calls = 0;
    const result = await collect({ nodeId: "node-1", targets: Array.from({ length: 30 }, () => target()),
      limits: { maxCandidates: 999, captureConcurrency: 999, captureTimeoutMs: 999_999 },
      capture: async () => {
        calls++; maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 1)); active--; return pane;
      } });
    expect(calls).toBe(24); expect(maximum).toBe(6);
    expect(result).toMatchObject({ availability: "partial", coverage: {
      maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2000, scanned: 24, omitted: 6, complete: false } });
  });
  test("timeout aborts and retires occupied slots even if the capture ignores abort", async () => {
    const signals: AbortSignal[] = [];
    const result = await collect({ nodeId: "node-1", targets: Array.from({ length: 24 }, () => target()),
      limits: { captureTimeoutMs: 5 }, capture: async (_ref, { signal }) => {
        signals.push(signal); return await new Promise<string>(() => {});
      } });
    expect(signals).toHaveLength(6);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(result.observations.filter(row => row.reason === "capture_timeout")).toHaveLength(6);
    expect(result.observations.filter(row => row.reason === "capture_capacity")).toHaveLength(18);
    expect(result.coverage).toMatchObject({ scanned: 6, complete: false });
    expect(result.availability).not.toBe("available");
  });
  test("lower and nonfinite caller limits cannot raise ceilings or discard all work accidentally", async () => {
    const none = await collect({ nodeId: "node-1", targets: [target()], limits: { maxCandidates: 0 }, capture: async () => pane });
    expect(none).toMatchObject({ availability: "not_scanned", observations: [], coverage: { omitted: 1, scanned: 0 } });
    const result = await collect({ nodeId: "node-1", targets: [target()], capture: async () => "",
      limits: { maxCandidates: NaN, captureConcurrency: Infinity, captureTimeoutMs: -5 } });
    expect(result.coverage).toMatchObject({ maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 1 });
  });
  test("truncated and oversize captures are partial and never bind a prompt version", async () => {
    for (const body of [{ body: pane, truncated: true }, { body: pane + "😀".repeat(13_000) }]) {
      const result = await collect({ nodeId: "node-1", targets: [target()], capture: async () => body });
      expect(result.availability).toBe("partial");
      expect(result.observations[0]).toMatchObject({ availability: "partial", reason: "capture_truncated",
        coverage: { truncated: true }, prompt: null });
      expect(result.observations[0]!.coverage.capturedBytes).toBeLessThanOrEqual(49_152);
    }
  });
  test("snapshots identity and count before asynchronous capture", async () => {
    const row = target(), targets = [row];
    const result = await collect({ nodeId: "node-1", targets, capture: async () => {
      row.ref.nodeId = "mutated"; row.label = "mutated"; targets.push(target()); return pane;
    } });
    expect(result.observations[0]?.ref.nodeId).toBe("node-1");
    expect(result.observations[0]?.label).toBe("Agent One");
    expect(result.coverage).toMatchObject({ requested: 1, omitted: 0 });
  });
});

describe("dialog content versions, not prompt incarnation or answer authority", () => {
  test("stable across time, labels, ANSI, whitespace, selected option and trailing task noise", async () => {
    const original = await version();
    const changedPresentation = pane.replace("❯ 2. No", "  2. No").replace("   1. Yes", " ❯ 1. Yes")
      .replace("Bash command", "\x1b[32mBash command\x1b[0m").replace("Permission rule", "Permission   rule")
      .replace("4 tasks", "5 tasks");
    expect(await version(changedPresentation, target({ label: "Renamed", agentId: "another" }))).toBe(original);
    const atLaterTime = await collect({ nodeId: "node-1", targets: [target()], now: 987, capture: async () => pane });
    expect(atLaterTime.observations[0]?.prompt?.promptVersion).toBe(original);
  });
  test("changes with exact ref, genuine session identity, options, footer, command or rule", async () => {
    const original = await version();
    for (const body of [pane.replaceAll("curl -s -m 5", "curl -v -m 5"), pane.replace("Bash(curl:*)", "Bash(*)"),
      pane.replace("1. Yes", "1. Yes always"), pane.replace("/permissions to update rules", "/permissions to change policy"), pane.replace("ctrl+e to explain", "ctrl+e for details")]) {
      expect(await version(body)).not.toBe(original);
    }
    for (const ref of [{ ...target().ref, paneId: "%43" }, { ...target().ref, hostSession: "other" }]) {
      expect(await version(pane, target({ ref }))).not.toBe(original);
    }
    expect(await version(pane, target({ nativeSession: { nodeId: "node-1", harness: "claude", nativeSessionId: "real" } }))).not.toBe(original);
  });
  test("full command changes beyond a 500-character preview still change the version", async () => {
    const command = "x".repeat(700);
    const one = pane.replace("   curl -s -m 5", "   " + command + "A curl -s -m 5");
    const two = one.replace(command + "A", command + "B");
    expect(detect(one)?.detail?.length).toBe(500);
    expect(detect(one)?.detail).toBe(detect(two)?.detail);
    expect(await version(one)).not.toBe(await version(two));
    const longRule = pane.replace("Bash(curl:*)", "Bash(" + "y".repeat(400) + ")");
    expect(detect(longRule)?.summary.length).toBe(200);
  });
  test("identical content can recur (ABA); a content version cannot authorize an answer", async () => {
    expect(await version()).toBe(await version()); // Deliberately no incarnation claim.
  });
});

test("a cold subpath import does not spawn through Bun or capture by default", async () => {
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("import spawned"); });
  try {
    const specifier = "./host-attention.ts?pure-import";
    const imported = await import(specifier);
    expect(imported.collectTmuxHostAttention).toBeFunction();
    expect(spawn).not.toHaveBeenCalled();
  } finally { spawn.mockRestore(); }
});
