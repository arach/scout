import { afterEach, expect, test } from "bun:test";
import { registerSecretValue, resetSecretRegistryForTests } from "@openscout/agent-sessions/secret-redaction";
import { __testing } from "./service.js";
import type { TailEvent } from "./types.js";

const secret = "synthetic-prompt-credential-for-redaction";
const event = (): TailEvent => ({
  id: "codex:thread:0", ts: 1, source: "codex", sessionId: "thread", pid: 0,
  parentPid: null, project: "fixture", cwd: "/work/project", harness: "unattributed",
  kind: "user", summary: "An unchanged safe summary",
  prompt: {
    words: `Use ${secret}`, harnessOnly: false,
    parts: [
      { kind: "words", text: `Use ${secret}` },
      { kind: "context", name: "environment_context", label: "Environment", text: secret },
      { kind: "notice", source: "task", summary: "Task completed", refs: { outputFile: secret } },
    ],
  },
});

afterEach(() => { resetSecretRegistryForTests(); __testing.resetTailEventBuffers(); });

test("line events redact prompt values even when raw is absent and summary is unchanged", () => {
  registerSecretValue(secret, "fixture");
  const original = event();
  const redacted = __testing.pushInternalEvent(original);
  expect(redacted.summary).toBe(original.summary);
  expect(JSON.stringify(redacted)).not.toContain(secret);
  expect(redacted.prompt?.words).toBe("Use [redacted]");
  expect(original.prompt?.words).toContain(secret); // Do not mutate the parser's source event.
});

test("whole-file redaction preserves the classified shape while scrubbing prompt and raw", () => {
  registerSecretValue(secret, "fixture");
  const redacted = __testing.redactTailEvent({ ...event(), raw: { content: secret } });
  expect(JSON.stringify(redacted)).not.toContain(secret);
  expect(redacted.prompt).toMatchObject({ harnessOnly: false, words: "Use [redacted]" });
  expect(redacted.prompt?.parts).toHaveLength(3);
  expect(redacted.raw).toEqual({ content: "[redacted]" });
});
