import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { displayPath, readTerminalGitContext, expandHerdrAgents, inferHarness, parseLeftRight, parsePorcelainCounts, pickContextAgents } from "./terminal-context.ts";

function session(
  id: string,
  harness: string,
  cwd: string,
  state: "live" | "detached" | "exited",
  origin: "registry" | "discovered" = "registry",
): TerminalSessionRecord {
  return {
    id,
    harness,
    sourceSessionId: id,
    cwd,
    resumeCommand: "",
    origin,
    surfaces: [
      {
        backend: "tmux",
        sessionName: id,
        paneId: null,
        attachCommand: [],
        observeCommand: null,
        relay: {} as TerminalSessionRecord["surfaces"][number]["relay"],
        state,
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("terminal context", () => {
  test("counts staged, modified and untracked from porcelain", () => {
    expect(parsePorcelainCounts("M  a.ts\n M b.ts\nMM c.ts\n?? d.ts\nA  e.ts\n")).toEqual({
      staged: 3,
      modified: 2,
      untracked: 1,
    });
    expect(parsePorcelainCounts("")).toEqual({ staged: 0, modified: 0, untracked: 0 });
  });

  test("reads behind/ahead from rev-list left-right", () => {
    expect(parseLeftRight("57\t0\n")).toEqual({ behind: 57, ahead: 0 });
    expect(parseLeftRight(null)).toEqual({ ahead: null, behind: null });
  });

  test("shortens paths under home", () => {
    expect(displayPath("/Users/art", "/Users/art")).toBe("~");
    expect(displayPath("/Users/art/dev/openscout", "/Users/art")).toBe("~/dev/openscout");
    expect(displayPath("/tmp", "/Users/art")).toBe("/tmp");
  });

  test("keeps live sessions in the checkout, registry first then by name", () => {
    const sessions = [
      session("a", "claude", "/r/openscout", "live"),
      session("b", "codex", "/r/openscout/packages/web", "live"),
      session("c", "claude", "/r/openscout-other", "live"),
      session("d", "claude", "/r/openscout", "exited"),
      session("e", "", "/r/openscout", "live", "discovered"),
    ];
    const inCheckout = pickContextAgents(sessions, "/r/openscout");
    expect(inCheckout.map((a) => a.id)).toEqual(["a", "b", "e"]);
    expect(inCheckout[2]?.harness).toBeNull();
    expect(inferHarness("2.1.280")).toBe("claude");
    expect(inferHarness("zsh")).toBeNull();
    expect(pickContextAgents(sessions, null).map((a) => a.id)).toEqual(["a", "b", "c", "e"]);
  });

  test("swaps a running herdr session for its agent panes", () => {
    const [herdr] = pickContextAgents([session("scout", "", "/r/openscout", "live", "discovered")], null);
    herdr!.backend = "herdr";
    const pane = (paneId: string, agent: string | null, label: string, cwd: string) => ({
      paneId, terminalId: null, tabId: "t1", workspaceId: "w1", label, agent,
      agentStatus: agent ? ("working" as const) : ("unknown" as const),
      agentSession: null, cwd, foregroundCwd: cwd, focused: false, scroll: null,
    });
    const topology = {
      session: "scout", running: true, observedAt: 0,
      workspaces: [{
        workspaceId: "w1", label: null, number: 1, focused: true, activeTabId: "t1", agentStatus: "working" as const,
        tabs: [{
          tabId: "t1", workspaceId: "w1", label: null, number: 1, focused: true, agentStatus: "working" as const, layout: null,
          panes: [
            pane("p1", "claude", "Talkie Capture page layout", "/r/openscout"),
            pane("p2", null, "zsh", "/r/openscout"),
            pane("p3", "codex", "elsewhere", "/r/other"),
          ],
        }],
      }],
    };
    const expanded = expandHerdrAgents([herdr!], new Map([["scout", topology]]), "/r/openscout");
    expect(expanded.map((a) => [a.title, a.harness, a.state])).toEqual([["Talkie Capture page layout", "claude", "working"]]);
    expect(expandHerdrAgents([herdr!], new Map(), "/r/openscout")).toEqual([herdr!]);
  });

  test("never runs the repo's own fsmonitor when reading a client-named cwd", async () => {
    const repo = mkdtempSync(join(tmpdir(), "scout-term-ctx-"));
    try {
      const marker = join(repo, "fsmonitor-ran");
      const hook = join(repo, "fsmonitor.sh");
      writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(hook, 0o755);
      execFileSync("git", ["init", "-q"], { cwd: repo });
      execFileSync("git", ["config", "core.fsmonitor", hook], { cwd: repo });
      const context = await readTerminalGitContext(repo);
      expect(context).not.toBeNull();
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
