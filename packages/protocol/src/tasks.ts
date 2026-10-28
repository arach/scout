/** Versioned ask/reply semantics. Old peers must be refused before dispatch. */
export const SCOUT_TASKS_CAPABILITY = "ask-reply/1";
export type ScoutTaskAsk = {
  version: 1;
  ref?: string;
  continue?: string;
  cancel?: boolean;
  fyi?: boolean;
  operator?: boolean;
  notify?: boolean;
  defaultAction?: string;
  /** Answer window in seconds. */
  window?: number;
  options?: string[];
  permission?: boolean;
  because?: string;
};
export type ScoutTaskReply = {
  requestId: string;
  senderId: string;
  ref?: string;
  to?: string;
  body: string;
  progress?: boolean;
  failed?: boolean;
  attachments?: import("./messages.js").MessageAttachment[];
  image?: import("./attachments.js").AttachmentUpload;
};
export type ScoutNotificationPolicy = { requested: boolean; priority: "normal" | "interrupting" };

/** Shared pre-effect validation for CLI, MCP and the runtime. */
export function validateTaskAsk(task: ScoutTaskAsk, route: {
  to?: string; channel?: string; capability?: boolean; execution?: boolean; relation?: boolean;
}): void {
  const modes = [route.to, task.operator, route.channel, route.capability, task.ref, task.continue].filter(Boolean);
  if (modes.length !== 1) throw new Error("ask requires exactly one routing mode: --to, --operator, --channel, --project, --ref, or --continue");
  if (task.cancel && !task.ref) throw new Error("--cancel requires --ref");
  if (task.fyi && (task.ref || task.continue || task.cancel || route.capability)) throw new Error("--fyi cannot use --ref, --continue, --cancel or capability routing");
  if (route.execution && (task.ref || task.fyi)) throw new Error("execution flags cannot be combined with --ref or --fyi");
  if (task.continue && route.relation) throw new Error("--continue cannot be combined with --continue-for or --join-to");
  if (task.options?.length && (!task.operator || task.fyi)) throw new Error("--option requires an operator task expecting an answer");
  if (task.options?.some(option => !option.trim())) throw new Error("--option cannot be empty");
  if (task.notify && !task.operator) throw new Error("--notify now pushes to the operator; asks return on acceptance by default");
  if (task.defaultAction !== undefined && (!task.defaultAction.trim() || !task.operator || task.fyi)) throw new Error("--default-action requires an operator task expecting an answer");
  if (task.defaultAction !== undefined && task.permission) throw new Error("--default-action cannot be combined with --permission: permission requests block");
  if (task.defaultAction && task.options?.length && !task.options.includes(task.defaultAction)) throw new Error("--default-action must be one of the options");
  if ((task.permission || task.because) && !task.operator) throw new Error("--permission and --because require --operator");
  if (route.channel && !task.fyi) throw new Error("--channel requires --fyi until task ownership for channels is defined");
  if (task.window !== undefined && (!task.operator || task.fyi || !Number.isFinite(task.window) || task.window <= 0)) throw new Error("--window requires an operator task and a positive number of seconds");
}
export function validateTaskReply(reply: Pick<ScoutTaskReply, "ref" | "to" | "progress" | "failed">): void {
  if (Number(Boolean(reply.ref)) + Number(Boolean(reply.to)) !== 1) throw new Error("reply requires exactly one of --ref <task> or --to <message>");
  if (reply.progress && reply.failed) throw new Error("--progress and --failed cannot be combined");
  if (reply.to && (reply.progress || reply.failed)) throw new Error("--progress and --failed require --ref <task>");
}
export function taskNotificationPolicy(task: ScoutTaskAsk): ScoutNotificationPolicy {
  return { requested: !task.fyi || Boolean(task.notify), priority: task.defaultAction ? "normal" : "interrupting" };
}
