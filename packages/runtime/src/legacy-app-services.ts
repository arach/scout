import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { deriveOpenScoutInstanceLayout } from "./instance.js";
import type { RuntimeEnv } from "./portable-types.js";

/** Transitional app entry configuration. This is not an extension autostart registry. */
type LegacyAppServices = {
  version: 1;
  web?: { entry?: string | null };
  scoutbot?: { enabled?: boolean; entry?: string | null };
};

export function legacyAppServicesPath(env: RuntimeEnv): string {
  const layout = deriveOpenScoutInstanceLayout({ env, home: env.HOME?.trim() || homedir() });
  return join(env.OPENSCOUT_SUPPORT_DIRECTORY?.trim() || layout.supportDirectory, "legacy-app-services.json");
}

function readConfig(env: RuntimeEnv): LegacyAppServices | null {
  const path = legacyAppServicesPath(env);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read app service configuration ${path}: ${(error as Error).message}`);
  }
  try {
    if (text.length > 64 * 1024) throw new Error("configuration exceeds 64 KiB");
    const config = JSON.parse(text);
    if (!config || config.version !== 1) throw new Error("expected version 1");
    for (const key of ["web", "scoutbot"]) {
      const service = config[key];
      if (service === undefined) continue;
      if (!service || typeof service !== "object" || Array.isArray(service)) throw new Error(`invalid ${key}`);
      if (service.entry !== undefined && service.entry !== null && typeof service.entry !== "string") throw new Error(`invalid ${key}.entry`);
    }
    if (config.scoutbot?.enabled !== undefined && typeof config.scoutbot.enabled !== "boolean") throw new Error("invalid scoutbot.enabled");
    return config;
  } catch (error) {
    throw new Error(`Invalid app service configuration ${path}: ${(error as Error).message}`);
  }
}

function checkedEntry(value: string | null | undefined, role: string): string | null {
  const entry = value?.trim();
  if (!entry) return null;
  if (!isAbsolute(entry)) throw new Error(`${role} entry must be an absolute file path: ${entry}`);
  try {
    if (!statSync(entry).isFile()) throw new Error("not a regular file");
  } catch (error) {
    throw new Error(`Configured ${role} entry is unavailable: ${entry}: ${(error as Error).message}`);
  }
  return entry;
}

/** Preserve the installed npm web bundle until web leaves the public package.
 * Never search a repository, and never use this after explicit configuration. */
function installedWebBundle(moduleDirectory: string): string | null {
  for (const directory of [resolve(moduleDirectory, ".."), resolve(moduleDirectory, "..", "..")]) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "..", "package.json"), "utf8"));
      if (manifest.name !== "@openscout/scout") continue;
    } catch { continue; }
    for (const name of ["scout-control-plane-web.mjs", "scout-web-server.mjs"]) {
      const entry = join(directory, name);
      try { if (statSync(entry).isFile()) return entry; } catch { /* Try the compatibility bundle name. */ }
    }
  }
  return null;
}

export function resolveLegacyWebEntry(env: RuntimeEnv, moduleDirectory: string): string | null {
  if (env.OPENSCOUT_WEB_SERVER_ENTRY !== undefined) return checkedEntry(env.OPENSCOUT_WEB_SERVER_ENTRY, "web");
  const config = readConfig(env);
  // A present file is authoritative, including an absent/null web entry.
  if (config) return checkedEntry(config.web?.entry, "web");
  return installedWebBundle(moduleDirectory);
}

export function resolveLegacyScoutbotEntry(env: RuntimeEnv, entryOverride?: () => string | null): string | null {
  const flag = env.OPENSCOUT_SCOUTBOT_PROCESS?.trim().toLowerCase();
  if (flag !== undefined && !["", "0", "false", "off", "1", "true", "on", "managed"].includes(flag)) {
    throw new Error("OPENSCOUT_SCOUTBOT_PROCESS must explicitly enable or disable Scoutbot");
  }
  if (flag !== undefined && !["1", "true", "on", "managed"].includes(flag)) return null;
  // Read on each decision, not once at module import or daemon startup.
  const needsConfig = flag === undefined || (env.OPENSCOUT_SCOUTBOT_ENTRY === undefined && !entryOverride);
  const config = needsConfig ? readConfig(env) : null;
  if (flag === undefined && config?.scoutbot?.enabled !== true) return null;
  if (entryOverride) return entryOverride();
  const entry = checkedEntry(env.OPENSCOUT_SCOUTBOT_ENTRY !== undefined
    ? env.OPENSCOUT_SCOUTBOT_ENTRY : config?.scoutbot?.entry, "Scoutbot");
  if (!entry) throw new Error("Scoutbot is enabled but no explicit entry is configured");
  return entry;
}
