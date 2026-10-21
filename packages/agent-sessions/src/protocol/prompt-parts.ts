// ---------------------------------------------------------------------------
// Prompt parts — a user turn split into what the operator wrote and what the
// harness wrapped around it.
//
// Harnesses write into the user side of a transcript: background task
// notifications, slash command echoes, reminders, page context, continuation
// summaries. The markup for each is the harness's own business, so each
// adapter owns its parser (e.g. adapters/claude-code/prompt-markup.ts). This
// file only defines the shape every adapter returns, so clients render parts
// and never parse raw text.
// ---------------------------------------------------------------------------

/** Text the operator typed. The only part that can name a session's task. */
export interface PromptWordsPart {
  kind: "words";
  text: string;
}

/** Text the operator pasted in. Theirs, but a block, not a sentence. */
export interface PromptPastePart {
  kind: "paste";
  text: string;
  id?: string;
}

/** The harness reporting on its own work: a background task finished, a
 *  child session reported back. */
export interface PromptNoticePart {
  kind: "notice";
  /** What reported (e.g. "task"). */
  source: string;
  /** Lifecycle word as the harness gave it (e.g. "completed", "failed", "killed"). */
  status?: string;
  /** The harness's own one-line summary. */
  summary: string;
  /** The task's name when the summary quotes one. */
  title?: string;
  /** Identifiers worth keeping out of prose (task id, tool use id, output file…). */
  refs?: Record<string, string>;
  /** The full report, when the notice carries one (e.g. a subagent's hand-back). */
  text?: string;
}

/** A command the operator ran inside the harness (a slash command, or a shell
 *  line run directly), not a request to the agent. */
export interface PromptCommandPart {
  kind: "command";
  /** Command as typed, e.g. "/compact", or the shell line. */
  name: string;
  args?: string;
  /** True for a shell line run directly (e.g. Claude Code's `!` prefix). */
  shell?: boolean;
}

/** Output of a command the operator ran inside the harness. */
export interface PromptOutputPart {
  kind: "output";
  stream: "stdout" | "stderr";
  text: string;
  /** "command" for a slash command, "shell" for a direct shell line. */
  from: "command" | "shell";
}

/** Material injected alongside the operator's words: reminders, environment,
 *  page context, continuation summaries, skill bodies. Shown as a label;
 *  its text is never read as the operator's words. */
export interface PromptContextPart {
  kind: "context";
  /** Stable identity, usually the element name (e.g. "system-reminder"). */
  name: string;
  /** Human label (e.g. "Reminder"). */
  label: string;
  /** One identifying detail (e.g. a skill name, a source attribute). */
  detail?: string;
  text?: string;
}

export type PromptPart =
  | PromptWordsPart
  | PromptPastePart
  | PromptNoticePart
  | PromptCommandPart
  | PromptOutputPart
  | PromptContextPart;

export interface ClassifiedPrompt {
  parts: PromptPart[];
  /** The operator's words, joined; "" when the turn holds none. */
  words: string;
  /** True when nothing in the turn was written by the operator. */
  harnessOnly: boolean;
}

/** Fold parts into a ClassifiedPrompt. Adapters build parts, then call this. */
export function classifiedPrompt(parts: PromptPart[]): ClassifiedPrompt {
  const words = parts
    .filter((part): part is PromptWordsPart => part.kind === "words")
    .map((part) => part.text)
    .join("\n\n");
  const harnessOnly = !parts.some((part) => part.kind === "words" || part.kind === "paste");
  return { parts, words, harnessOnly };
}

/** Clip the long text a part can carry (continuation summaries, skill bodies,
 *  reports, pastes, output) so a classified prompt stays small on the wire.
 *  Short fields (summaries, titles, names) are left alone. */
export function compactClassifiedPrompt(prompt: ClassifiedPrompt, maxText = 1200): ClassifiedPrompt {
  const clip = (text: string) => (text.length > maxText ? `${text.slice(0, maxText - 1)}…` : text);
  const parts = prompt.parts.map((part): PromptPart => {
    switch (part.kind) {
      case "words":
        return part;
      case "notice":
        return part.text ? { ...part, text: clip(part.text) } : part;
      case "context":
        return part.text ? { ...part, text: clip(part.text) } : part;
      case "paste":
      case "output":
        return { ...part, text: clip(part.text) };
      default:
        return part;
    }
  });
  return { ...prompt, parts };
}

/** One readable line for a turn: the operator's words when there are any,
 *  else what the harness did (a notice's summary, the command run, its first
 *  line of output, or the labels of what was injected). */
export function promptHeadline(prompt: ClassifiedPrompt): string {
  if (prompt.words) return prompt.words;
  const notice = prompt.parts.find((part): part is PromptNoticePart => part.kind === "notice");
  if (notice) return notice.summary;
  const command = prompt.parts.find((part): part is PromptCommandPart => part.kind === "command");
  if (command) return [command.shell ? `! ${command.name}` : command.name, command.args].filter(Boolean).join(" ");
  const output = prompt.parts.find((part): part is PromptOutputPart => part.kind === "output");
  if (output) return output.text.split("\n").find((line) => line.trim())?.trim() ?? "";
  const paste = prompt.parts.find((part): part is PromptPastePart => part.kind === "paste");
  if (paste) return paste.text.split("\n").find((line) => line.trim())?.trim() ?? "";
  const labels = [...new Set(prompt.parts.filter((part): part is PromptContextPart => part.kind === "context").map((part) => part.detail ? `${part.label} ${part.detail}` : part.label))];
  return labels.join(", ");
}
