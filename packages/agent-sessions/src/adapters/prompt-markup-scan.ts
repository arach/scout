// ---------------------------------------------------------------------------
// Wrapper-element scanning for adapter prompt classifiers.
//
// Harnesses wrap what they inject into user turns in XML-ish elements. Which
// elements exist, and what each means, is the adapter's business (each keeps
// its own table in adapters/<harness>/prompt-markup.ts); this file only finds
// them. An element counts when it is known to the caller, or when its name
// carries a hyphen or underscore, it closes, and it starts a line or directly
// follows the previous element. A `<div>` mid-sentence is never one.
// ---------------------------------------------------------------------------

export type MarkupElement = {
  name: string;
  attrs: Record<string, string>;
  body: string;
  start: number;
  end: number;
};

export type MarkupScanOptions = {
  /** Element names the adapter knows; these may run unclosed to the end of a
   *  turn (previews cut text short). */
  isKnown: (name: string) => boolean;
  /** Elements written as an opening tag alone (e.g. `<image name=… path=…>`). */
  openOnly?: ReadonlySet<string>;
};

const OPEN_TAG = /<([a-zA-Z][\w.-]*)((?:\s[^<>]*?)?)\s*(\/?)>/g;
const ATTR = /([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\[[^\]]*\]|[^\s"'>]+))/g;
const CHILD = /<([a-zA-Z][\w-]*)>([\s\S]*?)<\/\1>/g;

export function parseMarkupAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR)) attrs[match[1]!] = match[2] ?? match[3] ?? match[4] ?? "";
  return attrs;
}

function atLineStart(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return text.slice(lineStart, index).trim() === "";
}

/** The next wrapper element at or after `from`, or null. */
export function nextMarkupElement(text: string, from: number, options: MarkupScanOptions): MarkupElement | null {
  const scan = new RegExp(OPEN_TAG.source, "g");
  scan.lastIndex = from;
  for (let match = scan.exec(text); match; match = scan.exec(text)) {
    const name = match[1]!;
    const known = options.isKnown(name);
    if (!known && !/[-_]/.test(name)) continue;
    // An unknown wrapper must start a line or follow the previous element;
    // a known one that closes is the harness's wherever it sits.
    const placed = atLineStart(text, match.index) || text.slice(from, match.index).trim() === "";
    if (!known && !placed) continue;
    const openEnd = match.index + match[0].length;
    const attrs = parseMarkupAttrs(match[2] ?? "");
    if (match[3] === "/") return { name, attrs, body: "", start: match.index, end: openEnd };
    // Claude's pasted_content close repeats the opener's random id. A bare
    // or foreign-id close inside the pasted material must not end the block.
    // Compare parsed values, not interpolated regexes; no id matches no id
    // only (legacy wrappers). An unmatched known wrapper consumes the rest.
    const close = new RegExp(`</${name.replace(/[.]/g, "\\.")}(\\s[^<>]*)?>`, "g");
    close.lastIndex = openEnd;
    for (let closed = close.exec(text); closed; closed = close.exec(text)) {
      const closeAttrs = parseMarkupAttrs(closed[1] ?? "");
      if (closeAttrs.id !== attrs.id) continue;
      return { name, attrs, body: text.slice(openEnd, closed.index), start: match.index, end: closed.index + closed[0].length };
    }
    if (!placed) continue;
    if (options.openOnly?.has(name)) return { name, attrs, body: "", start: match.index, end: openEnd };
    if (known) return { name, attrs, body: text.slice(openEnd), start: match.index, end: text.length };
  }
  return null;
}

/** Simple `<child>value</child>` fields inside an element's body. */
export function markupChildren(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of body.matchAll(CHILD)) out[match[1]!] = match[2]!.trim();
  return out;
}

/** An element name as words: `recommended_plugins` → "Recommended plugins". */
export function markupLabel(name: string): string {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}
