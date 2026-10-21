// ---------------------------------------------------------------------------
// Prompt classifiers by harness. Each adapter that writes markup into user
// turns owns a classifier beside it; this maps a harness name to that
// classifier so callers holding only a transcript's source can split a turn
// without knowing any harness's tags. A harness with no classifier returns
// null and the caller keeps the raw text.
// ---------------------------------------------------------------------------

import type { ClassifiedPrompt } from "../protocol/prompt-parts.js";
import { classifyClaudeCodePrompt } from "./claude-code/prompt-markup.js";
import { classifyCodexPrompt } from "./codex/prompt-markup.js";

export interface PromptClassifyOptions {
  /** The transcript entry marks itself harness-written (Claude Code's `isMeta`). */
  meta?: boolean;
}

type Classifier = (text: string, options: PromptClassifyOptions) => ClassifiedPrompt;

const CLASSIFIERS: Record<string, Classifier> = {
  claude: classifyClaudeCodePrompt,
  "claude-code": classifyClaudeCodePrompt,
  codex: (text) => classifyCodexPrompt(text),
};

/** Split a user turn with its harness's own classifier, or null when that
 *  harness has none. */
export function classifyHarnessPrompt(harness: string | null | undefined, text: string, options: PromptClassifyOptions = {}): ClassifiedPrompt | null {
  const key = harness?.trim().toLowerCase();
  const classify = key && Object.hasOwn(CLASSIFIERS, key) ? CLASSIFIERS[key] : undefined;
  return classify ? classify(text, options) : null;
}
