import { describe, expect, test } from "bun:test";

import type { HerdrPaneProjection } from "@openscout/protocol";

import { herdrAttentionItem } from "./herdr-host-attention.ts";
import { answerHerdrPermission } from "./herdr-permission-answer.ts";

const BASH_PERMISSION = `
 Bash command

   bun test packages/web/server

 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for this command
   3. No, and tell Claude what to do differently (esc)

 Esc to cancel · Tab to amend
`;

const OTHER_PERMISSION = BASH_PERMISSION.replace("bun test packages/web/server", "git push origin main");

const PANE = {
  paneId: "w1:p2",
  terminalId: "t-7",
  agent: "claude",
  agentStatus: "blocked",
  agentSession: { agent: "claude", value: "sess-1" },
  name: "openscout",
} as unknown as HerdrPaneProjection;

function deps(paneText: string, sent: Array<readonly string[]>) {
  return {
    readBlockedPanes: async () => [{ session: "scout", pane: PANE }],
    capture: async () => paneText,
    sendKeys: async (_session: string, _target: string, keys: readonly string[]) => { sent.push(keys); },
    audit: () => {},
    claim: () => true,
  };
}

describe("answerHerdrPermission", () => {
  const item = herdrAttentionItem("scout", PANE, BASH_PERMISSION, 0);

  test("a parsed permission dialog is offered with a version", () => {
    expect(item.id).toBe("herdr-permission:scout:w1:p2:sess-1");
    expect(item.version).toBeNumber();
    expect(item.detail).toBe("bun test packages/web/server");
  });

  test("approve presses the plain Yes, never don't-ask-again", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerHerdrPermission(
      { itemId: item.id, version: item.version!, decision: "approve" },
      deps(BASH_PERMISSION, sent),
    );
    expect(result.ok).toBe(true);
    expect(sent).toEqual([["enter"]]);
  });

  test("deny presses No", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerHerdrPermission(
      { itemId: item.id, version: item.version!, decision: "deny" },
      deps(BASH_PERMISSION, sent),
    );
    expect(result.ok).toBe(true);
    expect(sent).toEqual([["3"]]);
  });

  test("a different prompt in the same pane is refused", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerHerdrPermission(
      { itemId: item.id, version: item.version!, decision: "approve" },
      deps(OTHER_PERMISSION, sent),
    );
    expect(result).toMatchObject({ ok: false, code: "changed" });
    expect(sent).toEqual([]);
  });

  test("a prompt that was already answered is refused", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerHerdrPermission(
      { itemId: item.id, version: item.version!, decision: "approve" },
      deps(`${BASH_PERMISSION}\n⏺ Bash(bun test packages/web/server)\n`, sent),
    );
    expect(result).toMatchObject({ ok: false, code: "changed" });
    expect(sent).toEqual([]);
  });

  test("a pane no longer blocked is refused", async () => {
    const sent: Array<readonly string[]> = [];
    const result = await answerHerdrPermission(
      { itemId: item.id, version: item.version!, decision: "approve" },
      { ...deps(BASH_PERMISSION, sent), readBlockedPanes: async () => [] },
    );
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(sent).toEqual([]);
  });

  test("an unparsed blocked pane carries no version", () => {
    const blocked = herdrAttentionItem("scout", PANE, "Enter your name:", 0);
    expect(blocked.id.startsWith("herdr-blocked:")).toBe(true);
    expect(blocked.version).toBeNull();
  });
});
