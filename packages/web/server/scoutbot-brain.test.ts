import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";

import { createScoutbotBrain, openBunSqliteStorage } from "./scoutbot-brain.ts";

function fauxModels() {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  const seen: Array<Array<{ role: string; text: string }>> = [];
  faux.setResponses(Array.from({ length: 8 }, () => (context: { messages: unknown[] }) => {
    const messages = context.messages.map((message) => {
      const { role, content, sections } = message as { role: string; content: unknown; sections?: Record<string, string> };
      if (sections) return { role, text: Object.values(sections).join("\n") };
      const text = typeof content === "string"
        ? content
        : (content as Array<{ type: string; text?: string }>).map((block) => block.text ?? "").join(" ");
      return { role, text };
    });
    seen.push(messages);
    return fauxAssistantMessage(`answer ${seen.length}`);
  }));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, seen };
}

describe("Scoutbot brain on Pi Durable", () => {
  test("a reopened brain continues the same conversation, and live state is never stored", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "scoutbot-brain-")), "brain.sqlite");
    const { models, seen } = fauxModels();
    const boot = () => createScoutbotBrain({
      models,
      provider: "faux",
      currentDirectory: "/tmp/openscout",
      openStorage: () => openBunSqliteStorage(path),
    });

    const first = boot();
    const one = await first.reply({
      conversationId: null, body: "Remember the build is green.", state: "{\"fleet\":\"quiet\"}",
      model: "faux-1", systemPrompt: "You are Scout.",
    });
    expect(one.text).toBe("answer 1");
    await first.close();

    const second = boot();
    const deltas: string[] = [];
    const two = await second.reply({
      conversationId: one.conversationId, body: "What did I say?", state: "{\"fleet\":\"busy\"}",
      model: "faux-1", systemPrompt: "You are Scout.", onDelta: (delta) => deltas.push(delta),
    });
    await second.close();

    expect(two.conversationId).toBe(one.conversationId);
    expect(two.text).toBe("answer 2");
    expect(deltas.join("")).toBe("answer 2");
    const turn = seen[1]!.filter((message) => message.role !== "system");
    expect(seen[1]!.find((message) => message.role === "system")?.text).toContain("You are Scout.");
    expect(turn.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(turn[0]!.text).toContain("Remember the build is green.");
    // The first turn's snapshot was for that request only.
    expect(turn[0]!.text).not.toContain("quiet");
    expect(turn[2]!.text).toContain("busy");
  });
});
