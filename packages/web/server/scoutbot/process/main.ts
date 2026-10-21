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
import { bindAssistantClaim, startAssistantAnswerer } from "../answerer-claim.ts";
import { createAssistantBrokerProxy } from "./claim-broker-proxy.ts";

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

const claimant = startAssistantAnswerer({ mode: "standalone",
  request: (path, init) => fetch(new URL(path, "http://localhost"), { ...init, unix: socketPath }),
  warn: message => console.warn(`[scoutbot] ${message}`),
}, async signal => {
  // Construct one generation's tools/brain only after admission. In particular,
  // a busy contender must not retire endpoints or recover queued work.
  const proxy = await createAssistantBrokerProxy(socketPath);
  let journal: ScoutbotDispatchJournal | undefined;
  let mcp: ReturnType<typeof createScoutbotMcp> | undefined;
  let brain: ReturnType<typeof createScoutbotBrain> | undefined;
  try {
    const broker = createScoutbotBrokerLink({ socketPath });
    const activeJournal = journal = new ScoutbotDispatchJournal(join(supportDirectory, "scoutbot", "dispatch.sqlite"));
    let scoutbot: ReturnType<typeof createScoutbotProcess>;
    const activeMcp: ReturnType<typeof createScoutbotMcp> = mcp = createScoutbotMcp({ broker: { ...broker, socketPath: proxy.socketPath }, journal: activeJournal, currentDirectory,
      onDispatch: bindAssistantClaim(async (flightId, conversationId) => activeBrain.startBackground?.(flightId, conversationId)),
    });
    const activeBrain: ReturnType<typeof createScoutbotBrain> = brain = createScoutbotBrain({
      currentDirectory, resolveApiKey: resolveOpenAIApiKey,
      initialSystemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT,
      findFiles: createScoutbotFileLookup(currentDirectory),
      tools: bindAssistantClaim(() => activeMcp.tools()),
      backgroundWork: bindAssistantClaim((flightId, signal) => scoutbot.reportFlight(flightId, signal)),
      openStorage: () => openBunSqliteStorage(join(supportDirectory, "scoutbot", "process-brain.sqlite")),
    });
    scoutbot = createScoutbotProcess({ broker, brain: activeBrain, journal: activeJournal, mcp: activeMcp, currentDirectory,
      model: process.env.OPENSCOUT_SCOUTBOT_MODEL?.trim() || undefined,
    });
    // The broker may still be finishing startup. Claim loss aborts this retry too.
    for (let attempt = 1; !signal.aborted; attempt += 1) {
      try { await scoutbot.bootstrap(); break; }
      catch {
        console.warn(`[scoutbot] bootstrap failed (attempt ${attempt}); retrying`);
        await new Promise<void>(resolve => {
          if (signal.aborted) return resolve();
          const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, Math.min(30_000, 1_000 * attempt));
          signal.addEventListener("abort", done, { once: true });
        });
      }
    }
    if (!signal.aborted) await scoutbot.run(signal);
  } finally {
    try {
      await brain?.close().catch(() => undefined);
      await mcp?.close();
    } finally {
      try { journal?.close(); } finally { await proxy.close(); }
    }
  }
});

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`[scoutbot] ${signal}: stopping`);
  await claimant.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
await claimant.done;
