import { describe, expect, test } from "bun:test";

import { promptHeadline } from "../../protocol/prompt-parts.ts";
import { classifyCodexPrompt } from "./prompt-markup.ts";

// Shapes lifted from real Codex rollouts (bodies shortened).

describe("classifyCodexPrompt", () => {
  test("AGENTS.md instructions fold into one context part", () => {
    const result = classifyCodexPrompt("# AGENTS.md instructions for /work/project\n\n<INSTRUCTIONS>\n# Global Codex Build Hygiene\n\nUse a per-run directory.\n</INSTRUCTIONS>");
    expect(result.parts).toEqual([{ kind: "context", name: "agents-md", label: "AGENTS.md", detail: "/work/project", text: "# Global Codex Build Hygiene\n\nUse a per-run directory." }]);
    expect(result.harnessOnly).toBe(true);
  });

  test("the environment block names its cwd", () => {
    const result = classifyCodexPrompt("<environment_context>\n  <cwd>/work/project</cwd>\n  <shell>zsh</shell>\n</environment_context>");
    expect(result.parts[0]).toMatchObject({ kind: "context", name: "environment_context", label: "Environment", detail: "/work/project" });
  });

  test("the Codex app's framing: files are context, the request is words", () => {
    const result = classifyCodexPrompt([
      "",
      "# Files mentioned by the user:",
      "",
      "## Capture 15.20.39.png: /tmp/screenshots/Capture 15.20.39.png",
      "Image attachment: true",
      "",
      "## My request for Codex:",
      "Tighten the lane header.",
      "<image name=[Image #1] path=\"/tmp/screenshots/Capture 15.20.39.png\">",
    ].join("\n"));
    expect(result.parts).toEqual([
      { kind: "context", name: "files-mentioned-by-the-user", label: "Files mentioned", detail: "Capture 15.20.39.png", text: "## Capture 15.20.39.png: /tmp/screenshots/Capture 15.20.39.png\nImage attachment: true" },
      { kind: "words", text: "Tighten the lane header." },
      { kind: "context", name: "image", label: "Image", detail: "Capture 15.20.39.png", text: "/tmp/screenshots/Capture 15.20.39.png" },
    ]);
    expect(result.words).toBe("Tighten the lane header.");
  });

  test("ambient browser state and goal context are context", () => {
    const browser = classifyCodexPrompt("\n<in-app-browser-context source=\"ambient-ui-state\">\nThis block is automatically supplied ambient UI state.\n</in-app-browser-context>\nWhy is this blank?");
    expect(browser.parts.map((part) => part.kind)).toEqual(["context", "words"]);
    expect(browser.parts[0]).toMatchObject({ label: "Browser context", detail: "ambient-ui-state" });
    expect(browser.words).toBe("Why is this blank?");

    const goal = classifyCodexPrompt("<codex_internal_context source=\"goal\">\nContinue working toward the active thread goal.\n\n<objective>\nDeliver smooth client onboarding.\n</objective>\n</codex_internal_context>");
    expect(goal.parts).toEqual([{ kind: "context", name: "codex_internal_context", label: "Goal", text: "Deliver smooth client onboarding." }]);
    expect(goal.harnessOnly).toBe(true);
  });

  test("a realtime voice hand-off: spoken input is words, the transcript is context", () => {
    const result = classifyCodexPrompt("<realtime_delegation>\n  <input>Start the brainstorm this way</input>\n  <transcript_delta>user: Hey\nassistant: Hey</transcript_delta>\n</realtime_delegation>");
    expect(result.parts).toEqual([
      { kind: "words", text: "Start the brainstorm this way" },
      { kind: "context", name: "transcript_delta", label: "Voice transcript", text: "user: Hey\nassistant: Hey" },
    ]);
  });

  test("a voice session's closing flush is Codex's note, not words", () => {
    const result = classifyCodexPrompt("<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  The user just ended their realtime session.\n  <transcript_delta>user: bye</transcript_delta>\n</realtime_delegation>");
    expect(result.parts).toEqual([
      { kind: "context", name: "realtime_delegation", label: "Voice hand-off", detail: "transcript_tail_flush", text: "The user just ended their realtime session." },
      { kind: "context", name: "transcript_delta", label: "Voice transcript", text: "user: bye" },
    ]);
    expect(result.harnessOnly).toBe(true);
  });

  test("a question reply is the operator's answer", () => {
    const result = classifyCodexPrompt("<send_user_message_question_reply>\n[{\"answer\":\"Publish the standalone MIT client (Recommended)\",\"question\":\"May I publish?\"}]\n</send_user_message_question_reply>");
    expect(result.parts).toEqual([{ kind: "words", text: "Publish the standalone MIT client (Recommended)" }]);
  });

  test("an app page marker and an abort", () => {
    expect(promptHeadline(classifyCodexPrompt("<external_codex_apps_open_page>{\"page_id\":null}</external_codex_apps_open_page>"))).toBe("App page");
    expect(classifyCodexPrompt("<turn_aborted>\nThe user interrupted.\n</turn_aborted>").parts).toEqual([{ kind: "notice", source: "interrupt", summary: "Interrupted" }]);
  });

  test("plain words, and markup in prose, stay words", () => {
    expect(classifyCodexPrompt("Wrap it in a <div> please.").parts).toEqual([{ kind: "words", text: "Wrap it in a <div> please." }]);
  });
});
