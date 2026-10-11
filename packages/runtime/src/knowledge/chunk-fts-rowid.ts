import { createHash } from "node:crypto";

/**
 * Shared persisted identity contract for knowledge FTS writers and routing readers.
 * FTS5 supports efficient rowid deletes; deleting by an UNINDEXED text column
 * scans the index (~3s per row on a 30k-chunk index). Rowid joins also avoid
 * loading full FTS bodies merely to read their UNINDEXED chunk IDs.
 */
export function ftsRowidForChunk(chunkId: string): bigint {
  return createHash("sha256").update(chunkId).digest().readBigInt64BE(0);
}
