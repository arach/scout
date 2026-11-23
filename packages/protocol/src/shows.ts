/** Immutable, runtime-owned snapshots selected by an agent, not conversation attachments. */
export interface ScoutShow {
  id: string;
  itemId: string;
  supersedes?: string;
  agentId: string;
  sessionId?: string;
  harness?: string;
  nodeId: string;
  projectRoot: string;
  worktree: string;
  branch?: string;
  sourcePath: string;
  kind: "image" | "video" | "document" | "other";
  mediaType: string;
  byteSize: number;
  sha256: string;
  caption?: string;
  /**
   * The caller's idempotency key for `POST /v1/shows`, scoped to `agentId`.
   * Repeating it returns this show and copies nothing.
   */
  requestId?: string;
  createdAt: number;
}
export const SHOW_LIMITS = {
  fileBytes: 128 * 1024 * 1024,
  storeBytes: 1024 * 1024 * 1024,
  records: 10_000,
  captionCharacters: 4000,
  requestIdCharacters: 256,
} as const;
/** A show's `id`: one fixed render. */
export const SHOW_ID_PATTERN = /^[a-f0-9-]{36}$/;
/** A show's `itemId`: one page across its renders. */
export const SHOW_ITEM_ID_PATTERN = /^[a-f0-9]{64}$/;
