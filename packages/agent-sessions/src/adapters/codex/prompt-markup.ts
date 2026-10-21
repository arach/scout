// ---------------------------------------------------------------------------
// Codex prompt markup.
//
// Codex and the Codex app write their own material into user messages:
// AGENTS.md instructions, an environment block, ambient browser state, goal
// context, image attachments, realtime voice hand-offs, question replies, and
// the app's request framing ("# Files mentioned by the user:", "## My request
// for Codex:"). This file is the one place that knows those shapes; it
// returns protocol PromptParts so nothing downstream parses Codex's text.
// ---------------------------------------------------------------------------

import {
  classifiedPrompt,
  type ClassifiedPrompt,
  type PromptPart,
} from "../../protocol/prompt-parts.js";
import { markupChildren, markupLabel, nextMarkupElement, type MarkupElement } from "../prompt-markup-scan.js";

const CONTEXT_LABELS: Record<string, string> = {
  environment_context: "Environment",
  user_instructions: "Instructions",
  INSTRUCTIONS: "Instructions",
  "in-app-browser-context": "Browser context",
  external_codex_apps_open_page: "App page",
  transcript_delta: "Voice transcript",
};
const SPECIAL_TAGS = new Set(["codex_internal_context", "image", "realtime_delegation", "send_user_message_question_reply", "turn_aborted"]);
const SCAN = {
  isKnown: (name: string) => name in CONTEXT_LABELS || SPECIAL_TAGS.has(name),
  openOnly: new Set(["image"]),
};

const AGENTS_HEADING = /^#\s*AGENTS\.md instructions(?:\s+for\s+(.+?))?\s*$/m;
/** The Codex app's sections around a request. */
const APP_SECTION = /^#\s*(Files mentioned by the user|Files pasted by the user|Browser comments)\s*:?\s*$/;
const REQUEST_HEADING = /^#{1,4}\s*My request(?:\s+for\s+[^:\n]+)?\s*:?\s*$/i;

function contextPart(element: MarkupElement): PromptPart {
  const text = element.body.trim();
  const detail = element.name === "environment_context"
    ? markupChildren(element.body).cwd
    : element.attrs.source ?? Object.values(element.attrs)[0];
  return {
    kind: "context",
    name: element.name,
    label: CONTEXT_LABELS[element.name] ?? markupLabel(element.name),
    ...(detail ? { detail } : {}),
    ...(text ? { text } : {}),
  };
}

function elementParts(element: MarkupElement): PromptPart[] {
  switch (element.name) {
    case "codex_internal_context": {
      const goal = element.attrs.source === "goal";
      const objective = markupChildren(element.body).objective;
      return [{
        kind: "context",
        name: element.name,
        label: goal ? "Goal" : "Codex context",
        ...(!goal && element.attrs.source ? { detail: element.attrs.source } : {}),
        text: (objective ?? element.body).trim(),
      }];
    }
    case "image": {
      const path = element.attrs.path;
      const detail = path ? path.split("/").at(-1) : element.attrs.name;
      return [{ kind: "context", name: "image", label: "Image", ...(detail ? { detail } : {}), ...(path ? { text: path } : {}) }];
    }
    case "realtime_delegation": {
      // A voice hand-off: the operator's spoken words ride in <input>, the
      // conversation so far in <transcript_delta>. Without an input (e.g. the
      // tail flushed when a voice session ends), the rest is Codex's note.
      const fields = markupChildren(element.body);
      const parts: PromptPart[] = [];
      if (fields.input) parts.push({ kind: "words", text: fields.input });
      const note = element.body.replace(/<([a-zA-Z][\w-]*)>[\s\S]*?<\/\1>/g, "").trim();
      if (note && !fields.input) parts.push({ kind: "context", name: "realtime_delegation", label: "Voice hand-off", ...(fields.source ? { detail: fields.source } : {}), text: note });
      if (fields.transcript_delta) parts.push({ kind: "context", name: "transcript_delta", label: CONTEXT_LABELS.transcript_delta!, text: fields.transcript_delta });
      return parts;
    }
    case "send_user_message_question_reply": {
      try {
        const replies = JSON.parse(element.body.trim()) as Array<{ answer?: unknown }>;
        const answers = replies.map((reply) => (typeof reply.answer === "string" ? reply.answer : "")).filter(Boolean);
        if (answers.length) return [{ kind: "words", text: answers.join("\n") }];
      } catch {
        // fall through: an unparseable reply is still the operator's
      }
      return element.body.trim() ? [{ kind: "words", text: element.body.trim() }] : [];
    }
    case "turn_aborted":
      return [{ kind: "notice", source: "interrupt", summary: "Interrupted" }];
    default:
      return [contextPart(element)];
  }
}

/** Bare text between elements: AGENTS.md headings and the app's request
 *  framing are Codex's; whatever is left is the operator's. */
function textParts(chunk: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let words: string[] = [];
  let section: { name: string; lines: string[] } | null = null;
  const flushWords = () => {
    const text = words.join("\n").trim();
    if (text) parts.push({ kind: "words", text });
    words = [];
  };
  const flushSection = () => {
    if (!section) return;
    const text = section.lines.join("\n").trim();
    const first = text.match(/^##\s*(.+?):\s/m)?.[1];
    const name = section.name.toLowerCase().replace(/\s+/g, "-");
    parts.push({ kind: "context", name, label: section.name.replace(/ by the user$/i, ""), ...(first ? { detail: first } : {}), ...(text ? { text } : {}) });
    section = null;
  };

  for (const line of chunk.split("\n")) {
    const agents = line.match(AGENTS_HEADING);
    if (agents) {
      flushWords();
      flushSection();
      parts.push({ kind: "context", name: "agents-md", label: "AGENTS.md", ...(agents[1] ? { detail: agents[1] } : {}) });
      continue;
    }
    const app = line.match(APP_SECTION);
    if (app) {
      flushWords();
      flushSection();
      section = { name: app[1]!, lines: [] };
      continue;
    }
    if (REQUEST_HEADING.test(line)) {
      flushSection();
      continue;
    }
    if (section) section.lines.push(line);
    else words.push(line);
  }
  flushSection();
  flushWords();
  return parts;
}

function classifyMarkup(text: string): ClassifiedPrompt {
  const parts: PromptPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const element = nextMarkupElement(text, cursor, SCAN);
    parts.push(...textParts(text.slice(cursor, element ? element.start : text.length)));
    if (!element) break;
    cursor = element.end;
    // The AGENTS.md body follows its heading as <INSTRUCTIONS>: fold it in.
    const previous = parts.at(-1);
    if (element.name === "INSTRUCTIONS" && previous?.kind === "context" && previous.name === "agents-md" && !previous.text) {
      previous.text = element.body.trim();
      continue;
    }
    parts.push(...elementParts(element));
  }
  return classifiedPrompt(parts);
}

/** Split a Codex user message into the operator's words and Codex's material. */
export function classifyCodexPrompt(text: string): ClassifiedPrompt {
  return classifyMarkup(text);
}
