import { describe, expect, test } from "bun:test";
import { parseTerminalSurfaceId } from "@openscout/protocol";
import { herdrTerminalHost } from "./herdr.ts";
import { tmuxTerminalHost } from "./tmux.ts";

// Only the two retained adapters: the deleted web registry is not reconstructed.
const terminalHostAdapters = () => [tmuxTerminalHost, herdrTerminalHost];
const terminalHostAdapter = (id: string) => terminalHostAdapters().find(adapter => adapter.id === id);

describe("retained adapter capabilities", () => {
  test("an adapter implements exactly the methods its capabilities claim", () => {
    for (const adapter of terminalHostAdapters()) {
      const { capabilities } = adapter;
      expect(typeof adapter.probe).toBe("function");
      expect(typeof adapter.list).toBe("function");
      expect(typeof adapter.surface).toBe("function");
      expect(Boolean(adapter.create)).toBe(capabilities.create);
      expect(Boolean(adapter.capture)).toBe(capabilities.capture);
      expect(Boolean(adapter.observedAgents)).toBe(capabilities.observedAgentState);
      // Only verbs that reach a HOST need a method. `force-quit-bridge` tears
      // down Scout's relay bridge and no adapter implements it, so counting it
      // here would demand a method that does nothing.
      expect(Boolean(adapter.control)).toBe([...capabilities.control, ...capabilities.harnessControl].filter(action => action !== "force-quit-bridge").length > 0);
      // A verb cannot be claimed twice; "via" must be unambiguous.
      for (const action of capabilities.harnessControl) {
        expect(capabilities.control).not.toContain(action);
      }
    }
  });

  test("the capability matrix is the one the hosts actually implement", () => {
    const matrix = Object.fromEntries(terminalHostAdapters().map((adapter) => [adapter.id, {
      relayAttach: adapter.capabilities.relayAttach,
      capture: adapter.capabilities.capture,
      create: adapter.capabilities.create,
      observedAgentState: adapter.capabilities.observedAgentState,
      control: adapter.capabilities.control,
      harnessControl: adapter.capabilities.harnessControl,
    }]));

    expect(matrix).toEqual({
      tmux: {
        relayAttach: true,
        capture: true,
        create: true,
        observedAgentState: false,
        control: ["interrupt", "quit", "detach", "release", "force-quit-bridge"],
        harnessControl: ["stop-job", "restart-resume", "force-quit"],
      },
      herdr: {
        // The relay overlay spawns the full herdr client in its PTY.
        relayAttach: true,
        capture: true,
        // Scout starts a named session headlessly (`herdr --session X server`)
        // and stops there; herdr still owns workspaces, tabs, and panes.
        create: true,
        // The one host that reports agent state instead of Scout inferring it.
        observedAgentState: true,
        // No detach: `herdr session` is list/attach/stop/delete, and there is
        // no other verb that detaches. It was declared and implemented as
        // `herdr agent focus`, which focuses an agent pane.
        control: ["force-quit-bridge"],
        harnessControl: [],
      },
    });
  });

  test("herdr does not offer a detach it cannot perform", () => {
    const herdr = terminalHostAdapter("herdr")!;
    expect(herdr.capabilities.control).not.toContain("detach");
    // Nothing left for a host-side control method to do, so there is no method
    // to accidentally point at the wrong verb again.
    expect(herdr.control).toBeUndefined();
  });

});

describe("adapter surfaces", () => {
  test("carry an opaque surface id that resolves to their own host", () => {
    for (const adapter of terminalHostAdapters()) {
      const surface = adapter.surface({ name: "scout-example", state: "live" });
      expect(parseTerminalSurfaceId(surface.surfaceId)).toEqual({
        backend: adapter.id,
        hostSession: "scout-example",
        paneId: null,
        nodeId: null,
      });
      expect(surface.attachCommand.length).toBeGreaterThan(0);
      // Server-local socket paths must never ride out on a discovered record.
      expect(JSON.stringify(surface)).not.toContain(".sock");
    }
  });

  test("a host with no read-only view does not advertise an observe command", () => {
    const herdr = terminalHostAdapter("herdr")!;
    expect(herdr.capabilities.observe).toBe(false);
    expect(herdr.surface({ name: "scout-local-1", state: "detached" }).observeCommand).toBeNull();
    expect(terminalHostAdapter("tmux")!.surface({ name: "a", state: "live" }).observeCommand).not.toBeNull();
  });

  test("herdr attaches to the default session without naming it", () => {
    const herdr = terminalHostAdapter("herdr")!;
    expect(herdr.surface({ name: "default", state: "live" }).attachCommand).toEqual(["herdr"]);
    expect(herdr.surface({ name: "scout-local-1", state: "detached" }).attachCommand)
      .toEqual(["herdr", "session", "attach", "scout-local-1"]);
  });
});
