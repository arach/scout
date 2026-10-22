import { expect, test } from "bun:test";
import type { HostReadAvailability, SessionReadAvailability, TmuxHostAttentionRead, TerminalHostRef } from "./index.js";

test("host DTOs serialize exact refs, explicit failures and shared availability without a WebAgent", () => {
  const sessionStates: SessionReadAvailability[] = ["not_scanned", "available", "unavailable", "unknown"];
  const hostStates: HostReadAvailability[] = [...sessionStates, "partial"];
  expect(hostStates).toEqual(["not_scanned", "available", "unavailable", "unknown", "partial"]);
  const ref: TerminalHostRef & { backend: "tmux" } = { nodeId: "node-1", backend: "tmux", hostSession: "exact", paneId: "%1" };
  const read: TmuxHostAttentionRead = {
    schema: "scout.tmux-host-attention/v1", scope: "machine-local-operator", nodeId: "node-1",
    observedAt: 123, availability: "unavailable",
    observations: [{ ref, harness: "claude", label: "Local pane", observedAt: 123, source: "tmux_pane",
      provenance: "inferred", detector: "claude_permission_dialog", availability: "unavailable",
      reason: "capture_failed", coverage: { capturedBytes: 0, maxBytes: 49152, truncated: false }, prompt: null }],
    coverage: { kind: "provided_terminal_refs", requested: 1, scanned: 1, omitted: 0, complete: false,
      maxCandidates: 24, captureConcurrency: 6, captureTimeoutMs: 2000, maxCaptureBytes: 49152 },
  };
  expect(JSON.parse(JSON.stringify(read))).toEqual(read);
});
