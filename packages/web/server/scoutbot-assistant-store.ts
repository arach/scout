import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

/**
 * Durable home for the Scoutbot assistant's conversations. The service keeps
 * them in memory; without this every web-server restart started Scoutbot
 * over with an empty chat.
 */
export type ScoutbotAssistantStoredState = {
  version: 1;
  activeSessionId: string | null;
  sessions: unknown[];
};

export type ScoutbotAssistantSessionStore = {
  load: () => ScoutbotAssistantStoredState | null;
  save: (state: ScoutbotAssistantStoredState) => void;
};

export function defaultScoutbotAssistantSessionsPath(): string {
  return join(resolveOpenScoutSupportPaths().supportDirectory, "scoutbot-assistant-sessions.json");
}

export function createScoutbotAssistantFileStore(
  filePath: string = defaultScoutbotAssistantSessionsPath(),
): ScoutbotAssistantSessionStore {
  return {
    load: () => {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<ScoutbotAssistantStoredState>;
        if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) return null;
        return {
          version: 1,
          activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
          sessions: parsed.sessions,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[scoutbot] Could not read saved conversations at ${filePath}:`, error);
        }
        return null;
      }
    },
    save: (state) => {
      try {
        mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
        const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
        writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
        renameSync(temporaryPath, filePath);
      } catch (error) {
        console.warn(`[scoutbot] Could not save conversations to ${filePath}:`, error);
      }
    },
  };
}
