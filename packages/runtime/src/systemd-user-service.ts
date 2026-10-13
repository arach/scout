// linux-systemd-user service adapter: render, install and drive a systemd
// --user unit for the broker. The unit is named after the OpenScout instance
// (prod → scout.service, dev → scout-dev.service) and runs the broker with Bun
// from the installed package.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, isAbsolute } from "node:path";

import type { RuntimeEnv } from "./portable-types.js";
import {
  deriveOpenScoutInstanceLayout,
  findOpenScoutCheckout,
  OPENSCOUT_PROD_INSTANCE,
  resolveOpenScoutInstanceName,
} from "./instance.js";

export type SystemdUserUnitSpec = {
  unitName: string;
  instance: string;
  description: string;
  /** Absolute ExecStart argv. */
  execStart: string[];
  /** PATH for the unit, in order. */
  path: string[];
  /** Extra Environment= assignments (besides PATH), in order. */
  environment: Array<[string, string]>;
  /** Operator-added Environment= lines kept verbatim from an existing unit. */
  operatorEnvironmentLines?: string[];
};

export type SystemdUserUnitInputs = {
  env?: RuntimeEnv;
  home?: string;
  /** Directory of the runtime package that should run the broker. */
  runtimePackageDir: string;
  /** Bun executable used when no global `openscout-runtime` shim owns the package. */
  bunExecutable: string | null;
  /** `bun pm bin -g`; resolved when omitted. */
  bunGlobalBinDirectory?: string | null;
};

/** Env forwarded into a unit so a non-prod instance (or explicit override) survives restarts. */
const FORWARDED_UNIT_ENV_KEYS = [
  "OPENSCOUT_INSTANCE_ROOT",
  "OPENSCOUT_INSTANCE_PORT_BASE",
  "OPENSCOUT_INSTANCE_MESH",
] as const;

export function systemdUserUnitDirectory(env: RuntimeEnv = process.env, home = homedir()): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(configHome, "systemd", "user");
}

export function resolveSystemdUserUnitName(env: RuntimeEnv = process.env): string {
  const explicit = env.OPENSCOUT_SYSTEMD_UNIT?.trim();
  if (explicit) return explicit.endsWith(".service") ? explicit : `${explicit}.service`;
  return deriveOpenScoutInstanceLayout({ env }).systemdUnitName;
}

/**
 * Bun's global bin directory (where `bun add -g` links `scout` and
 * `openscout-runtime`). BUN_INSTALL wins; then `bun pm bin -g`, which is
 * ~/.cache/.bun/bin when Bun comes from mise; then ~/.bun/bin.
 */
export function resolveBunGlobalBinDirectory(
  env: RuntimeEnv = process.env,
  home = homedir(),
  bunExecutable: string | null = null,
): string {
  const bunInstall = env.BUN_INSTALL?.trim();
  if (bunInstall) return join(bunInstall, "bin");
  const bun = bunExecutable ?? "bun";
  try {
    const result = spawnSync(bun, ["pm", "bin", "-g"], {
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const line = result.status === 0 ? result.stdout?.trim().split("\n").pop()?.trim() : "";
    if (line && isAbsolute(line)) return line;
  } catch {
    // fall through to the static guesses
  }
  const miseCache = join(home, ".cache", ".bun", "bin");
  if (bunExecutable?.includes("/mise/") && existsSync(miseCache)) return miseCache;
  return join(home, ".bun", "bin");
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * The global `openscout-runtime` shim when it belongs to `runtimePackageDir`
 * (the installed package), else null.
 */
function installedRuntimeShim(bunGlobalBin: string, runtimePackageDir: string): string | null {
  const shim = join(bunGlobalBin, "openscout-runtime");
  if (!existsSync(shim)) return null;
  const target = realpathOrSelf(shim);
  return isPathInside(target, realpathOrSelf(runtimePackageDir)) ? shim : null;
}

export function buildSystemdUserUnitSpec(inputs: SystemdUserUnitInputs): SystemdUserUnitSpec {
  const env = inputs.env ?? process.env;
  const home = inputs.home ?? homedir();
  const layout = deriveOpenScoutInstanceLayout({ env, home });
  const instance = resolveOpenScoutInstanceName(env);
  const bunGlobalBin = inputs.bunGlobalBinDirectory
    ?? resolveBunGlobalBinDirectory(env, home, inputs.bunExecutable);

  const path: string[] = [bunGlobalBin];
  if (inputs.bunExecutable) {
    const bunDir = dirname(inputs.bunExecutable);
    // mise installs resolve through its shims directory; keep that stable path
    // rather than a versioned install directory.
    if (inputs.bunExecutable.includes("/mise/")) {
      path.push(join(home, ".local", "share", "mise", "shims"));
    } else if (bunDir !== bunGlobalBin) {
      path.push(bunDir);
    }
  }
  path.push(join(home, ".local", "bin"), "/usr/local/bin", "/usr/bin");

  const shim = installedRuntimeShim(bunGlobalBin, inputs.runtimePackageDir);
  let execStart: string[];
  if (shim) {
    execStart = [shim, "broker"];
  } else {
    if (!inputs.bunExecutable) {
      throw new Error("Unable to locate Bun for the systemd user unit. Install Bun or set OPENSCOUT_BUN_BIN.");
    }
    execStart = [inputs.bunExecutable, join(inputs.runtimePackageDir, "bin", "openscout-runtime.mjs"), "broker"];
  }

  // Pin the instance in the unit. A broker started from a source checkout
  // with OPENSCOUT_INSTANCE unset takes the checkout default (`dev` /
  // `dev-<worktree>`), so a prod unit that runs checkout code must say
  // `prod` explicitly. The one exception is prod running the installed
  // package's shim: published packages never take a checkout default, and
  // leaving the line out keeps adopting the hand-written scout.service a no-op.
  // Resolve symlinks first: a link into a checkout runs checkout code.
  const runsInstalledPackage = shim !== null
    && findOpenScoutCheckout(realpathOrSelf(inputs.runtimePackageDir)) === null
    && findOpenScoutCheckout(dirname(realpathOrSelf(shim))) === null;
  const environment: Array<[string, string]> = [];
  if (instance !== OPENSCOUT_PROD_INSTANCE || !runsInstalledPackage) {
    environment.push(["OPENSCOUT_INSTANCE", instance]);
  }
  for (const key of FORWARDED_UNIT_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) environment.push([key, value]);
  }

  const description = instance === OPENSCOUT_PROD_INSTANCE
    ? (shim ? "Scout broker (installed @openscout/scout)" : `Scout broker (${inputs.runtimePackageDir})`)
    : `Scout broker (${instance} instance, ${layout.root})`;

  return {
    unitName: resolveSystemdUserUnitName(env),
    instance,
    description,
    execStart,
    path: [...new Set(path)],
    environment,
  };
}

/**
 * Prefer `%h/...` for paths under home so the unit reads like a hand-written
 * one. Literal `%` is escaped first (`%%`): systemd expands specifiers in
 * both Environment= and ExecStart=.
 */
function unitPath(value: string, home: string): string {
  if (value === home) return "%h";
  if (value.startsWith(`${home}/`)) return `%h/${escapeSpecifiers(value.slice(home.length + 1))}`;
  return escapeSpecifiers(value);
}

function escapeSpecifiers(value: string): string {
  return value.replaceAll("%", "%%");
}

/** Quote per systemd.syntax: double quotes, with `\` and `"` backslash-escaped. */
function quoteUnitWord(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function needsUnitQuoting(value: string): boolean {
  return value === "" || /[\s"'\\;]/.test(value);
}

/**
 * One ExecStart argument. `%` is a specifier and `$` an env expansion in
 * ExecStart=, so literal ones are doubled; whitespace or quotes force quoting.
 * `value` must already have `%` handled (unitPath does).
 */
function quoteExecArg(value: string): string {
  const escaped = value.replaceAll("$", "$$$$");
  return needsUnitQuoting(escaped) ? quoteUnitWord(escaped) : escaped;
}

/** One `Environment=` assignment, quoted when the value needs it. */
function renderEnvironmentAssignment(key: string, value: string, specifiersEscaped = false): string {
  const rendered = specifiersEscaped ? value : escapeSpecifiers(value);
  const assignment = `${key}=${rendered}`;
  return needsUnitQuoting(rendered) ? `Environment=${quoteUnitWord(assignment)}` : `Environment=${assignment}`;
}

/** Env keys the adapter renders itself; any other Environment= assignment in an existing unit is the operator's. */
function managedUnitEnvKeys(): Set<string> {
  return new Set(["PATH", "OPENSCOUT_INSTANCE", ...FORWARDED_UNIT_ENV_KEYS]);
}

/** C-style escapes systemd decodes in quoted words: \\a\\b\\f\\n\\r\\t\\v\\\\\\"\\'\\s, \\xHH, \\nnn (octal), \\uXXXX. */
function decodeUnitEscape(text: string, index: number): [string, number] {
  const next = text[index + 1]!;
  const simple: Record<string, string> = {
    a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", s: " ",
    "\\": "\\", '"': '"', "'": "'",
  };
  if (next in simple) return [simple[next]!, 2];
  const hex = /^x([0-9a-fA-F]{2})/.exec(text.slice(index + 1));
  if (hex) return [String.fromCharCode(Number.parseInt(hex[1]!, 16)), 4];
  const octal = /^([0-7]{3})/.exec(text.slice(index + 1));
  if (octal) return [String.fromCharCode(Number.parseInt(octal[1]!, 8)), 4];
  const unicode = /^u([0-9a-fA-F]{4})/.exec(text.slice(index + 1));
  if (unicode) return [String.fromCharCode(Number.parseInt(unicode[1]!, 16)), 6];
  return [next, 2];
}

/**
 * Split an `Environment=` value into assignments per systemd.syntax: words
 * separated by whitespace, double- or single-quoted words with backslash
 * escapes. Returns null when the line does not parse.
 */
function splitUnitWords(text: string): string[] | null {
  const words: string[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
    if (index >= text.length) break;
    let word = "";
    while (index < text.length && !/\s/.test(text[index]!)) {
      const char = text[index]!;
      if (char === '"' || char === "'") {
        const quote = char;
        index += 1;
        let closed = false;
        while (index < text.length) {
          const inner = text[index]!;
          if (inner === "\\" && index + 1 < text.length) {
            const [decoded, length] = decodeUnitEscape(text, index);
            word += decoded;
            index += length;
            continue;
          }
          if (inner === quote) {
            closed = true;
            index += 1;
            break;
          }
          word += inner;
          index += 1;
        }
        if (!closed) return null;
        continue;
      }
      if (char === "\\" && index + 1 < text.length) {
        const [decoded, length] = decodeUnitEscape(text, index);
        word += decoded;
        index += length;
        continue;
      }
      word += char;
      index += 1;
    }
    words.push(word);
  }
  return words;
}

/**
 * Operator-added Environment= lines from an existing unit (for example
 * OPENSCOUT_ADVERTISE_SCOPE=mesh on prod, or `Environment="K=v w"`), kept
 * verbatim and in order so adopting or re-rendering a hand-tuned unit is a
 * no-op. A line mixing managed and operator keys keeps only the operator's
 * assignments, re-rendered.
 */
export function readOperatorUnitEnvironment(unitText: string): string[] {
  const managed = managedUnitEnvKeys();
  const lines: string[] = [];
  for (const rawLine of unitText.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("Environment=")) continue;
    const words = splitUnitWords(line.slice("Environment=".length));
    if (!words) {
      lines.push(line);
      continue;
    }
    const assignments = words
      .map((word) => {
        const eq = word.indexOf("=");
        return eq > 0 ? [word.slice(0, eq), word.slice(eq + 1)] as [string, string] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null);
    const operator = assignments.filter(([key]) => !managed.has(key));
    if (operator.length === 0) continue;
    if (operator.length === assignments.length) {
      lines.push(line);
      continue;
    }
    // Values were already unescaped by the tokenizer; `%` stays as written.
    for (const [key, value] of operator) {
      lines.push(renderEnvironmentAssignment(key, value, true));
    }
  }
  return lines;
}

/** Spec with the operator's extra Environment= lines from `existingUnitPath` appended. */
export function withOperatorUnitEnvironment(spec: SystemdUserUnitSpec, existingUnitPath: string): SystemdUserUnitSpec {
  if (!existsSync(existingUnitPath)) return spec;
  let existing: string;
  try {
    existing = readFileSync(existingUnitPath, "utf8");
  } catch {
    return spec;
  }
  const extra = readOperatorUnitEnvironment(existing);
  return extra.length > 0 ? { ...spec, operatorEnvironmentLines: extra } : spec;
}

export function renderSystemdUserUnit(spec: SystemdUserUnitSpec, home = homedir()): string {
  const lines = [
    "[Unit]",
    `Description=${escapeSpecifiers(spec.description)}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    renderEnvironmentAssignment("PATH", spec.path.map((entry) => unitPath(entry, home)).join(":"), true),
    ...spec.environment.map(([key, value]) => renderEnvironmentAssignment(key, value)),
    ...(spec.operatorEnvironmentLines ?? []),
    `ExecStart=${spec.execStart.map((arg) => quoteExecArg(unitPath(arg, home))).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ];
  return lines.join("\n");
}

export type SystemctlResult = { status: number | null; stdout: string; stderr: string };
export type SystemctlRunner = (args: string[]) => SystemctlResult;

export const runSystemctlUser: SystemctlRunner = (args) => {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return { status: null, stdout: "", stderr: result.error.message };
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

function execStartLine(unitText: string): string | null {
  const line = unitText.split("\n").find((entry) => entry.startsWith("ExecStart="));
  return line ? line.slice("ExecStart=".length).trim() : null;
}

export type SystemdUnitWriteOutcome = "unchanged" | "written";

/**
 * Write the unit when it differs. An existing unit that runs a different
 * broker (another install or checkout) is never repointed silently: the
 * machine-wide service needs one stable owner.
 */
export function writeSystemdUserUnit(
  unitPath: string,
  contents: string,
  env: RuntimeEnv = process.env,
): SystemdUnitWriteOutcome {
  if (existsSync(unitPath)) {
    const existing = readFileSync(unitPath, "utf8");
    if (existing === contents) return "unchanged";
    assertSystemdUnitOwnership(unitPath, contents, env, "repoint");
  }
  mkdirSync(dirname(unitPath), { recursive: true });
  const temp = `${unitPath}.${process.pid}.tmp`;
  writeFileSync(temp, contents, "utf8");
  renameSync(temp, unitPath);
  return "written";
}

/**
 * The machine-wide unit needs one stable owner: refuse to repoint, stop or
 * uninstall an existing unit whose ExecStart runs a different Scout runtime
 * (another install or checkout) than the one acting now, unless
 * OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT=1.
 */
export function assertSystemdUnitOwnership(
  unitPath: string,
  expectedContents: string,
  env: RuntimeEnv = process.env,
  action: "repoint" | "stop" | "uninstall" = "repoint",
): void {
  if (!existsSync(unitPath)) return;
  const existingExec = execStartLine(readFileSync(unitPath, "utf8"));
  const nextExec = execStartLine(expectedContents);
  const allowRepoint = ["1", "true", "yes", "on"].includes(
    (env.OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT ?? "").trim().toLowerCase(),
  );
  if (!existingExec || !nextExec || existingExec === nextExec || allowRepoint) return;
  const verb = action === "repoint" ? `repoint ${basename(unitPath)} from \`${existingExec}\` to \`${nextExec}\``
    : `${action} ${basename(unitPath)}: it runs \`${existingExec}\`, not this runtime (\`${nextExec}\`)`;
  throw new Error(
    `Refusing to ${verb}. The machine-wide service must have one stable owner. Run a checkout or worktree as its `
      + "own instance (OPENSCOUT_INSTANCE=dev → scout-dev.service). For an intentional one-time ownership "
      + "transfer, rerun with OPENSCOUT_ALLOW_SHARED_SERVICE_REPOINT=1.",
  );
}

// Per runner (tests inject their own), and only "lingering is on" is cached:
// a warning is re-checked on every status, so enabling linger clears it at once.
const lingerOkCache = new WeakMap<object, Map<string, number>>();
const LINGER_CACHE_MS = 5 * 60_000;

/** Lingering keeps the user manager (and the unit) running after logout. */
export function systemdUserLingerWarning(
  run: (args: string[]) => SystemctlResult = runLoginctl,
  env: RuntimeEnv = process.env,
): string | null {
  const user = env.USER?.trim() || env.LOGNAME?.trim();
  if (!user) return null;
  let cache = lingerOkCache.get(run);
  if (!cache) {
    cache = new Map();
    lingerOkCache.set(run, cache);
  }
  const okAt = cache.get(user);
  if (okAt !== undefined && Date.now() - okAt < LINGER_CACHE_MS) return null;
  const result = run(["show-user", user, "--property=Linger"]);
  if (result.status === 0 && /^Linger=no$/m.test(result.stdout)) {
    cache.delete(user);
    return `Lingering is off for ${user}: the broker unit stops when you log out. Enable it with \`loginctl enable-linger ${user}\`.`;
  }
  cache.set(user, Date.now());
  return null;
}

const runLoginctl = (args: string[]): SystemctlResult => {
  const result = spawnSync("loginctl", args, { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { status: null, stdout: "", stderr: result.error.message };
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

export function removeSystemdUserUnit(unitPath: string): boolean {
  if (!existsSync(unitPath)) return false;
  rmSync(unitPath, { force: true });
  return true;
}

export type SystemdUnitState = {
  loadState: string | null;
  activeState: string | null;
  subState: string | null;
  unitFileState: string | null;
  mainPid: number | null;
  execMainStatus: number | null;
};

export function readSystemdUserUnitState(unitName: string, run: SystemctlRunner = runSystemctlUser): SystemdUnitState {
  const result = run([
    "show",
    unitName,
    "--property=LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus",
  ]);
  const values = new Map<string, string>();
  for (const line of result.stdout.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) values.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  const number = (key: string): number | null => {
    const parsed = Number.parseInt(values.get(key) ?? "", 10);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const text = (key: string): string | null => values.get(key) || null;
  const mainPid = number("MainPID");
  return {
    loadState: text("LoadState"),
    activeState: text("ActiveState"),
    subState: text("SubState"),
    unitFileState: text("UnitFileState"),
    mainPid: mainPid && mainPid > 0 ? mainPid : null,
    execMainStatus: number("ExecMainStatus"),
  };
}

export function assertSystemctlOk(result: SystemctlResult, action: string): void {
  if (result.status === 0) return;
  const detail = (result.stderr || result.stdout).trim() || `exit ${result.status ?? "unknown"}`;
  throw new Error(`systemctl --user ${action} failed: ${detail}`);
}
