import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { readMeshBridgeConfigSnapshot, type MeshBridgeExtension } from "./mesh-bridge-extension.js";
import { isMeshBridgeCommand } from "./scout-bridge-command.js";

/**
 * The suite's own mesh bridge (`scout mesh bridge`, SCO-095) is a child of
 * scout-base, like the pairing controller: it restarts, upgrades and shuts down
 * with the rest of the service tree. It used to be its own LaunchAgent, which
 * pinned whatever build ran `mesh bridge install` and drifted silently.
 */

export const MESH_BRIDGE_CONFIG_FILENAME = "mcp-bridge.json";
export const LEGACY_MESH_BRIDGE_LAUNCH_AGENT_LABEL = "app.openscout.mcp-bridge";

/** `scout mesh bridge` exits with this (EX_CONFIG) when it has no relay token. */
export const MESH_BRIDGE_EXIT_UNCONFIGURED = 78;

export function meshBridgeConfigPath(supportDirectory: string): string {
  return join(supportDirectory, MESH_BRIDGE_CONFIG_FILENAME);
}

export function legacyMeshBridgeLaunchAgentPath(home = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${LEGACY_MESH_BRIDGE_LAUNCH_AGENT_LABEL}.plist`);
}

export type MeshBridgeDesiredState =
  | { run: true; configPath: string; configMtimeMs: number; configDigest: string }
  | { run: false; reason: "disabled-by-env" | "no-config" | "disabled-in-config" | "invalid-config" | "legacy-launch-agent" };

export function resolveMeshBridgeDesiredState(input: {
  supportDirectory: string;
  env: NodeJS.ProcessEnv;
  home?: string;
}): MeshBridgeDesiredState {
  if (input.env.OPENSCOUT_BASE_MESH_BRIDGE_ENABLED === "0") {
    return { run: false, reason: "disabled-by-env" };
  }
  const configPath = meshBridgeConfigPath(input.supportDirectory);
  if (!existsSync(configPath)) {
    return { run: false, reason: "no-config" };
  }
  let configMtimeMs: number;
  let configDigest: string;
  let parsed: unknown;
  try {
    const snapshot = readMeshBridgeConfigSnapshot(configPath);
    configMtimeMs = snapshot.mtimeMs;
    configDigest = snapshot.digest;
    parsed = snapshot.value;
  } catch {
    return { run: false, reason: "invalid-config" };
  }
  if (parsed && typeof parsed === "object" && (parsed as { enabled?: unknown }).enabled === false) {
    return { run: false, reason: "disabled-in-config" };
  }
  // Two bridges would both hold the relay connection for this node. The old
  // LaunchAgent wins until `scout mesh bridge install` retires it.
  if (existsSync(legacyMeshBridgeLaunchAgentPath(input.home))) {
    return { run: false, reason: "legacy-launch-agent" };
  }
  return { run: true, configPath, configMtimeMs, configDigest };
}

export type MeshBridgeCommand = { entrypoint: string; args: string[] };

/**
 * Only an explicit operator-selected CLI file may replace an absent extension.
 * Never infer a CLI from the runtime's checkout, mode, module or global install.
 * Developers can opt into source by naming it in OPENSCOUT_MESH_BRIDGE_BIN.
 */
export function resolveMeshBridgeEntrypoint(input: {
  env: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}): string | null {
  const entrypoint = input.env.OPENSCOUT_MESH_BRIDGE_BIN?.trim();
  if (!entrypoint || !isAbsolute(entrypoint)) return null;
  try {
    return (input.exists ? input.exists(entrypoint) : statSync(entrypoint).isFile()) ? entrypoint : null;
  } catch { return null; }
}

export const MESH_BRIDGE_INSTALL_FIX = "From a Scout checkout: bun run --cwd packages/mesh-extension build && scout extensions install mesh \"$PWD/packages/mesh-extension/dist/mesh\" (use update for an existing install). Alternatively set OPENSCOUT_MESH_BRIDGE_BIN to an absolute Scout CLI file in the scout-base service environment; it must support mesh bridge --config. Removed or untrusted installs must be repaired; BIN never bypasses them. Then rerun openscout-runtime mesh-bridge-preflight.";

/** Removed/untrusted installs remain authoritative: an override cannot bypass them. */
export function meshBridgeSelectionRefusal(selected: MeshBridgeExtension, env: NodeJS.ProcessEnv): string | null {
  if (selected.state === "refused") return selected.reason;
  if (selected.state === "ready" || resolveMeshBridgeEntrypoint({ env })) return null;
  return env.OPENSCOUT_MESH_BRIDGE_BIN?.trim() ? "override-unavailable" : "extension-absent";
}

export function meshBridgeArgs(entrypoint: string, configPath: string): string[] {
  return [entrypoint, "mesh", "bridge", "--config", configPath];
}

export { isMeshBridgeCommand };

export function meshBridgeStatePath(supportDirectory: string): string {
  return join(supportDirectory, "runtime", "mesh-bridge.json");
}

export type ProcessIdentity = { args: string; startedAt: string };

/** `ps` args plus start time; the pair identifies one process across pid reuse. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
  const result = spawnSync("ps", ["-o", "lstart=,args=", "-p", String(pid)], { encoding: "utf8" });
  if (result.status !== 0) return null;
  // lstart is a fixed five-field date: "Fri 25 Sep 23:14:23 2026".
  const match = /^\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/.exec(result.stdout.trim());
  return match ? { startedAt: match[1]!, args: match[2]! } : null;
}

/**
 * The bridge a previous scout-base recorded, only while that exact process is
 * still alive: same pid, same start time, still a mesh bridge. A reused pid
 * fails the start-time check, so fencing can never signal an unrelated process.
 */
export function findRecordedLiveMeshBridgePid(
  supportDirectory: string,
  readIdentity: (pid: number) => ProcessIdentity | null = readProcessIdentity,
): number | null {
  let recorded: { pid?: unknown; processStartedAt?: unknown };
  try {
    recorded = JSON.parse(readFileSync(meshBridgeStatePath(supportDirectory), "utf8")) as typeof recorded;
  } catch {
    return null;
  }
  const { pid, processStartedAt } = recorded;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return null;
  if (typeof processStartedAt !== "string" || !processStartedAt) return null;
  const identity = readIdentity(pid);
  if (!identity || identity.startedAt !== processStartedAt) return null;
  return isMeshBridgeCommand(identity.args) ? pid : null;
}

export type LaunchdJobState = "loaded" | "absent" | "unknown";

/**
 * Whether a launchd job is loaded. Only launchd's explicit "could not find
 * service" counts as absent; any other failure is unknown, and callers that
 * guard against a second owner must treat unknown as possibly loaded.
 */
export function inspectLaunchdJob(
  target: string,
  run: (args: string[]) => { status: number | null; output: string } = runLaunchctl,
): LaunchdJobState {
  const result = run(["print", target]);
  if (result.status === 0) return "loaded";
  if (result.status === 113 || /could not find service/i.test(result.output)) return "absent";
  return "unknown";
}

/**
 * `launchctl bootout` returns before launchd finishes tearing the job down, so
 * an immediate inspect still reports it loaded. Poll until it is absent or the
 * deadline passes; anything but absent at the end is returned as-is.
 */
export async function waitForLaunchdJobAbsent(
  target: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    inspect?: (target: string) => LaunchdJobState;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<LaunchdJobState> {
  const inspect = options.inspect ?? ((value: string) => inspectLaunchdJob(value));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 10_000);
  let state = inspect(target);
  while (state !== "absent" && now() < deadline) {
    await sleep(options.pollMs ?? 250);
    state = inspect(target);
  }
  return state;
}

export function legacyMeshBridgeLaunchdTarget(uid = process.getuid?.() ?? 501): string {
  return `gui/${uid}/${LEGACY_MESH_BRIDGE_LAUNCH_AGENT_LABEL}`;
}

type LaunchctlSpawn = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8" },
) => { status: number | null; stdout?: string | null; stderr?: string | null };

export function runLaunchctlProbe(
  args: string[],
  spawn?: LaunchctlSpawn,
): { status: number | null; output: string } {
  if (process.platform !== "darwin") {
    return { status: 113, output: "Could not find service" };
  }
  const result = spawn
    ? spawn("launchctl", args, { encoding: "utf8" })
    : spawnSync("launchctl", args, { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function runLaunchctl(args: string[]): { status: number | null; output: string } {
  return runLaunchctlProbe(args);
}

/** Fence only the recorded process incarnation, and confirm exit before spawning. */
export async function fenceRecordedMeshBridge(supportDirectory:string, options:{
  readIdentity?:(pid:number)=>ProcessIdentity|null; signal?:(pid:number,signal:NodeJS.Signals)=>void;
  isAlive?:(pid:number)=>boolean; sleep?:(ms:number)=>Promise<void>; now?:()=>number; timeoutMs?:number;
}={}):Promise<void> {
  const read=options.readIdentity??readProcessIdentity, now=options.now??Date.now;
  const sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  const signal=options.signal??((pid,signal)=>process.kill(pid,signal));
  const alive=options.isAlive??((pid:number)=>{try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw new Error('previous mesh bridge liveness unavailable');}});
  const path=meshBridgeStatePath(supportDirectory);
  if(!existsSync(path))return;
  let record:Record<string,unknown>;
  try{record=readMeshBridgeConfigSnapshot(path).value;}catch{throw new Error('previous mesh bridge state unavailable');}
  const pid=record.pid, startedAt=record.processStartedAt;
  if(typeof pid!=='number'||!Number.isInteger(pid)||pid<=1||pid===process.pid)return;
  if(typeof startedAt!=='string'||!startedAt){if(alive(pid))throw new Error('previous mesh bridge identity unavailable');return;}
  const same=()=>{
    const current=read(pid);
    if(!current){if(alive(pid))throw new Error('previous mesh bridge identity unavailable');return false;}
    if(current.startedAt!==startedAt)return false; // A reused PID is never signalled.
    if(!isMeshBridgeCommand(current.args))throw new Error('previous mesh bridge identity unavailable');
    return true;
  };
  const send=(kind:NodeJS.Signals)=>{if(!same())return false;try{signal(pid,kind);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw new Error('previous mesh bridge cannot be fenced');}};
  if(!send('SIGTERM'))return;
  const deadline=now()+(options.timeoutMs??6000);
  while(same()&&now()<deadline)await sleep(100);
  if(!same()||!send('SIGKILL'))return;
  const killedDeadline=now()+1000;
  while(same()&&now()<killedDeadline)await sleep(50);
  if(same())throw new Error('previous mesh bridge has not exited');
}
