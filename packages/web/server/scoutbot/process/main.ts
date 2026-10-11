/**
 * Entry for the Scoutbot process the broker supervises (argv0 `scout-bot`).
 * The broker passes its socket in OPENSCOUT_BROKER_SOCKET_PATH.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveBrokerServiceConfig } from "@openscout/runtime/broker-process-manager";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import { createScoutbotBrain, openBunSqliteStorage } from "../../scoutbot-brain.ts";
import { createScoutbotCredentialStore } from "../../scoutbot-credentials.ts";
import { createScoutbotFileLookup } from "../../scoutbot-file-lookup.ts";
import { createScoutbotBrokerLink } from "./broker-link.ts";
import { createScoutbotProcess, SCOUTBOT_PROCESS_SYSTEM_PROMPT } from "./scoutbot-process.ts";
import { ScoutbotDispatchJournal } from "./dispatch-journal.ts";
import { createScoutbotMcp } from "./scout-mcp.ts";

const socketPath = process.env.OPENSCOUT_BROKER_SOCKET_PATH?.trim()
  || resolveBrokerServiceConfig().brokerSocketPath;
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();
const supportDirectory = resolveOpenScoutSupportPaths().supportDirectory;
const credentials = createScoutbotCredentialStore();

const resolveOpenAIApiKey = async (): Promise<string | undefined> => {
  const environmentKey = process.env.OPENAI_API_KEY?.trim();
  if (environmentKey) return environmentKey;
  const config = await readFile(join(resolveOpenScoutSupportPaths().relayHubDirectory, "config.json"), "utf8")
    .then((raw) => JSON.parse(raw) as { openaiApiKey?: string })
    .catch(() => null);
  return config?.openaiApiKey?.trim() || credentials.getOpenAIKey()?.trim() || undefined;
};

const broker = createScoutbotBrokerLink({ socketPath });
const journal = new ScoutbotDispatchJournal(join(supportDirectory, "scoutbot", "dispatch.sqlite"));
let scoutbot: ReturnType<typeof createScoutbotProcess>;
const mcp = createScoutbotMcp({ broker, journal, currentDirectory,
  onDispatch: async (flightId, conversationId) => brain.startBackground?.(flightId, conversationId),
});
const brain = createScoutbotBrain({
  currentDirectory, resolveApiKey: resolveOpenAIApiKey,
  initialSystemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT,
  findFiles: createScoutbotFileLookup(currentDirectory),
  tools: () => mcp.tools(),
  backgroundWork: (flightId, signal) => scoutbot.reportFlight(flightId, signal),
  openStorage: () => openBunSqliteStorage(join(supportDirectory, "scoutbot", "process-brain.sqlite")),
});
scoutbot = createScoutbotProcess({
  broker,
  brain,
  journal,
  mcp,
  currentDirectory,
  model: process.env.OPENSCOUT_SCOUTBOT_MODEL?.trim() || undefined,
});

const controller = new AbortController();
let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[scoutbot] ${signal}: stopping`);
  controller.abort();
  await brain.close().catch((error) => console.warn("[scoutbot] brain close failed:", error));
  await mcp.close();
  journal.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// The broker may still be finishing startup; keep trying to register.
for (let attempt = 1; !controller.signal.aborted; attempt += 1) {
  try {
    await scoutbot.bootstrap();
    break;
  } catch (error) {
    const delayMs = Math.min(30_000, 1_000 * attempt);
    console.warn(`[scoutbot] bootstrap failed (attempt ${attempt}): ${error instanceof Error ? error.message : String(error)}; retrying in ${delayMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
await scoutbot.run(controller.signal);
