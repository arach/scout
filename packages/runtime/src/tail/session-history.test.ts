import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTailEventsForSession } from "./service.js";
import type { DiscoverySnapshot } from "./types.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("exact session Tail history", () => {
  for (const source of ["claude", "codex"] as const) {
    test(`reads ${source} history when opted in without changing Observe's source selection`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "openscout-tail-history-"));
      directories.push(directory);
      const sessionId = `${source}-quiet-task`;
      const transcriptPath = join(directory, "session.jsonl");
      const records = ["earlier reply", "latest reply"].map((text, index) => {
        const timestamp = `2026-04-27T15:00:0${index}.000Z`;
        return source === "claude" ? {
          type: "assistant", timestamp,
          message: { id: `message-${index}`, content: [{ type: "text", text }] },
        } : {
          type: "response_item", timestamp,
          payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
        };
      });
      const content = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
      await writeFile(transcriptPath, content);
      const discovery: DiscoverySnapshot = {
        generatedAt: Date.now(),
        processes: [],
        transcripts: [{ source, transcriptPath, sessionId, cwd: directory, project: "fixture",
          harness: "unattributed", mtimeMs: Date.now(), size: Buffer.byteLength(content) }],
        totals: { total: 0, scoutManaged: 0, hudsonManaged: 0, unattributed: 0, transcripts: 1 },
      };

      expect(await readTailEventsForSession(sessionId, { discovery })).toBeNull();
      const result = await readTailEventsForSession(sessionId, { discovery, includeAllSources: true, limit: 1 });
      expect(result?.events).toHaveLength(1);
      expect(result?.events[0]).toMatchObject({ source, sessionId, kind: "assistant", summary: "latest reply" });
      expect(await readTailEventsForSession("another-task", { discovery, includeAllSources: true })).toBeNull();
    });
  }
});
