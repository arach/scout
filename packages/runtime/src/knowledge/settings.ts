import { resolveOpenScoutKnowledgePaths } from "./paths.js";
import type { KnowledgeStatus } from "./types.js";
import { readFileSync } from "node:fs";
import { resolveOpenScoutSupportPaths } from "../support-paths.js";

export { KNOWLEDGE_MAX_BYTES } from "./limits.js";
import { KNOWLEDGE_MAX_BYTES } from "./limits.js";
import { knowledgeStorageUsage } from "./storage-budget.js";
export const KNOWLEDGE_INDEX_OFF = 'Search index is off. Turn on "Local search index" in Settings › System, or set knowledgeIndexEnabled to true in OpenScout settings.json. The local index uses at most 256 MiB (database, WAL and QMD files combined).';

/** Missing, old and malformed settings all fail closed; no environment opt-in. */
export function knowledgeIndexEnabled(): boolean {
  try { return JSON.parse(readFileSync(resolveOpenScoutSupportPaths().settingsPath, "utf8")).knowledgeIndexEnabled === true; }
  catch { return false; }
}

export function disabledKnowledgeStatus(): KnowledgeStatus {
  const paths = resolveOpenScoutKnowledgePaths();
  // No SQLite handle or schema migration while reporting an opt-out.
  let storage: KnowledgeStatus["storage"];
  try { storage = knowledgeStorageUsage(paths); } catch { /* Unsafe paths are reported by maintenance, never followed here. */ }
  const message = storage && storage.totalBytes > KNOWLEDGE_MAX_BYTES
    ? `${KNOWLEDGE_INDEX_OFF} The inherited cache is still above the cap; maintenance must finish (with sufficient free disk) before new indexing can start.`
    : KNOWLEDGE_INDEX_OFF;
  return { enabled: false, message, generatedAt: Date.now(), paths,
    collections: 0, readyCollections: 0, chunks: 0, activeJobs: [], sqliteBytes: storage?.sqliteBytes ?? 0, storage, warmSpans: [] };
}
