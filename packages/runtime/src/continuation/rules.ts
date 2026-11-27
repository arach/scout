/**
 * Permission rules in Claude Code's `Tool(pattern)` syntax, so a rule copies
 * straight between `continuation-policy.json` and `~/.claude/settings.json`.
 *
 *   "permissions": {
 *     "allow": ["Bash(bun test:*)", "Read(~/dev/app/**)", "mcp__scout__ask"],
 *     "ask":   ["Bash(git push:*)"],
 *     "deny":  ["Bash(rm -rf:*)", "Read(//**\/.env)"],
 *     "defaultMode": "default"
 *   }
 *
 * Precedence: deny, then ask, then allow, then the mode. A project grant may
 * carry its own lists; they join the file's lists for calls inside it.
 *
 * Without an explicit list in the file, the built-in defaults apply. Their
 * deny and ask rules only tighten. Their allow rules only name what the
 * `auto` mode's risk classes already pass: they never allow by themselves.
 */

import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export const PERMISSION_LISTS = ["deny", "ask", "allow"] as const;
export type PermissionList = (typeof PERMISSION_LISTS)[number];

/** `default` asks for anything no rule covers. `auto` lets the risk classes decide. */
export type PermissionMode = "default" | "auto";

export type PermissionRuleSet = { allow: string[]; ask: string[]; deny: string[] };

/** The lists one scope contributes, and whether its allow rules are the built-in labels. */
export type PermissionRuleScope = {
  /** `policy` for the file's top level, `project:<path>` for a grant. */
  scope: string;
  rules: PermissionRuleSet;
  /** Lists taken from the built-in defaults because the file names none. */
  builtin: Partial<Record<PermissionList, boolean>>;
};

export type PermissionRuleMatch = {
  list: PermissionList;
  rule: string;
  scope: string;
  /** A built-in allow rule: a label for an `auto` judgement, never an allow by itself. */
  builtin: boolean;
};

/** One tool call, in the harness-neutral shape the rules read. */
export type PermissionCall = {
  /** Claude Code's tool name: Bash, Read, Edit, Write, WebFetch, mcp__server__tool, … */
  tool: string;
  command?: string | null;
  path?: string | null;
  url?: string | null;
  /** The directory relative rules and paths resolve against. */
  root: string;
};

/**
 * The defaults, from the permission watcher's study. Deny and ask apply
 * everywhere. Allow names the build, test and read families the `auto` mode
 * already passes inside a grant.
 */
export const DEFAULT_PERMISSION_RULES: Readonly<PermissionRuleSet> = Object.freeze({
  deny: [
    "Bash(rm -rf:*)",
    "Bash(rm -fr:*)",
    "Bash(git reset --hard:*)",
    "Bash(git push --force:*)",
    "Bash(git push * --force*)",
    "Bash(sudo:*)",
    "Read(//**/.env)",
    "Read(//**/.env.*)",
  ],
  ask: [
    "Bash(git push:*)",
    "Bash(gh pr create:*)",
    "Bash(gh pr merge:*)",
    "Bash(gh workflow run:*)",
    "Bash(gh run rerun:*)",
    "Bash(curl:*)",
  ],
  allow: [
    "Bash(bun test:*)",
    "Bash(bun run *build)",
    "Bash(bun run *test)",
    "Bash(bun run test:*)",
    "Bash(bun run *check)",
    "Bash(bun next build)",
    "Bash(bun --cwd * next build)",
    "Bash(bunx tsc:*)",
    "Bash(npm test:*)",
    "Bash(cargo test:*)",
    "Bash(cargo build:*)",
    "Bash(swift build:*)",
    "Bash(swift test:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(gh pr view:*)",
    "Bash(gh pr diff:*)",
    "Bash(gh pr checks:*)",
    "Bash(gh pr list:*)",
    "Bash(gh run view:*)",
    "Bash(gh run list:*)",
    "Read",
    "Edit",
    "Write",
  ],
});

const RULE = /^([A-Za-z][\w-]*(?:__\*)?)(?:\(([^\n]*)\))?$/;
const MAX_RULE_CHARS = 500;
const MAX_RULES_PER_LIST = 500;

export type ParsedPermissionRule = { tool: string; pattern: string | null };

/** Parses one rule. Anything malformed is null and never matches. */
export function parsePermissionRule(raw: unknown): ParsedPermissionRule | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_RULE_CHARS) return null;
  const match = RULE.exec(value);
  if (!match) return null;
  const pattern = match[2];
  if (pattern !== undefined && !pattern.trim()) return null;
  return { tool: match[1]!, pattern: pattern === undefined || pattern.trim() === "*" ? null : pattern.trim() };
}

/** Keeps the well-formed rules of a list, in order, without duplicates. */
export function parsePermissionRuleList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rules: string[] = [];
  for (const entry of raw.slice(0, MAX_RULES_PER_LIST)) {
    if (!parsePermissionRule(entry)) continue;
    const value = (entry as string).trim();
    if (!rules.includes(value)) rules.push(value);
  }
  return rules;
}

export function normalizePermissionMode(raw: unknown): PermissionMode | undefined {
  if (raw === "default" || raw === "auto") return raw;
  return undefined;
}

/** Maps a harness's tool name to Claude Code's, which the rules use. */
export function permissionToolName(toolName: string): string {
  const value = toolName.trim();
  switch (value.toLowerCase()) {
    case "bash":
    case "run_command":
    case "shell_exec":
    case "shell":
      return "Bash";
    case "read":
    case "read_file":
    case "view_file":
    case "grep":
    case "glob":
      return "Read";
    case "edit":
    case "edit_file":
    case "multiedit":
    case "notebookedit":
      return "Edit";
    case "write":
    case "write_file":
      return "Write";
    case "webfetch":
      return "WebFetch";
    default:
      return value;
  }
}

/** True when the rule covers the call. */
export function permissionRuleMatches(rule: string, call: PermissionCall): boolean {
  const parsed = parsePermissionRule(rule);
  if (!parsed) return false;
  const tool = call.tool;
  if (parsed.tool.startsWith("mcp__")) return parsed.pattern === null && mcpMatches(parsed.tool, tool);
  // Edit rules cover every tool that edits a file, as in Claude Code.
  const toolMatches = parsed.tool === tool || (parsed.tool === "Edit" && tool === "Write");
  if (!toolMatches) return false;
  if (parsed.pattern === null) return true;
  switch (parsed.tool) {
    case "Bash":
      return typeof call.command === "string" && bashMatches(parsed.pattern, call.command);
    case "Read":
    case "Edit":
    case "Write":
      return typeof call.path === "string" && pathMatches(parsed.pattern, call.path, call.root);
    case "WebFetch":
      return typeof call.url === "string" && domainMatches(parsed.pattern, call.url);
    default:
      return false;
  }
}

/**
 * The rule that decides a call: any deny, then any ask, then any allow,
 * across every scope. Null means the mode decides.
 */
export function matchPermissionRules(
  scopes: readonly PermissionRuleScope[],
  call: PermissionCall,
): PermissionRuleMatch | null {
  for (const list of PERMISSION_LISTS) {
    for (const scope of scopes) {
      for (const rule of scope.rules[list]) {
        // An allow rule never reads a command it cannot split safely.
        if (list === "allow" && call.tool === "Bash" && unsplittable(call.command)) continue;
        const subjects = list === "allow" ? [call] : bashSegments(call);
        if (subjects.some((subject) => permissionRuleMatches(rule, subject))) {
          return { list, rule, scope: scope.scope, builtin: list === "allow" && scope.builtin.allow === true };
        }
      }
    }
  }
  return null;
}

/**
 * The lists for one scope: each list the file names, or the default for a
 * list it leaves out. Built-in allow labels apply only where the mode is auto.
 */
export function permissionScope(
  scope: string,
  explicit: Partial<PermissionRuleSet> | undefined,
  inherit: { deny: boolean; ask: boolean; allow: boolean },
): PermissionRuleScope {
  const rules: PermissionRuleSet = { allow: [], ask: [], deny: [] };
  const builtin: Partial<Record<PermissionList, boolean>> = {};
  for (const list of PERMISSION_LISTS) {
    const named = explicit?.[list];
    if (named) rules[list] = [...named];
    else if (inherit[list]) {
      rules[list] = [...DEFAULT_PERMISSION_RULES[list]];
      builtin[list] = true;
    }
  }
  return { scope, rules, builtin };
}

/* ── matching ──────────────────────────────────────────────────────────── */

function mcpMatches(ruleTool: string, tool: string): boolean {
  if (ruleTool === tool) return true;
  // `mcp__server` covers every tool of that server; `mcp__server__*` as well.
  const server = ruleTool.endsWith("__*") ? ruleTool.slice(0, -3) : ruleTool;
  return server.split("__").length === 2 && tool.startsWith(`${server}__`);
}

/** Shell operators that run a second command. Deny and ask read every part. */
const COMMAND_SEPARATOR = /&&|\|\||[;|&\n]|\$\(|[()`]/;
const UNSPLITTABLE = /[;&|<>`\n\\$"'#*?{}[\]!]/;

function unsplittable(command: string | null | undefined): boolean {
  return typeof command !== "string" || UNSPLITTABLE.test(command);
}

function bashSegments(call: PermissionCall): PermissionCall[] {
  if (call.tool !== "Bash" || typeof call.command !== "string") return [call];
  const parts = call.command.split(COMMAND_SEPARATOR).map((part) => stripLeadingAssignments(part.trim())).filter(Boolean);
  return [call, ...parts.map((command) => ({ ...call, command }))];
}

/** `FOO=1 BAR=2 cmd` runs `cmd`. */
function stripLeadingAssignments(command: string): string {
  return command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
}

function bashMatches(pattern: string, rawCommand: string): boolean {
  const command = rawCommand.trim().replace(/\s+/g, " ");
  const home = homedir();
  const forms = new Set([command, command.split(`${home}/`).join("~/")]);
  const legacy = pattern.endsWith(":*") ? pattern.slice(0, -2).trim() : null;
  for (const text of forms) {
    if (legacy !== null) {
      if (text === legacy || text.startsWith(`${legacy} `)) return true;
      continue;
    }
    // `cmd *` also covers a bare `cmd`, as `cmd:*` does.
    if (pattern.endsWith(" *") && text === pattern.slice(0, -2).trim()) return true;
    if (globRegExp(pattern.replace(/\s+/g, " "), false).test(text)) return true;
  }
  return false;
}

/**
 * Claude Code's path forms: `~/p` is under the home folder, `//p` is the
 * absolute `/p`, `/p` and `p` are under the scope's root. A pattern with no
 * slash matches that name at any depth, as in gitignore.
 */
function pathMatches(pattern: string, rawPath: string, root: string): boolean {
  const home = homedir();
  const target = resolve(rawPath.startsWith("~/") ? `${home}${rawPath.slice(1)}` : isAbsolute(rawPath) ? rawPath : resolve(root, rawPath));
  let absolute: string;
  if (pattern.startsWith("~/")) absolute = `${home}/${pattern.slice(2)}`;
  else if (pattern.startsWith("//")) absolute = pattern.slice(1);
  else if (pattern.startsWith("/")) absolute = `${resolve(root)}${pattern}`;
  else if (!pattern.replace(/\/$/, "").includes("/")) absolute = `${resolve(root)}/**/${pattern}`;
  else absolute = `${resolve(root)}/${pattern.replace(/^\.\//, "")}`;
  if (absolute.endsWith("/")) absolute = `${absolute}**`;
  return globRegExp(absolute, true).test(target);
}

function domainMatches(pattern: string, url: string): boolean {
  if (!pattern.startsWith("domain:")) return false;
  const want = pattern.slice("domain:".length).trim().toLowerCase();
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === want || host.endsWith(`.${want}`);
  } catch {
    return false;
  }
}

/** `*` is any text (in a path, within one segment); `**` crosses segments; `?` is one character in a path. */
function globRegExp(pattern: string, path: boolean): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*") {
      if (path && pattern[index + 1] === "*") {
        index++;
        if (pattern[index + 1] === "/") {
          index++;
          source += "(?:.*/)?";
        } else source += ".*";
      } else source += path ? "[^/]*" : ".*";
    } else if (char === "?" && path) source += "[^/]";
    else source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}
