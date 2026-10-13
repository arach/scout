// Instance and port resolution for `bun run dev`, kept apart from dev.mjs's
// side effects so it can be tested.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Imported from source on purpose: dependency-free, erasable TypeScript that
// Node runs with type stripping, so a fresh checkout needs no runtime build.
import {
  applyCheckoutOpenScoutInstanceDefault,
  applyOpenScoutInstanceEnvironment,
} from "../../runtime/src/instance.ts";

export const DEFAULT_PORTS = {
  broker: 43110,
  web: 43120,
  vite: 43122,
  pairing: 43130,
};
export const WORKTREE_PORT_BASES = {
  web: 43200,
  vite: 43900,
  pairing: 44600,
};
const WORKTREE_PORT_RANGE = 700;

function safeGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

export function resolveGitContext(cwd) {
  const worktreeRoot = safeGit(["rev-parse", "--show-toplevel"], cwd);
  const commonGitDir = safeGit(["rev-parse", "--git-common-dir"], cwd);
  if (!worktreeRoot || !commonGitDir) {
    return null;
  }
  const commonRoot = resolve(cwd, commonGitDir, "..");
  return {
    worktreeRoot: resolve(worktreeRoot),
    commonRoot,
    isWorktree: resolve(worktreeRoot) !== commonRoot,
  };
}

function worktreeSlot(input) {
  return createHash("sha256").update(input).digest().readUInt16BE(0) % WORKTREE_PORT_RANGE;
}

export function resolvePortDefaults(packageDir) {
  const gitContext = resolveGitContext(packageDir);
  if (!gitContext) {
    return {
      gitContext: null,
      brokerPort: DEFAULT_PORTS.broker,
      webPort: DEFAULT_PORTS.web,
      vitePort: DEFAULT_PORTS.vite,
      pairingPort: DEFAULT_PORTS.pairing,
    };
  }

  if (!gitContext.isWorktree) {
    return {
      gitContext,
      brokerPort: DEFAULT_PORTS.broker,
      webPort: DEFAULT_PORTS.web,
      vitePort: DEFAULT_PORTS.vite,
      pairingPort: DEFAULT_PORTS.pairing,
    };
  }

  const slot = worktreeSlot(gitContext.worktreeRoot);
  return {
    gitContext,
    brokerPort: DEFAULT_PORTS.broker,
    webPort: WORKTREE_PORT_BASES.web + slot,
    vitePort: WORKTREE_PORT_BASES.vite + slot,
    pairingPort: WORKTREE_PORT_BASES.pairing + slot,
  };
}


function parsePort(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : null;
}

/**
 * Pick the instance `bun run dev` runs as and its ports. `env` is mutated
 * like a bootstrap (checkout default when OPENSCOUT_INSTANCE is unset, then
 * the instance materialized). Prod honours the operator's env as before; a
 * non-prod instance takes its broker/web/pairing ports from its layout and
 * ignores ambient ports and broker URLs. Returns `error` for flags that do
 * not apply to a non-prod instance.
 */
export function resolveDevInstanceSetup({ packageDirectory, flags = {}, env = process.env }) {
  const explicitEnv = { ...env };
  const checkoutInstanceDefault = applyCheckoutOpenScoutInstanceDefault(packageDirectory, env);
  const instance = applyOpenScoutInstanceEnvironment(env).layout;
  const portDefaults = instance.isProd
    ? resolvePortDefaults(packageDirectory)
    : {
      gitContext: resolveGitContext(packageDirectory),
      brokerPort: instance.ports.broker,
      webPort: instance.ports.web,
      vitePort: instance.ports.vite,
      pairingPort: instance.ports.pairingBridge,
    };
  if (!instance.isProd && (flags.port || flags.pairingPort)) {
    return {
      error: `@openscout/web: --port/--pairing-port do not apply to instance "${instance.name}"; `
        + "its ports come from its block. Use OPENSCOUT_INSTANCE_PORT_BASE or the instance's config.json ports.",
    };
  }
  const portEnv = instance.isProd ? explicitEnv : env;
  const brokerPort = parsePort(portEnv.OPENSCOUT_BROKER_PORT)
    ?? portDefaults.brokerPort
    ?? DEFAULT_PORTS.broker;
  const brokerUrl = (instance.isProd ? explicitEnv.OPENSCOUT_BROKER_URL?.trim() : "")
    || `http://127.0.0.1:${brokerPort}`;
  // A non-prod instance's web and pairing ports are fixed by its layout (the
  // services it starts re-derive them), so they are taken as given, not probed.
  const explicitWebPort = parsePort(flags.port)
    ?? parsePort(portEnv.OPENSCOUT_WEB_PORT)
    ?? (instance.isProd ? parsePort(explicitEnv.SCOUT_WEB_PORT) : null);
  const explicitPairingPort = parsePort(flags.pairingPort)
    ?? parsePort(portEnv.OPENSCOUT_PAIRING_PORT)
    ?? (instance.isProd ? parsePort(explicitEnv.SCOUT_PAIRING_PORT) : null);
  return {
    explicitEnv,
    checkoutInstanceDefault,
    instance,
    portDefaults,
    brokerPort,
    brokerUrl,
    explicitWebPort,
    explicitPairingPort,
  };
}
