import type { ObservedSessionIdentity, ObservedSessionLink } from "./observed-sessions.js";
export type ObservedSessionMaterialFile = { path: string; state: "read" | "modified"; touches: number; lastTouchedAt: number | null };
export type ObservedSessionMaterials = {
  schema: "scout.session-materials/v1";
  identity: ObservedSessionIdentity;
  links: ObservedSessionLink[];
  source: "history";
  worktreePath: string;
  files: ObservedSessionMaterialFile[];
  counts: { files: number; changedFiles: number; readFiles: number };
  coverage: { kind: "observed_tool_paths"; bytes: number; lines: number; maxBytes: number; maxLines: number; excludedOutsideWorktree: number; pendingActions: number; failedActions: number; skippedRecords: number; complete: boolean };
};
