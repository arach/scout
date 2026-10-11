// The operator's SSH config, read as machines they already reach.
//
// The files only say which names exist: every concrete `Host` pattern is a
// name the operator can type after `ssh`. What a name reaches is OpenSSH's
// call, so each one is resolved with `ssh -G` (Match, conditional Include and
// token rules included) and names that land on the same user@host:port are
// one machine. When ssh -G can't be used — a `Match exec` would run the
// operator's commands on every scan, or the config isn't the real one — the
// values come from the files: first value wins across matching blocks, the
// way ssh reads them. Match blocks apply when their criteria can be read off
// the config (all, host, originalhost, user, localuser); exec and anything
// else counts as not matching.
//
// Git forges (`Host github.com`, `User git`) are services the config reaches,
// not machines, so they are reported separately and never enter the fleet.
//
// Reads files and runs `ssh -G`, which prints configuration and never
// connects.

import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

import type { SshMachineEvidence } from "@openscout/protocol";

export type SshConfigHost = Omit<SshMachineEvidence, "kind" | "observedAt">;

export type SshConfigService = {
  alias: string;
  hostName: string;
  user?: string;
  configPath: string;
};

export type SshConfigSnapshot = {
  hosts: SshConfigHost[];
  services: SshConfigService[];
  /** Files read, in order, including every Include that resolved. */
  files: string[];
};

/** Where one name lands. Absent fields are ssh's defaults. */
export type SshResolution = {
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
};

export type SshResolver = (name: string) => Promise<SshResolution | null>;

type Block = {
  patterns: string[];
  /** Lowercased keyword → value, first occurrence within the block. */
  values: Map<string, string>;
  file: string;
  /** Match criteria, as tokens; absent for Host blocks. */
  match?: string[];
};

type Candidate = { name: string; file: string };

type ReadState = {
  home: string;
  files: string[];
  blocks: Block[];
  candidates: Candidate[];
  hasMatchExec: boolean;
};

const MAX_INCLUDE_DEPTH = 16;
const KEYWORDS = new Set(["hostname", "user", "port", "identityfile", "proxyjump"]);
const GIT_FORGES = new Set([
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "ssh.dev.azure.com",
  "vs-ssh.visualstudio.com",
  "codeberg.org",
  "git.sr.ht",
]);

export function defaultSshConfigPath(home = homedir()): string {
  return join(home, ".ssh", "config");
}

/** Splits a config line into keyword and argument, honouring `Key=Value`. */
function splitLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/u.exec(trimmed);
  if (!match) return null;
  return [match[1]!.toLowerCase(), match[2]!.trim()];
}

/** Arguments, with double-quoted ones kept whole. */
function splitArgs(value: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/gu;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    args.push(match[1] ?? match[2]!);
  }
  return args;
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

function collapseHome(path: string, home: string): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** Glob match for ssh patterns: `*` and `?` only. */
function patternMatches(pattern: string, host: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*").replace(/\?/gu, ".");
  return new RegExp(`^${source}$`, "iu").test(host);
}

/** ssh's Host matching: any positive pattern matches and no negated one does. */
function blockMatches(block: Block, host: string): boolean {
  let matched = false;
  for (const pattern of block.patterns) {
    if (pattern.startsWith("!")) {
      if (patternMatches(pattern.slice(1), host)) return false;
    } else if (patternMatches(pattern, host)) {
      matched = true;
    }
  }
  return matched;
}

function isConcrete(pattern: string): boolean {
  return !/[*?!]/u.test(pattern);
}

/** A block that applies to every host: the preamble, or `Host *`. */
function appliesToAll(block: Block | null): boolean {
  if (block === null) return false;
  if (block.match) return block.match.length === 1 && block.match[0]!.toLowerCase() === "all";
  return block.patterns.length === 0 || block.patterns.every((pattern) => pattern === "*");
}

/** Include arguments may be globs in any path component, relative to ~/.ssh. */
async function resolveInclude(argument: string, home: string): Promise<string[]> {
  const expanded = expandHome(argument, home);
  const path = isAbsolute(expanded) ? expanded : join(home, ".ssh", expanded);
  if (!/[*?]/u.test(path)) return [path];
  let matches: string[] = [sep];
  for (const part of path.split(sep).filter(Boolean)) {
    const next: string[] = [];
    for (const directory of matches) {
      if (!/[*?]/u.test(part)) {
        next.push(join(directory, part));
        continue;
      }
      const entries = await readdir(directory).catch(() => [] as string[]);
      for (const entry of entries.filter((name) => patternMatches(part, name)).sort()) next.push(join(directory, entry));
    }
    matches = next;
  }
  return matches;
}

async function readBlocks(
  file: string,
  state: ReadState,
  // Files on the current Include chain: a cycle, not a repeat, stops reading.
  chain: readonly string[],
  // Lines before the first Host apply to every host, like `Host *`.
  current: { block: Block | null },
  // Inside an Include that only some hosts reach, names aren't candidates.
  conditional: boolean,
): Promise<void> {
  if (chain.length > MAX_INCLUDE_DEPTH || chain.includes(file)) return;
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return;
  if (!state.files.includes(file)) state.files.push(file);

  for (const line of text.split(/\r?\n/u)) {
    const parsed = splitLine(line);
    if (!parsed) continue;
    const [keyword, value] = parsed;
    if (keyword === "host") {
      current.block = { patterns: splitArgs(value), values: new Map(), file };
      state.blocks.push(current.block);
      if (!conditional) {
        for (const name of current.block.patterns.filter(isConcrete)) state.candidates.push({ name, file });
      }
    } else if (keyword === "match") {
      const criteria = splitArgs(value).flatMap((arg) => arg.split(/=(.*)/su, 2).filter(Boolean));
      if (criteria.some((arg) => /^!?exec$/iu.test(arg))) state.hasMatchExec = true;
      current.block = { patterns: [], values: new Map(), file, match: criteria };
      state.blocks.push(current.block);
    } else if (keyword === "include") {
      const scoped = conditional || !appliesToAll(current.block);
      for (const argument of splitArgs(value)) {
        for (const included of await resolveInclude(argument, state.home)) {
          await readBlocks(included, state, [...chain, file], current, scoped);
        }
      }
    } else if (KEYWORDS.has(keyword) && current.block && !current.block.values.has(keyword)) {
      current.block.values.set(keyword, splitArgs(value)[0] ?? value);
    }
  }
}

/** ssh's pattern lists: comma-separated, `!` negates, any positive match wins. */
function listMatches(list: string, value: string): boolean {
  return blockMatches({ patterns: list.split(","), values: new Map(), file: "" }, value);
}

/**
 * Match criteria read off the config. `null` when one can't be (exec,
 * canonical, localnetwork, …): such a block is treated as not matching.
 */
function matchApplies(criteria: readonly string[], context: { name: string; hostName: string; user: string }): boolean | null {
  for (let index = 0; index < criteria.length; index++) {
    const raw = criteria[index]!;
    const negated = raw.startsWith("!");
    const keyword = (negated ? raw.slice(1) : raw).toLowerCase();
    if (keyword === "all") continue;
    const argument = criteria[++index];
    if (argument === undefined) return null;
    let matched: boolean;
    if (keyword === "host") matched = listMatches(argument, context.hostName);
    else if (keyword === "originalhost") matched = listMatches(argument, context.name);
    else if (keyword === "user") matched = listMatches(argument, context.user);
    else if (keyword === "localuser") matched = listMatches(argument, userInfo().username);
    else return null;
    if (matched === negated) return false;
  }
  return true;
}

/** What the files give `name`, first value winning, in file order. */
function fileValues(blocks: readonly Block[], name: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const block of blocks) {
    if (block.match) {
      const hostName = values.get("hostname");
      const context = {
        name,
        hostName: hostName ? expandTokens(hostName, name, name) : name,
        user: values.get("user") ?? userInfo().username,
      };
      if (matchApplies(block.match, context) !== true) continue;
    } else if (block.patterns.length > 0 && !blockMatches(block, name)) {
      continue;
    }
    for (const [keyword, value] of block.values) if (!values.has(keyword)) values.set(keyword, value);
  }
  return values;
}

/** `%h`, `%n` and `%%` — the tokens HostName and IdentityFile commonly use. */
function expandTokens(value: string, alias: string, hostName: string): string {
  return value.replace(/%([%hn])/gu, (_token, code: string) => (code === "%" ? "%" : code === "h" ? hostName : alias));
}

function fileResolver(blocks: readonly Block[]): SshResolver {
  return async (name) => {
    const values = fileValues(blocks, name);
    const rawHostName = values.get("hostname");
    const hostName = rawHostName ? expandTokens(rawHostName, name, name) : name;
    const user = values.get("user");
    const port = Number.parseInt(values.get("port") ?? "", 10);
    const identityFile = values.get("identityfile");
    const proxyJump = values.get("proxyjump");
    return {
      hostName,
      ...(user ? { user } : {}),
      ...(Number.isInteger(port) && port > 0 ? { port } : {}),
      ...(identityFile ? { identityFile: expandTokens(identityFile, name, hostName) } : {}),
      ...(proxyJump ? { proxyJump } : {}),
    };
  };
}

function sshG(args: readonly string[]): Promise<Map<string, string[]> | null> {
  return new Promise((done) => {
    execFile("ssh", ["-G", ...args], { timeout: 3_000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) return done(null);
      const values = new Map<string, string[]>();
      for (const line of stdout.split("\n")) {
        const at = line.indexOf(" ");
        if (at <= 0) continue;
        const key = line.slice(0, at).toLowerCase();
        values.set(key, [...(values.get(key) ?? []), line.slice(at + 1).trim()]);
      }
      done(values);
    });
  });
}

/**
 * OpenSSH's own answer for each name. Values ssh would use anyway — the
 * local user, port 22, the default key files — are left out, so a machine
 * only carries what its config says.
 */
export function sshGResolver(configPath: string, home = homedir()): SshResolver {
  let defaults: Promise<Map<string, string[]> | null> | null = null;
  return async (name) => {
    defaults ??= sshG(["-F", "/dev/null", "scout-defaults.invalid"]);
    const [values, base] = await Promise.all([sshG(["-F", configPath, "--", name]), defaults]);
    const hostName = values?.get("hostname")?.[0];
    if (!values || !hostName) return null;
    const user = values.get("user")?.[0];
    const port = Number.parseInt(values.get("port")?.[0] ?? "", 10);
    const defaultKeys = new Set(base?.get("identityfile") ?? []);
    const identityFile = values.get("identityfile")?.find((key) => !defaultKeys.has(key));
    const proxyJump = values.get("proxyjump")?.[0];
    return {
      hostName,
      ...(user && user !== base?.get("user")?.[0] ? { user } : {}),
      ...(Number.isInteger(port) && port > 0 ? { port } : {}),
      ...(identityFile ? { identityFile: collapseHome(expandHome(identityFile, home), home) } : {}),
      ...(proxyJump ? { proxyJump } : {}),
    };
  };
}

function isService(hostName: string, user: string | undefined): boolean {
  return user === "git" || GIT_FORGES.has(hostName.toLowerCase());
}

export async function readSshConfig(
  options: {
    path?: string;
    home?: string;
    /** How names resolve; defaults to ssh -G for the real config, the files otherwise. */
    resolver?: SshResolver;
  } = {},
): Promise<SshConfigSnapshot> {
  const home = options.home ?? homedir();
  const root = resolve(options.path ?? defaultSshConfigPath(home));
  const state: ReadState = { home, files: [], blocks: [], candidates: [], hasMatchExec: false };
  const preamble: Block = { patterns: [], values: new Map(), file: root };
  state.blocks.push(preamble);
  await readBlocks(root, state, [], { block: preamble }, false);

  const real = options.home === undefined && !state.hasMatchExec;
  const resolver = options.resolver ?? (real ? sshGResolver(root, home) : fileResolver(state.blocks));
  const seen = new Set<string>();
  const candidates = state.candidates.filter(({ name }) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const resolutions = await Promise.all(candidates.map(({ name }) => resolver(name)));

  const hosts: SshConfigHost[] = [];
  const services: SshConfigService[] = [];
  const byDestination = new Map<string, SshConfigHost>();
  candidates.forEach(({ name, file }, index) => {
    const resolution = resolutions[index];
    if (!resolution) return;
    const { hostName, user, identityFile, proxyJump } = resolution;
    const port = resolution.port && resolution.port !== 22 ? resolution.port : undefined;
    if (isService(hostName, user)) {
      services.push({ alias: name, hostName, ...(user ? { user } : {}), configPath: file });
      return;
    }
    // Names that land on one user@host:port are shorthand for one machine.
    const destination = `${user ?? ""}@${hostName.toLowerCase()}:${port ?? 22}`;
    const existing = byDestination.get(destination);
    if (existing) {
      existing.aliases.push(name);
      return;
    }
    const host: SshConfigHost = {
      alias: name,
      aliases: [name],
      hostName,
      ...(user ? { user } : {}),
      ...(port ? { port } : {}),
      ...(identityFile ? { identityFile } : {}),
      ...(proxyJump && proxyJump.toLowerCase() !== "none" ? { proxyJump } : {}),
      configPath: file,
    };
    byDestination.set(destination, host);
    hosts.push(host);
  });
  return { hosts, services, files: state.files };
}

export function sshConfigEvidence(snapshot: SshConfigSnapshot | null, observedAt: number): SshMachineEvidence[] {
  return (snapshot?.hosts ?? []).map((host) => ({ kind: "ssh", observedAt, ...host }));
}
