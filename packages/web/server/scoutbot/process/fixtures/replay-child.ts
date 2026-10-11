import { join } from "node:path";
import { appendFileSync, writeFileSync } from "node:fs";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { defineTool } from "@earendil-works/pi-durable";
import { createScoutbotBrain, openBunSqliteStorage } from "../../../scoutbot-brain.ts";
const directory = process.argv[2]!;
const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
faux.setResponses([fauxAssistantMessage(fauxToolCall("ask", { body: "build" }, { id: "stable-pi-call" }), { stopReason: "toolUse" })]);
const models = createModels(); models.setProvider(faux.provider);
const brain = createScoutbotBrain({ currentDirectory: directory, models, provider: "faux", openStorage: () => openBunSqliteStorage(join(directory, "brain.sqlite")), tools: async () => [defineTool({
  name: "ask", description: "test", parameters: Type.Object({ body: Type.String() }), replay: "safe",
  execute: async (_args, api) => {
    appendFileSync(join(directory, "call-ids"), `${api.callId}\n`);
    writeFileSync(join(directory, "in-flight"), "ready");
    await new Promise(() => undefined);
    return { content: [] };
  },
})] });
const id = await brain.ensureConversation!({ conversationId: null, model: "faux-1", systemPrompt: "test" });
writeFileSync(join(directory, "conversation"), String(id));
await brain.reply({ conversationId: id, requestId: "source-1", body: "build", model: "faux-1", systemPrompt: "test" });
