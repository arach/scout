import { describe, expect, test } from "bun:test";

import type { Adapter, AdapterConfig, AgentSessionStreamEvent, Session } from "./protocol/index.ts";
import { SessionRegistry } from "./registry.ts";

class TestApprovalAdapter implements Adapter {
  readonly type = "test";
  readonly session: Session;

  private eventListeners = new Set<(event: AgentSessionStreamEvent) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  readonly decisions: Array<{
    turnId: string;
    blockId: string;
    decision: "approve" | "deny";
    reason?: string;
  }> = [];

  constructor(private readonly config: AdapterConfig) {
    this.session = {
      id: config.sessionId,
      name: config.name ?? config.sessionId,
      adapterType: this.type,
      status: "connecting" as const,
      cwd: config.cwd,
    };
  }

  async start(): Promise<void> {
    this.session.status = "active";
    this.emit({
      event: "session:update",
      session: { ...this.session },
    });
  }

  send(): void {}

  interrupt(): void {}

  async shutdown(): Promise<void> {
    this.session.status = "closed";
  }

  decide(turnId: string, blockId: string, decision: "approve" | "deny", reason?: string): void {
    this.decisions.push({ turnId, blockId, decision, reason });
  }

  on(event: "event" | "error", listener: ((event: AgentSessionStreamEvent) => void) | ((error: Error) => void)): void {
    if (event === "event") {
      this.eventListeners.add(listener as (event: AgentSessionStreamEvent) => void);
      return;
    }

    this.errorListeners.add(listener as (error: Error) => void);
  }

  off(event: "event" | "error", listener: ((event: AgentSessionStreamEvent) => void) | ((error: Error) => void)): void {
    if (event === "event") {
      this.eventListeners.delete(listener as (event: AgentSessionStreamEvent) => void);
      return;
    }

    this.errorListeners.delete(listener as (error: Error) => void);
  }

  emit(event: AgentSessionStreamEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

describe("SessionRegistry", () => {
  test("shuts down and removes an adapter whose startup fails", async () => {
    let adapter: TestApprovalAdapter | undefined;
    let shutdownCalled = false;
    const registry = new SessionRegistry({
      adapters: {
        test: (config) => {
          adapter = new TestApprovalAdapter(config);
          adapter.start = async () => {
            throw new Error("startup rejected");
          };
          adapter.shutdown = async () => {
            shutdownCalled = true;
            adapter!.session.status = "closed";
          };
          return adapter;
        },
      },
    });

    await expect(registry.createSession("test", {
      sessionId: "failed-session",
    })).rejects.toThrow("startup rejected");

    expect(shutdownCalled).toBe(true);
    expect(registry.listSessions()).toEqual([]);
    expect(registry.getSessionSnapshot("failed-session")).toBeNull();
    expect(registry.currentSeq("failed-session")).toBe(0);
  });

  test("rejects stale approval decisions before invoking the adapter", async () => {
    let adapter: TestApprovalAdapter | undefined;

    const registry = new SessionRegistry({
      adapters: {
        test: (config) => {
          adapter = new TestApprovalAdapter(config);
          return adapter;
        },
      },
    });

    const session = await registry.createSession("test", {
      sessionId: "session-1",
      name: "Test Session",
    });

    adapter!.emit({
      event: "turn:start",
      sessionId: session.id,
      turn: {
        id: "turn-1",
        sessionId: session.id,
        status: "started",
        startedAt: new Date(0).toISOString(),
        blocks: [],
      },
    });

    adapter!.emit({
      event: "block:start",
      sessionId: session.id,
      turnId: "turn-1",
      block: {
        id: "block-1",
        turnId: "turn-1",
        type: "action",
        status: "streaming",
        index: 0,
        action: {
          kind: "tool_call",
          toolName: "test-tool",
          toolCallId: "tool-call-1",
          status: "awaiting_approval",
          output: "",
          approval: {
            version: 2,
            description: "Need approval",
            risk: "medium",
          },
        },
      },
    });

    expect(() =>
      registry.decide({
        sessionId: session.id,
        turnId: "turn-1",
        blockId: "block-1",
        version: 1,
        decision: "approve",
      }),
    ).toThrow("Stale approval version");

    expect(adapter!.decisions).toHaveLength(0);
  });

  test("forwards approval decisions when the version matches the current snapshot", async () => {
    let adapter: TestApprovalAdapter | undefined;

    const registry = new SessionRegistry({
      adapters: {
        test: (config) => {
          adapter = new TestApprovalAdapter(config);
          return adapter;
        },
      },
    });

    const session = await registry.createSession("test", {
      sessionId: "session-1",
      name: "Test Session",
    });

    adapter!.emit({
      event: "turn:start",
      sessionId: session.id,
      turn: {
        id: "turn-1",
        sessionId: session.id,
        status: "started",
        startedAt: new Date(0).toISOString(),
        blocks: [],
      },
    });

    adapter!.emit({
      event: "block:start",
      sessionId: session.id,
      turnId: "turn-1",
      block: {
        id: "block-1",
        turnId: "turn-1",
        type: "action",
        status: "streaming",
        index: 0,
        action: {
          kind: "tool_call",
          toolName: "test-tool",
          toolCallId: "tool-call-1",
          status: "awaiting_approval",
          output: "",
          approval: {
            version: 2,
            description: "Need approval",
            risk: "medium",
          },
        },
      },
    });

    registry.decide({
      sessionId: session.id,
      turnId: "turn-1",
      blockId: "block-1",
      version: 2,
      decision: "approve",
      reason: "looks good",
    });

    expect(adapter!.decisions).toEqual([
      { turnId: "turn-1", blockId: "block-1", decision: "approve", reason: "looks good" },
    ]);
    // No adapter status has arrived yet: a duplicate or opposite decision must
    // not cross the adapter boundary again while remote delivery is pending.
    for (const decision of ["approve", "deny"] as const) {
      expect(() => registry.decide({ sessionId: session.id, turnId: "turn-1", blockId: "block-1", version: 2, decision })).toThrow("already submitted");
    }
    expect(adapter!.decisions).toHaveLength(1);


    adapter!.emit({
      event: "block:action:status",
      sessionId: session.id,
      turnId: "turn-1",
      blockId: "block-1",
      status: "running",
    });
    expect(() => registry.decide({
      sessionId: session.id,
      turnId: "turn-1",
      blockId: "block-1",
      version: 2,
      decision: "approve",
    })).toThrow("Stale approval version");
    expect(adapter!.decisions).toHaveLength(1);
    adapter!.emit({ event: "block:action:status", sessionId: session.id, turnId: "turn-1", blockId: "block-1", status: "awaiting_approval" });
    adapter!.emit({ event: "block:action:approval", sessionId: session.id, turnId: "turn-1", blockId: "block-1", approval: { version: 3 } });
    registry.decide({ sessionId: session.id, turnId: "turn-1", blockId: "block-1", version: 3, decision: "deny" });
    expect(adapter!.decisions).toHaveLength(2);
    adapter!.emit({ event: "block:action:approval", sessionId: session.id, turnId: "turn-1", blockId: "block-1", approval: { version: 4 } });
    let attempts = 0;
    adapter!.decide = () => { attempts++; throw new Error("Delivery uncertain"); };
    const uncertain = { sessionId: session.id, turnId: "turn-1", blockId: "block-1", version: 4, decision: "approve" as const };
    expect(() => registry.decide(uncertain)).toThrow("Delivery uncertain");
    expect(() => registry.decide(uncertain)).toThrow("already submitted");
    expect(attempts).toBe(1);
  });

  test("turn-scoped interrupts reject stale, terminal and duplicate requests", async () => {
    let adapter!: TestApprovalAdapter;
    const registry = new SessionRegistry({ adapters: { test: config => (adapter = new TestApprovalAdapter(config)) } });
    await registry.createSession("test", { sessionId: "interrupt-session" });
    let calls = 0;
    adapter.interrupt = () => { calls++; };
    const start = (id: string) => adapter.emit({ event: "turn:start", sessionId: "interrupt-session", turn: {
      id, sessionId: "interrupt-session", status: "started", startedAt: new Date().toISOString(), blocks: [],
    } });
    expect(() => registry.interruptTurn("missing", "turn-1")).toThrow("No session");
    expect(() => registry.interruptTurn("interrupt-session", "turn-1")).toThrow("no longer active");
    start("turn-1");
    expect(() => registry.interruptTurn("interrupt-session", "stale")).toThrow("no longer active");
    registry.interruptTurn("interrupt-session", "turn-1");
    expect(calls).toBe(1);
    expect(registry.getSessionSnapshot("interrupt-session")?.turns[0]?.status).toBe("streaming");
    expect(() => registry.interruptTurn("interrupt-session", "turn-1")).toThrow("already submitted");
    start("turn-2");
    expect(() => registry.interruptTurn("interrupt-session", "turn-1")).toThrow("no longer active");
    adapter.interrupt = () => { calls++; throw new Error("Uncertain delivery"); };
    expect(() => registry.interruptTurn("interrupt-session", "turn-2")).toThrow("Uncertain delivery");
    expect(() => registry.interruptTurn("interrupt-session", "turn-2")).toThrow("already submitted");
    expect(calls).toBe(2);
    adapter.emit({ event: "turn:end", sessionId: "interrupt-session", turnId: "turn-2", status: "interrupted" });
    expect(() => registry.interruptTurn("interrupt-session", "turn-2")).toThrow("no longer active");
    await registry.closeSession("interrupt-session");
    await registry.createSession("test", { sessionId: "interrupt-session" });
    adapter.interrupt = () => { calls++; };
    start("turn-2");
    registry.interruptTurn("interrupt-session", "turn-2");
    expect(calls).toBe(3);
  });

  test("buffers replay independently per session", async () => {
    const adapters = new Map<string, TestApprovalAdapter>();
    const registry = new SessionRegistry({
      adapters: {
        test: (config) => {
          const adapter = new TestApprovalAdapter(config);
          adapters.set(config.sessionId, adapter);
          return adapter;
        },
      },
    });

    const first = await registry.createSession("test", {
      sessionId: "session-1",
      name: "First",
    });
    const second = await registry.createSession("test", {
      sessionId: "session-2",
      name: "Second",
    });

    const firstAdapter = adapters.get(first.id);
    const secondAdapter = adapters.get(second.id);
    expect(firstAdapter).toBeDefined();
    expect(secondAdapter).toBeDefined();

    firstAdapter!.emit({
      event: "turn:start",
      sessionId: first.id,
      turn: {
        id: "turn-first-1",
        sessionId: first.id,
        status: "started",
        startedAt: new Date(1).toISOString(),
        blocks: [],
      },
    });
    secondAdapter!.emit({
      event: "turn:start",
      sessionId: second.id,
      turn: {
        id: "turn-second-1",
        sessionId: second.id,
        status: "started",
        startedAt: new Date(2).toISOString(),
        blocks: [],
      },
    });
    firstAdapter!.emit({
      event: "turn:end",
      sessionId: first.id,
      turnId: "turn-first-1",
      status: "completed",
    });

    expect(registry.currentSeq(first.id)).toBe(3);
    expect(registry.currentSeq(second.id)).toBe(2);
    expect(registry.oldestBufferedSeq(first.id)).toBe(1);
    expect(registry.oldestBufferedSeq(second.id)).toBe(1);

    expect(registry.replay(first.id, 0).map((event) => event.event.event)).toEqual([
      "session:update",
      "turn:start",
      "turn:end",
    ]);
    expect(registry.replay(second.id, 0).map((event) => event.event.event)).toEqual([
      "session:update",
      "turn:start",
    ]);
    expect(registry.replay(second.id, 1).map((event) => event.event.event)).toEqual([
      "turn:start",
    ]);
  });
});

// This fixture owns git, not a coding harness. Its release file makes lookup
// completion an explicit event, so the proof is ordering rather than speed.
async function withBranchFixture(
  run: (fixture: { root: string; release: () => void; entered: () => Promise<void>; calls: string; mode: (value: string) => void; hideGit: () => void }) => Promise<void>,
): Promise<void> {
  const { mkdtempSync, writeFileSync, rmSync, existsSync, realpathSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scout-registry-branch-")));
  const oldPath = process.env.PATH;
  const release = join(root, "release"), entered = join(root, "entered"), mode = join(root, "mode"), calls = join(root, "calls");
  writeFileSync(mode, "branch");
  writeFileSync(join(root, "git"), `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));
writeFileSync(${JSON.stringify(entered)}, 'entered');
// Bound the fake independently of the parent: reintroducing sync spawn must
// not leave an indefinitely waiting fixture process.
const timer=setTimeout(()=>process.exit(79),2000);
while(!existsSync(${JSON.stringify(release)})) await Bun.sleep(2);
clearTimeout(timer);
switch(readFileSync(${JSON.stringify(mode)},'utf8')) {
 case 'branch': console.log('  feature/async-branch  '); break;
 case 'detached': console.log('HEAD'); break;
 case 'empty': console.log('   '); break;
 case 'failure': console.error('git: not a repository'); process.exitCode=128; break;
}
`, { mode: 0o755 });
  process.env.PATH = root;
  try {
    await run({ root, calls,
      release: () => writeFileSync(release, "release"),
      entered: async () => {
        for (let i = 0; i < 200; i++) { if (existsSync(entered)) return; await Bun.sleep(5); }
        throw new Error("fake git did not report entry");
      },
      mode: value => writeFileSync(mode, value),
      hideGit: () => { process.env.PATH = join(root, "absent"); },
    });
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    // Every test awaits creation/close, so the metadata child has completed.
    rmSync(root, { recursive: true, force: true });
  }
}

describe("SessionRegistry asynchronous branch discovery", () => {
  test("unknown adapter refusal occurs before any branch subprocess", async () => {
    await withBranchFixture(async fixture => {
      const { existsSync } = await import("node:fs");
      const registry = new SessionRegistry({ adapters: {} });
      await expect(registry.createSession("unknown", { cwd: fixture.root })).rejects.toThrow('Unknown adapter type: "unknown"');
      expect(existsSync(fixture.calls)).toBe(false);
    });
  });

  test("yields to the event loop, then supplies exact branch metadata before factory/start events", async () => {
    await withBranchFixture(async fixture => {
      const { readFileSync } = await import("node:fs");
      let factoryCalls = 0, startedBranch: unknown;
      const registry = new SessionRegistry({ adapters: { test: config => {
        factoryCalls++;
        const adapter = new TestApprovalAdapter(config);
        const start = adapter.start.bind(adapter);
        adapter.start = async () => { startedBranch = adapter.session.providerMeta?.branch; await start(); };
        return adapter;
      } } });
      const events: AgentSessionStreamEvent[] = [];
      registry.onEvent(event => events.push(event.event));
      const creating = registry.createSession("test", { sessionId: "async-branch", cwd: fixture.root });
      try {
        await fixture.entered(); // impossible while a synchronous git wait owns the parent loop
        expect(factoryCalls).toBe(0); expect(events).toEqual([]);
        expect(registry.listSessions()).toEqual([]);
        fixture.release();
        const session = await creating;
        expect(startedBranch).toBe("feature/async-branch");
        expect(session.providerMeta?.branch).toBe("feature/async-branch");
        expect(JSON.parse(readFileSync(fixture.calls, "utf8"))).toEqual({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: fixture.root });
        expect(events.filter(event => event.event === "session:update").every(event => event.session.providerMeta?.branch === "feature/async-branch")).toBe(true);
      } finally { fixture.release(); await creating.catch(() => undefined); await registry.shutdown(); }
    });
  });

  test("preserves detached HEAD, empty success, command failure and missing-command outcomes", async () => {
    for (const mode of ["detached", "empty", "failure", "missing", "bad-cwd"]) {
      await withBranchFixture(async fixture => {
        fixture.mode(mode); fixture.release();
        if (mode === "missing") fixture.hideGit();
        const registry = new SessionRegistry({ adapters: { test: config => new TestApprovalAdapter(config) } });
        try {
          const session = await registry.createSession("test", { cwd: mode === "bad-cwd" ? fixture.root + "/absent" : fixture.root });
          expect(session.providerMeta?.branch).toBe(mode === "detached" ? "HEAD" : undefined);
        } finally { await registry.shutdown(); }
      });
    }
  });

  test("close joins a pending metadata child and never constructs a delayed adapter", async () => {
    await withBranchFixture(async fixture => {
      let factories = 0;
      const registry = new SessionRegistry({ adapters: { test: config => { factories++; return new TestApprovalAdapter(config); } } });
      const creating = registry.createSession("test", { sessionId: "cancelled", cwd: fixture.root });
      const outcome = creating.then(() => null, error => error);
      try {
        await fixture.entered();
        let closed = false;
        const closing = registry.closeSession("cancelled").then(() => { closed = true; });
        await Promise.resolve();
        expect(closed).toBe(false);
        fixture.release();
        await closing;
        expect(await outcome).toMatchObject({ code: "CONFLICT", message: "Session creation closed during branch discovery." });
        expect(factories).toBe(0); expect(registry.listSessions()).toEqual([]);
      } finally { fixture.release(); await outcome; await registry.shutdown(); }
    });
  });

  test("close stops an existing adapter immediately while joining a same-ID pending lookup", async () => {
    await withBranchFixture(async fixture => {
      const { rmSync } = await import("node:fs");
      let factories = 0, stopped = false;
      const registry = new SessionRegistry({ adapters: { test: config => {
        factories++;
        const adapter = new TestApprovalAdapter(config);
        const shutdown = adapter.shutdown.bind(adapter);
        adapter.shutdown = async () => { stopped = true; await shutdown(); };
        return adapter;
      } } });
      fixture.release();
      await registry.createSession("test", { sessionId: "shared", cwd: fixture.root });
      rmSync(fixture.root + "/release"); rmSync(fixture.root + "/entered");
      const replacement = registry.createSession("test", { sessionId: "shared", cwd: fixture.root }).then(() => null, error => error);
      try {
        await fixture.entered();
        let closed = false;
        const closing = registry.closeSession("shared").then(() => { closed = true; });
        expect(stopped).toBe(true);
        await Promise.resolve(); expect(closed).toBe(false);
        fixture.release(); await closing;
        expect(await replacement).toMatchObject({ code: "CONFLICT" });
        expect(factories).toBe(1); expect(registry.listSessions()).toEqual([]);
      } finally { fixture.release(); await replacement; await registry.shutdown(); }
    });
  });

  test("shutdown joins every pending lookup without starting a harness and permits later explicit creation", async () => {
    await withBranchFixture(async fixture => {
      let factories = 0;
      const registry = new SessionRegistry({ adapters: { test: config => { factories++; return new TestApprovalAdapter(config); } } });
      const first = registry.createSession("test", { sessionId: "one", cwd: fixture.root }).then(() => null, error => error);
      const second = registry.createSession("test", { sessionId: "two", cwd: fixture.root }).then(() => null, error => error);
      try {
        await fixture.entered();
        let stopped = false;
        const stopping = registry.shutdown().then(() => { stopped = true; });
        await Promise.resolve(); expect(stopped).toBe(false);
        fixture.release(); await stopping;
        expect(await first).toMatchObject({ code: "CONFLICT" }); expect(await second).toMatchObject({ code: "CONFLICT" });
        expect(factories).toBe(0);
        const later = await registry.createSession("test", { sessionId: "later", cwd: fixture.root });
        expect(later.id).toBe("later"); expect(factories).toBe(1);
      } finally { fixture.release(); await Promise.all([first, second]); await registry.shutdown(); }
    });
  });
});
