import { resolveJevEndpoint } from "./session-retrospective-jev.ts";
import { JEV_MODEL } from "../shared/session-retrospective.ts";
import { COMMANDS, commandLineRe, parseLine, type CommandSpec } from "../client/screens/ops/world-week/commands.ts";

/**
 * Words → the World · Week HUD's ":" command line.
 *
 * Jev (TypeSafe's System One) picks one verb from a closed set, and which
 * roster agent / lane / view the words name, as typed choices. Code does the
 * rest: time phrases become a playhead inside the week, names are fuzzy-matched,
 * numbers are read. Jev can't do dates or arithmetic, so it is never asked to.
 * Without TYPESAFE_API_KEY a keyword parser stands in (engine: "fallback").
 *
 * The output is literal ":" lines the engine already runs. The HUD's command
 * registry (client/screens/ops/world-week/commands.ts) is the one list: each verb
 * here lands on a registry entry (its `voice.verb`), Jev's choices are those
 * entries' words, the literal pass-through is the registry's own grammar, and
 * a command without a verb answers to its registry phrases ("artifacts up").
 */

export const WORLD_VERBS = ["goto", "find", "lane", "view", "zero-in", "open", "back", "play", "pause", "speed", "window", "source", "errors", "stuck", "theme", "accent"] as const;
/** "command": a registry phrase with no verb of its own ("artifacts up" → :lift on) */
export type WorldVerb = typeof WORLD_VERBS[number] | "command";
export const WORLD_CONFIDENCE_FLOOR = 0.72;
const JEV_TIMEOUT_MS = 4_000;
const VIEWS = ["iso", "top", "side", "low"] as const;
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const H = 36e5, DAY = 864e5, MIN = 6e4;
/**
 * A whole line already in the ":" grammar passes through as is: the registry's
 * grammar, minus find/lane (names go through the fuzzy match: "find devin" →
 * devon). "back two hours" is words, not the bare back verb.
 */
export const WORLD_COMMAND_LINE = commandLineRe((c) => c.literal !== false);

/** What the HUD knows; every field optional (voice may arrive with none of it). */
export type WorldCommandContext = {
  roster?: string[];
  lanes?: string[];
  /** Week bounds and playhead, epoch ms. `to` is the week's "now". */
  from?: number;
  to?: number;
  t?: number;
  /** Date#getTimezoneOffset() on the HUD's machine, minutes. */
  tzOffset?: number;
  playing?: boolean;
  speed?: number;
  view?: string;
  open?: string | null;
};

export type WorldProposal = { verb: WorldVerb; commands: string[]; echo: string; confidence: number; at?: number };
export type WorldCommandEngine = "jev" | "fallback" | "literal";
export type WorldCommandResult =
  | ({ status: "ok"; engine: WorldCommandEngine } & WorldProposal)
  | { status: "confirm"; engine: WorldCommandEngine; verb: WorldVerb; confidence: number; echo: string; proposal: WorldProposal }
  | { status: "none"; engine: WorldCommandEngine; confidence: 0; echo: string; jevError?: string };

export class WorldCommandJevError extends Error {
  constructor(message: string, readonly status: 502 | 503 | 504) {
    super(message);
    this.name = "WorldCommandJevError";
  }
}

/* ---------------- normalizing ---------------- */

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, couple: 2, few: 3,
};
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const num = (raw: string): number => NUMBER_WORDS[raw] ?? Number(raw);

/** Lowercase, speech punctuation gone, "3 p.m." → "3pm", leading "world," / "scout," address dropped. */
export function normalizeUtterance(text: string): string {
  return text.toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b(a|p)\.\s?m\b\.?/g, "$1m")
    .replace(/(\d)\s+(am|pm)\b/g, "$1$2")
    .replace(/[^a-z0-9:'+\-@.\s]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(hey |ok |okay )?(scout|world|scoutbot)\s+/, "")
    .replace(/^(please|can you|could you|let's|lets)\s+/, "")
    .replace(/\s+please$/, "");
}

/** The last sentence: ambient speech rambles, and the end says what to do. */
export function lastSentence(text: string): string {
  const parts = text.split(/[.?!]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? text.trim();
}

/* ---------------- fuzzy names ---------------- */

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}
const similar = (a: string, b: string) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);
const NAME_NOISE = new Set(["wt", "other", "the", "lane", "agent", "codex", "claude"]);

/**
 * Best roster/lane entry the words name, 0–1. Speech mangles names ("devin" for
 * devon), so each word window is compared by edit distance, and a multi-part
 * name ("wt · voice-nav") also answers to its distinctive parts.
 */
export function fuzzyName(text: string, candidates: readonly string[], floor = 0.72): { name: string; score: number } | null {
  const words = fold(text).split(" ").filter(Boolean);
  if (!words.length) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of candidates) {
    const full = fold(name);
    if (!full) continue;
    const forms = new Set([full, full.replace(/ /g, "")]);
    for (const part of full.split(" ")) if (part.length >= 3 && !NAME_NOISE.has(part)) forms.add(part);
    let score = 0;
    for (const form of forms) {
      const k = form.split(" ").length;
      for (let i = 0; i + k <= words.length; i++) {
        const window = words.slice(i, i + k).join(" ");
        if (window.length < 3 && window !== form) continue;
        // a whole-form hit beats a part hit, so "voice nav" picks the lane named that over a sibling
        const s = similar(window, form) * (form === full ? 1 : 0.94);
        if (s > score) score = s;
      }
      // spoken as one run-together word ("voicenav")
      if (k > 1) for (const w of words) score = Math.max(score, similar(w, form.replace(/ /g, "")) * 0.94);
    }
    if (score >= floor && (!best || score > best.score)) best = { name, score };
  }
  return best;
}

/* ---------------- time ---------------- */

const PARTS: Array<[RegExp, number]> = [
  [/\b(early morning|first thing)\b/, 7], [/\bmorning\b/, 9], [/\b(noon|midday|lunch(time)?)\b/, 12],
  [/\bafternoon\b/, 15], [/\b(evening|after work)\b/, 19], [/\b(tonight|night|late)\b/, 22], [/\bmidnight\b/, 0],
  [/\b(end of (the )?day|eod)\b/, 23.5], [/\b(start|beginning) of (the )?day\b/, 0],
];
const DAY_WORDS: Array<[RegExp, number]> = [
  [/\bsun(day)?\b/, 0], [/\bmon(day)?\b/, 1], [/\btue(s(day)?)?\b/, 2], [/\bwed(nesday)?\b/, 3],
  [/\bthu(rs(day)?)?\b/, 4], [/\bfri(day)?\b/, 5], [/\bsat(urday)?\b/, 6],
];

type Clock = { tz: number; from: number; to: number };
const localDate = (ms: number, c: Clock) => new Date(ms - c.tz * MIN);
const localMidnight = (ms: number, c: Clock) => { const d = localDate(ms, c); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + c.tz * MIN; };
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (ms: number, c: Clock) => { const d = localDate(ms, c); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const dowOf = (ms: number, c: Clock) => localDate(ms, c).getUTCDay();
function dayStarts(c: Clock): number[] {
  const out: number[] = [];
  for (let d = localMidnight(c.from, c); d <= c.to; d += DAY) out.push(d);
  return out;
}

/** A ":goto" for an absolute time: readable (wed 14:00) when that weekday occurs once in the week, exact otherwise. */
export function gotoLine(at: number, c: Clock): string {
  const dow = dowOf(at, c), once = dayStarts(c).filter((d) => dowOf(d, c) === dow).length === 1;
  return once ? `goto ${DOW[dow]} ${hhmm(at, c)}` : `goto @${Math.round(at)}`;
}
const tag = (at: number, c: Clock) => `${DOW[dowOf(at, c)]!.toUpperCase()} ${hhmm(at, c)}`;

export type TimeResolution =
  | { kind: "line"; line: string; echo: string }
  | { kind: "at"; at: number; line: string; echo: string }
  | { kind: "outside"; echo: string };

/**
 * A time phrase → one ":goto" line. Relative-to-playhead moves ("back two
 * hours") stay relative (the engine knows where the playhead is); phrases about
 * the clock ("an hour ago", "wednesday afternoon") become an absolute time in
 * the HUD's own timezone, checked against the week. Null: no time phrase here.
 */
export function resolveTime(text: string, ctx: WorldCommandContext): TimeResolution | null {
  const s = normalizeUtterance(text);
  if (/\b(end of (the )?week|right now|latest|most recent|the end|live|^now$|to now|go now)\b/.test(s) || /^(goto |go to |jump to )?now$/.test(s)) return { kind: "line", line: "goto now", echo: "NOW" };
  if (/\b((start|beginning) of (the )?week|the (start|beginning)|from the top|week start)\b/.test(s)) return { kind: "line", line: "goto start", echo: "START OF WEEK" };

  const units: Record<string, string> = { minute: "m", min: "m", hour: "h", hr: "h", day: "d" };
  const U = "(minute|min|hour|hr|day)s?";
  const half = /\bhalf (an|a) hour\b/.test(s) && !/\bago\b/.test(s);
  const DIRS = "back|rewind|forward|ahead|skip ahead|skip forward|later|earlier|plus|minus";
  const lead = half ? null : s.match(new RegExp(`\\b(${DIRS})\\b(?: by)?\\s+${NUM}\\s+${U}`));       // "back two hours"
  const tail = half ? null : s.match(new RegExp(`\\b${NUM}\\s+${U}\\s+(back|earlier|forward|ahead|later)\\b`)); // "two hours later"
  const halfDir = half ? s.match(/\b(back|rewind|forward|ahead|later|earlier)\b/)?.[1] : undefined;
  if (lead || tail || halfDir) {
    const [dir, n, u] = lead ? [lead[1]!, num(lead[2]!), units[lead[3]!]!]
      : tail ? [tail[3]!, num(tail[1]!), units[tail[2]!]!]
      : [halfDir!, 30, "m"];
    const sign = /back|rewind|earlier|minus/.test(dir) ? "-" : "+";
    return { kind: "line", line: `goto ${sign}${n}${u}`, echo: `${sign}${n}${u.toUpperCase()}` };
  }

  const c: Clock | null = Number.isFinite(ctx.from) && Number.isFinite(ctx.to)
    ? { from: ctx.from!, to: ctx.to!, tz: Number.isFinite(ctx.tzOffset) ? ctx.tzOffset! : new Date(ctx.to!).getTimezoneOffset() }
    : null;

  const ago = s.match(new RegExp(`\\b${NUM}\\s+${U}\\s+ago\\b`)) ?? (/\bhalf (an|a) hour ago\b/.test(s) ? ["", "30", "minute"] : null);
  if (ago) {
    const n = num(ago[1]!), u = units[ago[2]!]!;
    if (!c) return { kind: "line", line: `goto -${n}${u}`, echo: `-${n}${u.toUpperCase()}` };
    const at = c.to - n * ({ m: MIN, h: H, d: DAY } as Record<string, number>)[u]!;
    if (at < c.from) return { kind: "outside", echo: "BEFORE THIS WEEK" };
    return { kind: "at", at, line: gotoLine(at, c), echo: tag(at, c) };
  }

  // a day, a part of day, a clock time, in any combination
  let dow: number | null = null, dayOffset: number | null = null;
  for (const [re, d] of DAY_WORDS) if (re.test(s)) { dow = d; break; }
  if (/\btoday\b|\bthis (morning|afternoon|evening)\b|\btonight\b/.test(s)) dayOffset = 0;
  if (/\byesterday\b|\blast night\b/.test(s)) dayOffset = 1;
  let part: number | null = null;
  for (const [re, h] of PARTS) if (re.test(s)) { part = h; break; }
  let hour: number | null = null, minute = 0;
  const clock = s.match(/\b(?:at |around |about )?(\d{1,2})(?::(\d{2}))?(am|pm)\b/)
    ?? s.match(/\b(?:at|around|about) (\d{1,2})(?::(\d{2}))?\b(?!\s*(minute|min|hour|hr|day)s?)/)
    ?? s.match(/\b(\d{1,2}):(\d{2})\b/)
    ?? s.match(new RegExp(`\\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?: o'?clock)?\\s?(am|pm|o'?clock)\\b`));
  if (clock) {
    hour = num(clock[1]!); minute = clock[2] && /^\d+$/.test(clock[2]) ? Number(clock[2]) : 0;
    const ap = clock[3] ?? (clock[2] && /^(am|pm)$/.test(clock[2]) ? clock[2] : undefined);
    if (ap === "pm" && hour < 12) hour += 12;
    else if (ap === "am" && hour === 12) hour = 0;
    else if (!ap && hour < 12 && part !== null && part >= 12) hour += 12;
    else if (!ap && !clock[2] && hour >= 1 && hour <= 6 && part === null) hour += 12; // "at 4" is 16:00; "3:30" is as said
    if (hour > 23 || minute > 59) hour = null;
  }
  if (/\blast night\b/.test(s) && part === null) part = 22;
  if (dow === null && dayOffset === null && part === null && hour === null) return null;

  const h = hour ?? part ?? 12;
  const hm = `${pad(Math.floor(h))}:${pad(hour !== null ? minute : Math.round((h % 1) * 60))}`;
  if (!c) {
    // no week to check against: let the engine place it (it knows the week)
    const day = dow !== null ? DOW[dow] : dayOffset === 0 ? "" : null;
    if (day === null) return null;
    return { kind: "line", line: `goto ${day ? day + " " : ""}${hm}`.replace(/\s+/g, " ").trim(), echo: `${day ? day.toUpperCase() + " " : ""}${hm}` };
  }
  const days = dayStarts(c);
  let base: number | undefined;
  if (dayOffset !== null) base = localMidnight(c.to, c) - dayOffset * DAY;
  else if (dow !== null) base = days.filter((d) => dowOf(d, c) === dow).pop(); // the most recent one
  else base = localMidnight(ctx.t ?? c.to, c);                                  // a bare time: the playhead's day
  if (base === undefined) return { kind: "outside", echo: `NO ${DOW[dow!]!.toUpperCase()} IN THIS WEEK` };
  // a day start is local midnight; add the wall-clock hours in the same local frame
  const at = base + Math.floor(h) * H + (hour !== null ? minute : Math.round((h % 1) * 60)) * MIN;
  if (at > c.to) return { kind: "outside", echo: `${tag(at, c)} HASN'T HAPPENED YET` };
  if (at < c.from) return { kind: "outside", echo: `${tag(at, c)} IS BEFORE THIS WEEK` };
  return { kind: "at", at, line: gotoLine(at, c), echo: tag(at, c) };
}

/* ---------------- registry phrases ---------------- */

type Phrase = { words: string; line: string; id: string };
const PHRASES: Phrase[] = COMMANDS.flatMap((c: CommandSpec) => c.voice && !c.voice.verb
  ? c.voice.phrases.map((p) => { const [said, line] = Array.isArray(p) ? p : [p, c.voice!.line ?? c.names[0]!]; return { words: normalizeUtterance(said), line, id: c.id }; })
  : []).sort((a, b) => b.words.length - a.words.length);

/**
 * A command with no verb, by its registry words: the whole utterance, or a
 * two-word-plus phrase with at most two words around it ("ok artifacts up").
 * Runs before the keyword verbs: "reset the camera" is not a view change.
 */
export function phraseCommand(text: string): { line: string; id: string } | null {
  const s = normalizeUtterance(text);
  if (!s) return null;
  const n = s.split(" ").length;
  for (const p of PHRASES) {
    if (s === p.words) return { line: p.line, id: p.id };
    const k = p.words.split(" ").length;
    if (k >= 2 && n - k <= 2 && ` ${s} `.includes(` ${p.words} `)) return { line: p.line, id: p.id };
  }
  return null;
}
const phraseResult = (engine: WorldCommandEngine, hit: { line: string }): WorldCommandResult =>
  ({ status: "ok", engine, verb: "command", commands: [hit.line], echo: hit.line.toUpperCase(), confidence: 0.95 });

/* ---------------- verbs (keyword) ---------------- */

/** Keyword guess at the verb; the fallback parser and the voice router both start here. */
export function keywordVerb(text: string): { verb: WorldVerb; strong: boolean } | null {
  const s = normalizeUtterance(text);
  if (!s) return null;
  if (/\b(pause|freeze|stop( playing| the replay)?|hold (it|on))\b/.test(s)) return { verb: "pause", strong: true };
  // trouble: "anything stuck over ten minutes?" · "show me errors" · "what's broken"
  if (STUCK_WORDS.test(s)) return { verb: "stuck", strong: true };
  if (ERROR_WORDS.test(s)) return { verb: "errors", strong: true };
  if (ACCENT_WORDS.test(s)) return { verb: "accent", strong: true };
  if (THEME_WORDS.test(s)) return { verb: "theme", strong: true };
  if (SOURCE_WORDS.test(s)) return { verb: "source", strong: true };
  if (WINDOW_WORDS.test(s)) return { verb: "window", strong: true };
  if (/\b(speed|faster|slower|speed up|slow down|double time|half speed)\b|\b\d+(\.\d+)?x\b|\btimes (\d+|two|four|eight)\b/.test(s)) return { verb: "speed", strong: true };
  if (/\b(play|resume|unpause|keep going|roll it|start (the )?replay)\b/.test(s)) return { verb: "play", strong: true };
  if (/\bzero (in|into)\b|\b(dive|drill) in\b|\bfocus (in|on the work)\b/.test(s)) return { verb: "zero-in", strong: true };
  if (/\b(view|angle|camera|overhead|bird'?s?[ -]eye|from above|isometric|side on|ground level)\b/.test(s)) return { verb: "view", strong: true };
  if (/\b(lanes?|workspaces?|solo|unsolo|isolate)\b/.test(s)) return { verb: "lane", strong: true };
  if (/\b(inspect(or)?|details|preview|expand|full ?screen|bigger|what'?s (here|there))\b|^open\b/.test(s)) return { verb: "open", strong: true };
  if (!/\b(minute|min|hour|hr|day)s?\b/.test(s) && /^(go )?back$|\b(close (it|that|this|the \w+)|escape|never ?mind|dismiss|get out|go back|step back)\b/.test(s)) return { verb: "back", strong: true };
  if (/\b(find|where('?s| is| was)|fly to|locate)\b/.test(s)) return { verb: "find", strong: true };
  return null;
}

// FAILED · STUCK: plain words for the two trouble states; a duration sets the stuck threshold (:stuck 10m|30m|1h)
const STUCK_WORDS = /\b(stuck|hung|hanging|unanswered|waiting too long|no reply|not answered)\b/;
const ERROR_WORDS = /\b(errors?|broken|breaking|failed|failures?|failing|trouble|what'?s wrong|went wrong|anything wrong)\b/;
/** "over ten minutes" → "10m", "an hour" → "1h", "half an hour" → "30m"; null when no duration is said */
function stuckFrom(s: string): string | null {
  if (/\bhalf (an )?hour\b/.test(s)) return "30m";
  if (/\b(an|one|1) hour\b/.test(s)) return "1h";
  const m = s.match(new RegExp(`\\b${NUM}\\s*(minutes?|mins?|m|hours?|hrs?|h)\\b`));
  if (!m) return null;
  const n = num(m[1]!), unit = /^h/.test(m[2]!) ? "h" : "m";
  return Number.isFinite(n) && n > 0 ? `${n}${unit}` : null;
}

// the look: a treatment ("paper", "go dark", "light mode") and an accent ("emerald accent", "make it cobalt")
const THEMES = ["paper", "linen", "ember", "dusk", "scout"] as const;
const ACCENTS = ["amber", "emerald", "cobalt", "vermilion", "violet", "graphite"] as const;
const THEME_WORDS = /\b(themes?|treatments?|paper|linen|ember|dusk|light mode|dark mode|night mode|go (light|dark)|lights? (on|off))\b/;
const ACCENT_WORDS = /\b(accents?|amber|emerald|cobalt|vermilion|violet|graphite)\b/;
function themeFrom(s: string): string | null {
  const named = THEMES.find((t) => new RegExp(`\\b${t}\\b`).test(s));
  if (named) return named;
  if (/\b(light mode|go light|lights? on|daylight)\b/.test(s)) return "paper";
  if (/\b(night mode|dusk)\b/.test(s)) return "dusk";
  if (/\b(dark mode|go dark|lights? off|default|normal|back to scout)\b/.test(s)) return "scout";
  if (/\b(next|another|cycle|change|switch)\b/.test(s)) return "next";
  return null;
}
function accentFrom(s: string): string | null {
  const named = ACCENTS.find((a) => new RegExp(`\\b${a}\\b`).test(s));
  if (named) return named;
  if (/\b(default|reset|normal|the theme'?s)\b/.test(s)) return "default";
  if (/\b(next|another|cycle|change|switch)\b/.test(s)) return "next";
  return null;
}

// where the world comes from: "go live", "switch to otlp", "back to the snapshot week"
const SOURCE_WORDS = /\b(source|go live|live (data|feed|world)|follow (us|along)( live)?|otlp|open telemetry|snapshot|recorded week)\b/;
function sourceFrom(s: string): "week" | "live" | "otlp" | null {
  if (/\b(otlp|open telemetry|telemetry)\b/.test(s)) return "otlp";
  if (/\b(snapshot|recorded|the week|week data)\b/.test(s)) return "week";
  if (/\b(live|follow)\b/.test(s)) return "live";
  return null;
}

// the window ladder: "the last four hours", "show the mesh", "widen the window"
const WINDOW_WORDS = /\bwindows?\b|\b(last|past) (minute|(5|five|30|thirty) minutes|half (an )?hour|(4|four|24|twenty four) hours|day)\b|\bmesh\b|\bwhole week\b/;
/** Words → the ":window" argument, or null. */
function windowFrom(s: string): string | null {
  if (/\b(close|off|no window|clear|drop)\b/.test(s)) return "off";
  if (/\b(wider|widen|zoom out|out|bigger|longer)\b/.test(s)) return "wider";
  if (/\b(narrower|narrow|tighter|tighten|zoom in|shorter|smaller)\b/.test(s)) return "narrower";
  if (/\b(live|last minute|right now)\b/.test(s)) return "live";
  if (/\b(5|five) minutes?\b/.test(s)) return "5m";
  if (/\b(30|thirty) minutes?\b|\bhalf (an )?hour\b/.test(s)) return "30m";
  if (/\b(4|four) hours?\b/.test(s)) return "4h";
  if (/\b(24|twenty four) hours?\b|\b(last|past) day\b/.test(s)) return "24h";
  if (/\b(all|whole week|everything|mesh)\b/.test(s)) return "all";
  return null;
}

function speedFrom(s: string, ctx: WorldCommandContext): number | null {
  const cur = ctx.speed && Number.isFinite(ctx.speed) ? ctx.speed : 1;
  if (/\b(faster|speed (it )?up)\b/.test(s)) return SPEEDS.find((v) => v > cur) ?? SPEEDS[SPEEDS.length - 1]!;
  if (/\b(slower|slow (it )?down)\b/.test(s)) return [...SPEEDS].reverse().find((v) => v < cur) ?? SPEEDS[0]!;
  if (/\bdouble\b/.test(s)) return cur * 2;
  if (/\bhalf speed\b/.test(s)) return 0.5;
  if (/\b(normal|regular|real ?time) speed\b/.test(s)) return 1;
  const m = s.match(new RegExp(`\\b(?:speed|times|x)\\s*(?:to |of )?${NUM}\\b`)) ?? s.match(/\b(\d+(?:\.\d+)?)\s?x\b/);
  if (!m) return null;
  const n = num(m[1]!);
  return Number.isFinite(n) && n > 0 && n <= 64 ? n : null;
}

function viewFrom(s: string): typeof VIEWS[number] | null {
  if (/\b(top|overhead|bird'?s?[ -]eye|from above)\b/.test(s)) return "top";
  if (/\bside\b/.test(s)) return "side";
  if (/\b(low|ground level)\b/.test(s)) return "low";
  if (/\b(iso|isometric|default|normal)\b/.test(s)) return "iso";
  return null;
}

/* ---------------- slots → lines ---------------- */

type Slots = { agent?: string | null; lane?: string | null; view?: string | null };

/** One verb + the words → ":" lines. Null when a slot it needs is missing. */
function linesFor(verb: WorldVerb, text: string, ctx: WorldCommandContext, slots: Slots): { commands: string[]; echo: string; at?: number } | { missing: string } {
  const s = normalizeUtterance(text);
  switch (verb) {
    case "play": return { commands: ["play"], echo: "PLAY" };
    case "pause": return { commands: ["pause"], echo: "PAUSE" };
    case "window": {
      const w = windowFrom(s);
      return w ? { commands: [`window ${w}`], echo: `WINDOW · ${w.toUpperCase()}` } : { missing: "WINDOW · LIVE 5M 30M 4H 24H ALL" };
    }
    case "source": {
      const src = sourceFrom(s);
      return src ? { commands: [`source ${src}`], echo: `SOURCE · ${src.toUpperCase()}` } : { missing: "SOURCE · WEEK LIVE OTLP" };
    }
    case "errors":
      return /\b(off|hide|clear|dismiss|stop showing|no more|close)\b/.test(s) ? { commands: ["errors off"], echo: "ERRORS · OFF" } : { commands: ["errors on"], echo: "ERRORS · FAILED · STUCK" };
    case "stuck": {
      const d = stuckFrom(s);
      return d ? { commands: [`stuck ${d}`, "errors on"], echo: `STUCK > ${d.toUpperCase()}` } : { commands: ["errors on"], echo: "ERRORS · FAILED · STUCK" };
    }
    case "theme": {
      const t = themeFrom(s);
      return t ? { commands: [`theme ${t}`], echo: `THEME · ${t.toUpperCase()}` } : { missing: "THEME · PAPER LINEN EMBER DUSK SCOUT" };
    }
    case "accent": {
      const a = accentFrom(s);
      return a ? { commands: [`accent ${a}`], echo: `ACCENT · ${a.toUpperCase()}` } : { missing: "ACCENT · AMBER EMERALD COBALT VERMILION VIOLET GRAPHITE" };
    }
    case "command": return { missing: "NOT A WORLD COMMAND" };
    case "zero-in": return { commands: ["zero"], echo: "ZERO IN" };
    case "back": return { commands: ["back"], echo: "BACK" };
    case "open":
      return /\b(preview|expand|full ?screen|bigger)\b/.test(s) ? { commands: ["preview"], echo: "PREVIEW" } : { commands: ["open"], echo: "INSPECTOR" };
    case "speed": {
      const n = speedFrom(s, ctx);
      return n ? { commands: [`speed ${n}`], echo: `SPEED ×${n}` } : { missing: "SPEED · SAY A NUMBER" };
    }
    case "view": {
      const v = (slots.view && (VIEWS as readonly string[]).includes(slots.view) ? slots.view : null) ?? viewFrom(s);
      return v ? { commands: [`view ${v}`], echo: `VIEW · ${v.toUpperCase()}` } : { missing: "VIEW · TOP SIDE ISO LOW" };
    }
    case "lane": {
      if (/\b(all|every|unsolo|show everything|reset)\b/.test(s)) return { commands: ["lane all"], echo: "LANES · ALL" };
      const name = slots.lane ?? fuzzyName(s.replace(/\b(lanes?|workspaces?|solo|only|just|show|isolate|the)\b/g, " "), ctx.lanes ?? [])?.name;
      if (name) return { commands: [`lane ${name.toLowerCase()}`], echo: `SOLO · ${name.toUpperCase()}` };
      const raw = s.match(/\b(?:lane|solo|isolate|workspace)\s+([a-z0-9][\w.-]*)/)?.[1];
      return raw && !(ctx.lanes?.length) ? { commands: [`lane ${raw}`], echo: `SOLO · ${raw.toUpperCase()}` } : { missing: "NO LANE MATCHES" };
    }
    case "find": {
      const name = slots.agent ?? fuzzyName(s.replace(/\b(find|where'?s|where is|where was|fly to|locate|show me|take me to|go to|jump to|agent)\b/g, " "), ctx.roster ?? [])?.name;
      if (name) return { commands: [`find ${name.toLowerCase()}`], echo: `FIND · ${name.toUpperCase()}` };
      const raw = s.match(/\b(?:find|fly to|locate|where is|where's)\s+([a-z0-9][\w.-]*)/)?.[1];
      return raw && !(ctx.roster?.length) ? { commands: [`find ${raw}`], echo: `FIND · ${raw.toUpperCase()}` } : { missing: "NO AGENT MATCHES" };
    }
    case "goto": {
      const t = resolveTime(s, ctx);
      if (!t) return { missing: "GOTO · SAY A DAY OR A TIME" };
      if (t.kind === "outside") return { missing: t.echo };
      return { commands: [t.line], echo: `GOTO · ${t.echo}`, ...(t.kind === "at" ? { at: t.at } : {}) };
    }
  }
}

/* ---------------- fallback (no Jev) ---------------- */

/** Deterministic keyword parse: the stand-in when Jev isn't configured or doesn't answer. */
export function fallbackWorldCommand(text: string, ctx: WorldCommandContext = {}): WorldCommandResult {
  const s = normalizeUtterance(text);
  const phrase = phraseCommand(s);
  if (phrase) return phraseResult("fallback", phrase);
  let verb: WorldVerb | null = null, confidence = 0;
  const kw = keywordVerb(s);
  const time = resolveTime(s, ctx);
  // "back two hours" is time, not back; a time phrase outranks a weak or absent keyword
  if (time && (!kw || kw.verb === "back" || kw.verb === "find" && !fuzzyName(s, ctx.roster ?? []))) { verb = "goto"; confidence = 0.9; }
  else if (kw) { verb = kw.verb; confidence = kw.strong ? 0.9 : 0.7; }
  else if (/^(go|jump|take me|skip|move)( to)?\b/.test(s) && fuzzyName(s, ctx.roster ?? [])) { verb = "find"; confidence = 0.85; }
  else if (fuzzyName(s, ctx.roster ?? [], 0.8)) { verb = "find"; confidence = 0.6; }
  else if (fuzzyName(s, ctx.lanes ?? [], 0.8)) { verb = "lane"; confidence = 0.6; }
  if (!verb) return { status: "none", engine: "fallback", confidence: 0, echo: `NOT A WORLD COMMAND · ${s.toUpperCase().slice(0, 48)}` };
  return settle("fallback", verb, confidence, text, ctx, {});
}

function settle(engine: WorldCommandEngine, verb: WorldVerb, confidence: number, text: string, ctx: WorldCommandContext, slots: Slots, jevError?: string): WorldCommandResult {
  const out = linesFor(verb, text, ctx, slots);
  if ("missing" in out) return { status: "none", engine, confidence: 0, echo: out.missing, ...(jevError ? { jevError } : {}) };
  const proposal: WorldProposal = { verb, confidence: Math.round(confidence * 100) / 100, ...out };
  if (confidence < WORLD_CONFIDENCE_FLOOR) return { status: "confirm", engine, verb, confidence: proposal.confidence, echo: proposal.echo, proposal };
  return { status: "ok", engine, ...proposal };
}

/* ---------------- Jev ---------------- */

/** Jev's one choice per verb: the registry entry that verb lands on, in its words. */
export const VERB_CHOICES: Record<typeof WORLD_VERBS[number], string> = Object.fromEntries(WORLD_VERBS.map((verb) => {
  const c = COMMANDS.find((x) => x.voice?.verb === verb);
  if (!c) throw new Error(`world-command: verb ${verb} has no registry entry`);
  return [verb, c.voice!.choice ?? c.desc];
})) as Record<typeof WORLD_VERBS[number], string>;

/** The exact body sent to Jev: the words, the HUD's names as choices, fixed questions. No times, no numbers. */
export function buildWorldJevRequest(text: string, ctx: WorldCommandContext) {
  const roster = (ctx.roster ?? []).slice(0, 40), lanes = (ctx.lanes ?? []).slice(0, 12);
  const choiceMap = (names: string[], prefix: string) => Object.fromEntries([["none", "No name from this list is mentioned."], ...names.map((n, i) => [`${prefix}${i}`, n])]);
  const questions: Record<string, unknown> = {
    verb: { type: "choice", instructions: "The operator spoke or typed this to a timeline HUD of one week of agent activity. Which single action do they want?", choices: VERB_CHOICES },
    view: { type: "choice", instructions: "Which camera angle, if any, do the words ask for?", choices: { none: "No camera angle mentioned.", top: "From above / overhead.", side: "From the side.", iso: "Isometric, the default angle.", low: "Low, near ground level." } },
  };
  if (roster.length) questions.agent = { type: "choice", instructions: "Which roster agent, if any, do the words name? Speech may misspell names.", choices: choiceMap(roster, "r") };
  if (lanes.length) questions.lane = { type: "choice", instructions: "Which workspace lane, if any, do the words name?", choices: choiceMap(lanes, "l") };
  return {
    model: JEV_MODEL,
    state: { schema: "openscout.world-command.v1", words: text.slice(0, 400), open: ctx.open ?? null, playing: ctx.playing ?? null },
    questions,
  };
}

/** One choice answer, read leniently: { choice | value | answer, probability | confidence } or a probability map. */
export function readChoice(answer: unknown, allowed: readonly string[]): { id: string; p: number } | null {
  if (!answer || typeof answer !== "object") return null;
  const a = answer as Record<string, unknown>;
  const map = (a.probabilities ?? a.distribution ?? a.scores) as Record<string, unknown> | undefined;
  if (map && typeof map === "object") {
    const best = Object.entries(map).filter(([k, v]) => allowed.includes(k) && typeof v === "number").sort((x, y) => (y[1] as number) - (x[1] as number))[0];
    if (best) return { id: best[0], p: best[1] as number };
  }
  const id = [a.choice, a.value, a.answer, a.label].find((v): v is string => typeof v === "string" && allowed.includes(v));
  if (!id) return null;
  const p = [a.probability, a.confidence, a.score, a.p].find((v): v is number => typeof v === "number" && v >= 0 && v <= 1);
  return { id, p: p ?? WORLD_CONFIDENCE_FLOOR };
}

export async function jevWorldCommand(text: string, ctx: WorldCommandContext, options: { apiKey: string; endpoint: string; fetcher?: typeof fetch }): Promise<WorldCommandResult> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(buildWorldJevRequest(text, ctx)),
      redirect: "error",
      signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new WorldCommandJevError("Jev did not respond in time.", 504);
    throw new WorldCommandJevError("Could not reach Jev.", 502);
  }
  if (!response.ok) throw new WorldCommandJevError(response.status === 401 ? "The configured Jev API key was not accepted." : `Jev answered ${response.status}.`, response.status === 401 || response.status === 429 ? 503 : 502);
  const body = await response.json().catch(() => null) as { answers?: Record<string, unknown> } | null;
  const answers = body?.answers ?? {};
  const verb = readChoice(answers.verb, WORLD_VERBS);
  if (!verb) throw new WorldCommandJevError("Jev returned no verb.", 502);
  const roster = (ctx.roster ?? []).slice(0, 40), lanes = (ctx.lanes ?? []).slice(0, 12);
  const pick = (q: string, names: string[], prefix: string) => {
    const r = readChoice(answers[q], ["none", ...names.map((_, i) => `${prefix}${i}`)]);
    return r && r.id !== "none" && r.p >= WORLD_CONFIDENCE_FLOOR ? names[Number(r.id.slice(prefix.length))] ?? null : null;
  };
  const view = readChoice(answers.view, ["none", ...VIEWS]);
  const slots: Slots = {
    agent: pick("agent", roster, "r"),
    lane: pick("lane", lanes, "l"),
    view: view && view.id !== "none" && view.p >= WORLD_CONFIDENCE_FLOOR ? view.id : null,
  };
  return settle("jev", verb.id as WorldVerb, verb.p, text, ctx, slots);
}

/* ---------------- entry ---------------- */

export function worldJevConfig(env: Record<string, string | undefined> = process.env): { apiKey: string; endpoint: string } | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim(), endpoint = resolveJevEndpoint(env.OPENSCOUT_JEV_ENDPOINT);
  return apiKey && endpoint ? { apiKey, endpoint } : null;
}

/** Words → result. Literal ":" lines pass through; Jev when configured; the keyword parser otherwise or on a Jev failure. */
export async function resolveWorldCommand(text: string, ctx: WorldCommandContext = {}, options: { jev?: { apiKey: string; endpoint: string } | null; fetcher?: typeof fetch } = {}): Promise<WorldCommandResult> {
  const raw = text.trim().replace(/^:/, "").trim();
  if (!raw) return { status: "none", engine: "literal", confidence: 0, echo: "SAY SOMETHING" };
  if (WORLD_COMMAND_LINE.test(raw)) {
    const p = parseLine(raw);
    return { status: "ok", engine: "literal", verb: (p?.cmd.voice?.verb as WorldVerb | undefined) ?? "command", commands: [raw], confidence: 1, echo: raw.toUpperCase() };
  }
  // a registry phrase is exact: no model needed ("artifacts up", "reset the camera")
  const phrase = phraseCommand(raw);
  if (phrase) return phraseResult("fallback", phrase);
  const jev = options.jev === undefined ? worldJevConfig() : options.jev;
  if (!jev) return fallbackWorldCommand(raw, ctx);
  try {
    return await jevWorldCommand(raw, ctx, { ...jev, fetcher: options.fetcher });
  } catch (error) {
    const fallback = fallbackWorldCommand(raw, ctx);
    return { ...fallback, jevError: error instanceof Error ? error.message : "Jev failed." } as WorldCommandResult;
  }
}

/** Context arrives from the page; keep only well-typed fields. */
export function parseWorldContext(raw: unknown): WorldCommandContext {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const names = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 120).slice(0, 200) : undefined;
  const ctx: WorldCommandContext = {
    roster: names(r.roster), lanes: names(r.lanes), from: n(r.from), to: n(r.to), t: n(r.t), tzOffset: n(r.tzOffset),
    speed: n(r.speed), playing: typeof r.playing === "boolean" ? r.playing : undefined,
    view: typeof r.view === "string" ? r.view.slice(0, 16) : undefined,
    open: typeof r.open === "string" ? r.open.slice(0, 32) : null,
  };
  if (ctx.from !== undefined && ctx.to !== undefined && (ctx.to <= ctx.from || ctx.to - ctx.from > 15 * DAY)) { delete ctx.from; delete ctx.to; }
  return ctx;
}

/* ---------------- voice routing ---------------- */

const ADDRESSED = /\b(world|week view|the week|this week|timeline|playhead|replay)\b|^(world|week)\b/;

/**
 * Should an always-on utterance go to the World HUD instead of Scoutbot? Yes
 * when it reads as a HUD move and either the HUD is open or the words name it.
 * Returns the page actions, or null to leave it to Scoutbot. Resolution itself
 * happens on the page (it holds the roster, lanes and playhead).
 */
export function worldVoiceActions(excerpt: string, options: { worldOpen: boolean }): Array<{ type: "navigate"; route: { view: "ops"; mode: "week" } } | { type: "world.command"; text: string; reason: string }> | null {
  const said = lastSentence(excerpt);
  const s = normalizeUtterance(said);
  if (!s) return null;
  const addressed = ADDRESSED.test(s);
  // a time phrase alone ("what did devon ship today") is talk, not a move: it needs a move word or to be short
  const timeMove = resolveTime(s, {}) && (/^(go|jump|take me|skip|show me|move|rewind|back|forward|scrub)\b/.test(s) || s.split(" ").length <= 4);
  const move = (phraseCommand(s) ? { verb: "command" as const, strong: true } : null) ?? keywordVerb(s) ?? (timeMove ? { verb: "goto" as const, strong: true } : null);
  if (!move) return null;
  if (!options.worldOpen && !addressed) return null;
  const command = { type: "world.command" as const, text: said, reason: "voice" };
  return options.worldOpen ? [command] : [{ type: "navigate", route: { view: "ops", mode: "week" } }, command];
}
