/* Glass's files, as the page sees them. The Mac app injects the contents of
   $OPENSCOUT_HOME/glass/config.json and glass/commands/*.md as
   window.__SCOUT_GLASS__ and re-sends them on every change. Everything here
   is pure so the contract (docs/agent/glass.agent.md) is testable. */

export type GlassInk = "scout" | "lacquer";

export type GlassCommand = {
  name: string;
  hint: string;
  /** Where `say` goes: "scoutbot", "here" (the open conversation) or an @agent handle. */
  to: string;
  /** A message template: {args}, {selection}, {conversation}. */
  say?: string;
  /** Or a command line to run instead, e.g. "go terminals". */
  run?: string;
  source: string;
};

export type GlassSettings = {
  ink: GlassInk;
  fontSize: number;
  start: string;
  aliases: Record<string, string>;
  commands: GlassCommand[];
  errors: string[];
  paths: { config: string; commands: string } | null;
};

export type BuiltinCommand = { verb: string; alias?: string[]; hint: string };

/** The starting set. Your own commands can't shadow these. */
export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { verb: "go", hint: "terminals · projects · chat · home · requests" },
  { verb: "buffer", alias: ["b", "e"], hint: "switch conversation by number or name" },
  { verb: "ls", hint: "list conversations" },
  { verb: "new", hint: "new conversation, @agent or Scoutbot" },
  { verb: "ask", hint: "@agent what to do" },
  { verb: "write", alias: ["w"], hint: "send the reply" },
  { verb: "set", hint: "tint=0.5 · material=liquid · ink=lacquer · chrome=strip" },
  { verb: "reload", hint: "re-read the glass files" },
  { verb: "quit", alias: ["q"], hint: "leave glass for the full app" },
  { verb: "help", alias: ["h"], hint: "list commands" },
];

const NAME = /^[a-z][a-z0-9-]*$/;

export function findBuiltin(verb: string): BuiltinCommand | undefined {
  return BUILTIN_COMMANDS.find((c) => c.verb === verb || c.alias?.includes(verb));
}

/** A commands/*.md file: optional `---` frontmatter (hint, to, run), body = the `say` template. */
export function parseCommandFile(name: string, text: string): GlassCommand | string {
  if (!NAME.test(name)) return `commands/${name}.md: names are lowercase letters, digits and dashes`;
  if (findBuiltin(name)) return `commands/${name}.md: :${name} is built in`;
  const meta: Record<string, string> = {};
  let body = text.replace(/\r\n/g, "\n");
  const front = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (front) {
    for (const line of front[1]!.split("\n")) {
      const at = line.indexOf(":");
      if (at > 0) meta[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
    }
    body = body.slice(front[0].length);
  }
  const say = body.trim();
  const run = meta.run?.trim();
  if (!say && !run) return `commands/${name}.md: needs a message body or run:`;
  return {
    name,
    hint: meta.hint || (run ? run : firstLine(say)),
    to: meta.to || "scoutbot",
    say: run ? undefined : say,
    run: run || undefined,
    source: `commands/${name}.md`,
  };
}

function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

type Payload = {
  config?: unknown;
  commands?: Array<{ name?: unknown; text?: unknown }>;
  error?: unknown;
  paths?: { config?: unknown; commands?: unknown };
};

export function readGlassSettings(payload: unknown): GlassSettings {
  const p = (payload && typeof payload === "object" ? payload : {}) as Payload;
  const config = (p.config && typeof p.config === "object" ? p.config : {}) as Record<string, unknown>;
  const errors: string[] = typeof p.error === "string" && p.error ? [p.error] : [];

  const font = (config.font && typeof config.font === "object" ? config.font : {}) as Record<string, unknown>;
  const size = typeof font.size === "number" && font.size >= 10 && font.size <= 22 ? font.size : 13;

  const aliases: Record<string, string> = {};
  if (config.aliases && typeof config.aliases === "object") {
    for (const [key, value] of Object.entries(config.aliases as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      if (findBuiltin(key)) { errors.push(`aliases.${key}: :${key} is built in`); continue; }
      aliases[key] = value;
    }
  }

  const commands: GlassCommand[] = [];
  const add = (parsed: GlassCommand | string) => {
    if (typeof parsed === "string") { errors.push(parsed); return; }
    if (commands.some((c) => c.name === parsed.name)) { errors.push(`${parsed.source}: :${parsed.name} is defined twice`); return; }
    commands.push(parsed);
  };
  for (const file of p.commands ?? []) {
    if (typeof file.name === "string" && typeof file.text === "string") add(parseCommandFile(file.name, file.text));
  }
  if (config.commands && typeof config.commands === "object") {
    for (const [name, raw] of Object.entries(config.commands as Record<string, unknown>)) {
      const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const front = [
        typeof c.hint === "string" ? `hint: ${c.hint}` : "",
        typeof c.to === "string" ? `to: ${c.to}` : "",
        typeof c.run === "string" ? `run: ${c.run}` : "",
      ].filter(Boolean).join("\n");
      const parsed = parseCommandFile(name, `---\n${front}\n---\n${typeof c.say === "string" ? c.say : ""}`);
      add(typeof parsed === "string" ? parsed.replace(`commands/${name}.md`, `config.json commands.${name}`) : { ...parsed, source: `config.json commands.${name}` });
    }
  }

  const paths = p.paths && typeof p.paths.config === "string" && typeof p.paths.commands === "string"
    ? { config: p.paths.config, commands: p.paths.commands }
    : null;

  return {
    ink: config.ink === "lacquer" ? "lacquer" : "scout",
    fontSize: size,
    start: typeof config.start === "string" && config.start.trim() ? config.start.trim() : "scoutbot",
    aliases,
    commands,
    errors,
    paths,
  };
}

export function expandTemplate(template: string, vars: { args: string; selection: string; conversation: string }): string {
  return template
    .replaceAll("{args}", vars.args)
    .replaceAll("{selection}", vars.selection)
    .replaceAll("{conversation}", vars.conversation)
    .trim();
}

/** `:set` values as config.json stores them: numbers stay numbers. */
export const SET_KEYS: Record<string, { path: string; parse: (raw: string) => string | number | null }> = {
  tint: { path: "window.tint", parse: (raw) => { const v = Number(raw); return raw !== "" && v >= 0 && v <= 0.95 ? v : null; } },
  material: { path: "window.material", parse: (raw) => (raw === "ghostty" || raw === "liquid" ? raw : null) },
  chrome: { path: "window.chrome", parse: (raw) => (raw === "gone" || raw === "strip" ? raw : null) },
  ink: { path: "ink", parse: (raw) => (raw === "scout" || raw === "lacquer" ? raw : null) },
  fontsize: { path: "font.size", parse: (raw) => { const v = Number(raw); return v >= 10 && v <= 22 ? v : null; } },
  start: { path: "start", parse: (raw) => raw || null },
};
