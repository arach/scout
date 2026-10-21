/** Pure Claude permission-dialog grammar, independent of terminal backends. */
export const CLAUDE_PERMISSION_DIALOG_LIMITS = Object.freeze({
  maxCaptureBytes: 48 * 1024, summaryChars: 200, detailChars: 500,
});

/** Unclamped normalized fields bind the content version, not just its preview. */
export type ClaudePermissionDialog = {
  title: string;
  summary: string;
  detail: string | null;
  content: { dialog: string; header: string | null; command: string | null; permissionRule: string; question: string; options: string[]; footer: string };
};
const CLAUDE_CONFIRMATION_FOOTER = /\bEsc to cancel\b.*\bTab to amend\b/i;
const CLAUDE_PERMISSION_RULE = /\bPermission\s+rule\s+(.+?)\s+requires confirmation for this command\./i;
const CLAUDE_PROCEED_QUESTION = /\bDo you want to proceed\?/i;
const CLAUDE_POST_PROMPT_ACTIVITY = /(?:^|\n)\s*(?:⏺|●)\s+(?:Bash|Edit|Glob|Grep|Read|Search|Task|Update|WebFetch|WebSearch|Write)\b/imu;
const CLAUDE_READY_COMPOSER = /^\s*(?:[❯›]\s*|[│┃]\s*[>❯]\s*)/mu;
const ANSI_CSI = /\x1B\[[0-?]*[ -/]*[@-~]/gu;
const ANSI_OSC = /\x1B\][^\x07]*(?:\x07|\x1B\\)/gu;

/** Pure detection over bounded pane text; no host or native session is invented. */
export function detectClaudePermissionDialog(paneBody: string): ClaudePermissionDialog | null {
  if (Buffer.byteLength(paneBody) > CLAUDE_PERMISSION_DIALOG_LIMITS.maxCaptureBytes) return null;
  const lines = paneBody.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replaceAll("\r", "").split("\n");
  const lastContentIndex = findLastIndex(lines, line => line.trim().length > 0);
  if (lastContentIndex < 0) return null;
  const footerIndex = findLastIndex(lines, line => CLAUDE_CONFIRMATION_FOOTER.test(line));
  if (footerIndex < 0) return null;
  const after = lines.slice(footerIndex + 1, lastContentIndex + 1).join("\n");
  if (CLAUDE_POST_PROMPT_ACTIVITY.test(after) || CLAUDE_READY_COMPOSER.test(after)) return null;
  const questionIndex = findLastIndex(lines, (line, i) => i < footerIndex && CLAUDE_PROCEED_QUESTION.test(line));
  if (questionIndex < 0 || footerIndex - questionIndex > 12) return null;
  const permissionIndex = findLastIndex(lines, (line, i) => i < questionIndex && CLAUDE_PERMISSION_RULE.test(line));
  if (permissionIndex < 0 || questionIndex - permissionIndex > 8) return null;
  const permission = lines[permissionIndex]?.match(CLAUDE_PERMISSION_RULE)?.[1]?.trim();
  if (!permission) return null;
  const foundHeader = findLastIndex(lines, (line, i) => i < permissionIndex && /^\s*(?:Bash command|Edit file|Write file)\s*$/i.test(line));
  const headerIndex = foundHeader >= 0 && permissionIndex - foundHeader <= 12 ? foundHeader : -1;
  const commandLines = headerIndex < 0 ? [] : lines.slice(headerIndex + 1, permissionIndex);
  const detail = commandLines.map(line => line.trim()).find(Boolean);
  return {
    title: "Claude needs permission",
    summary: clamp(`Permission rule ${permission} requires confirmation.`, CLAUDE_PERMISSION_DIALOG_LIMITS.summaryChars),
    detail: detail ? clamp(detail, CLAUDE_PERMISSION_DIALOG_LIMITS.detailChars) : null,
    content: {
      dialog: normalize(lines.slice(headerIndex < 0 ? permissionIndex : headerIndex, footerIndex + 1).map(stripOptionCursor).join("\n")),
      header: headerIndex < 0 ? null : normalize(lines[headerIndex]!),
      command: commandLines.length ? normalize(commandLines.join("\n")) : null,
      permissionRule: normalize(permission), question: normalize(lines[questionIndex]!),
      options: lines.slice(questionIndex + 1, footerIndex).map(line => normalize(stripOptionCursor(line))).filter(Boolean),
      footer: normalize(lines[footerIndex]!),
    },
  };
}

function stripOptionCursor(line: string): string { return line.replace(/^\s*[❯›>]\s*(?=\d+\.)/u, ""); }
function normalize(value: string): string { return value.replace(/\s+/gu, " ").trim(); }
function clamp(value: string, max: number): string {
  const text = normalize(value);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
function findLastIndex(values: readonly string[], predicate: (value: string, index: number) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) if (predicate(values[index]!, index)) return index;
  return -1;
}
