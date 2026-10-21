import { describe, expect, test } from "bun:test";
import { classifyHarnessPrompt } from "@openscout/agent-sessions/prompt-classifiers";
import { classifyClaudeCodePrompt } from "@openscout/agent-sessions/adapters/claude-code/prompt-markup";
import { classifyCodexPrompt } from "@openscout/agent-sessions/adapters/codex/prompt-markup";
import { classifiedPrompt, compactClassifiedPrompt, promptHeadline, type ClassifiedPrompt } from "@openscout/agent-sessions";
import { promptHeadline as clientHeadline } from "@openscout/agent-sessions/client";

describe("public prompt contract", () => {
  test("all three classifier subpaths resolve and agree on operator words", () => {
    const input = "<system-reminder>context</system-reminder>\nFix the sidebar sort";
    const classified: ClassifiedPrompt = classifyClaudeCodePrompt(input);
    expect(classifyHarnessPrompt(" Claude-Code ", input)).toEqual(classified);
    expect(classifyHarnessPrompt("codex", "Fix the sidebar sort")).toEqual(classifyCodexPrompt("Fix the sidebar sort"));
    expect(promptHeadline(classified)).toBe("Fix the sidebar sort");
    expect(clientHeadline(classified)).toBe("Fix the sidebar sort");
  });

  test("unknown harnesses cannot dispatch inherited object properties", () => {
    for (const harness of [null, undefined, "", "unknown", "constructor", "__proto__"]) {
      expect(classifyHarnessPrompt(harness, "words")).toBeNull();
    }
  });

  test("folding and compaction keep operator words and clip only payloads", () => {
    const original = classifiedPrompt([{ kind: "context", name: "skill", label: "Skill", text: "a".repeat(20) }, { kind: "words", text: "Keep every operator word" }]);
    const compact = compactClassifiedPrompt(original, 8);
    expect(compact.words).toBe(original.words);
    expect(compact.harnessOnly).toBe(false);
    expect(compact.parts[0]).toMatchObject({ text: "aaaaaaa…" });
    expect(original.parts[0]).toMatchObject({ text: "a".repeat(20) });
  });

  test("headlines describe harness-only turns without inventing operator words", () => {
    const prompt = classifiedPrompt([{ kind: "notice", source: "task", summary: "Background build completed" }]);
    expect(prompt.harnessOnly).toBe(true);
    expect(prompt.words).toBe("");
    expect(promptHeadline(prompt)).toBe("Background build completed");
  });
});
