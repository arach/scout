import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { assertTestIsolatedUserData, resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import type { SessionSteerAuditEntry } from "../shared/api/session-steer.ts";

export type SessionSteerJournalEntry =
  | { kind: "intent" | "completed"; entry: SessionSteerAuditEntry }
  | { kind: "outcome"; id: string; outcome: SessionSteerAuditEntry["outcome"]; code: string; reason: string };

/** App-owned metadata only. No prompt bodies or broker coordination records. */
export function createSessionSteerAudit(filePath?: string) {
  const path = filePath ?? join(resolveOpenScoutSupportPaths().controlHome, "session-steer-audit.jsonl");
  return {
    // Open before actuation. If the audit sink cannot be opened, no input goes out.
    async open() {
      if (!filePath) assertTestIsolatedUserData("append session steering audit", "OPENSCOUT_CONTROL_HOME");
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, "a", 0o600);
      return {
        async append(entry: SessionSteerJournalEntry) {
          await file.writeFile(`${JSON.stringify(entry)}\n`, "utf8");
          await file.sync();
        },
        close: () => file.close(),
      };
    },
    async read(sessionRef: string, machine: string | null, limit = 20): Promise<SessionSteerAuditEntry[]> {
      const entries = new Map<string, { entry: SessionSteerAuditEntry; completed: boolean }>();
      const cap = Math.min(100, Math.max(1, Math.floor(limit) || 20));
      const stream = createReadStream(path, { encoding: "utf8" });
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          // Fail rather than silently hiding corrupt evidence.
          const row = JSON.parse(line) as SessionSteerJournalEntry;
          if (row.kind === "outcome") {
            const stored = entries.get(row.id);
            if (!stored) continue;
            if (stored.completed) {
              stored.entry.duplicateOutcomes = (stored.entry.duplicateOutcomes ?? 0) + 1;
              continue; // First outcome wins, including when a duplicate disagrees.
            }
            stored.entry = { ...stored.entry, outcome: row.outcome, code: row.code, reason: row.reason };
            stored.completed = true;
          } else {
            const entry = row.entry;
            if (entry.sessionRef !== sessionRef || entry.machine !== machine) continue;
            if (entries.has(entry.id)) throw new Error("Duplicate steering intent");
            entries.set(entry.id, { entry, completed: row.kind === "completed" });
            if (entries.size > cap) entries.delete(entries.keys().next().value!);
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      } finally { lines.close(); stream.destroy(); }
      return [...entries.values()].map((value) => value.entry).reverse();
    },
  };
}
