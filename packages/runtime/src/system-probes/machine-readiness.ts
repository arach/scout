// How ready a machine is for agents, read over SSH (or locally for this Mac).
//
// One fixed, read-only script: platform, OS version, which terminal hosts and
// harnesses are on PATH, and the Scout CLI version. Nothing is installed,
// started, or written. The script travels on stdin to `/bin/sh -s`, so no part
// of it is ever built from machine names or other input.
//
// SSH runs with BatchMode: a host that wants a password or an unknown host key
// fails fast with a reason instead of hanging on a prompt nobody can answer.

import { defaultSshExec, type SshExec } from "../mesh-ssh-enroll.js";

export const READINESS_TOOLS = ["scout", "herdr", "tmux", "orca", "claude", "codex"] as const;
export type ReadinessTool = (typeof READINESS_TOOLS)[number];

export type MachineReadinessFailure =
  | "unresolved"
  | "refused"
  | "denied"
  | "host-key"
  | "timeout"
  | "error";

export type MachineReadiness = {
  testedAt: number;
  via: "local" | "ssh";
  /** The ssh destination used, as typed (`mini`, `studio-lab.tail1e8e67.ts.net`). */
  destination: string | null;
  reachable: boolean;
  failure: MachineReadinessFailure | null;
  /** One line a person can read: why it failed. */
  failureDetail: string | null;
  os: string | null;
  arch: string | null;
  hostName: string | null;
  /** macOS product version, or a Linux distro's pretty name. */
  osVersion: string | null;
  scoutVersion: string | null;
  /** Path on the machine's login PATH, or null when not found. */
  tools: Record<ReadinessTool, string | null>;
};

export const MACHINE_READINESS_SCRIPT = `
LOGIN_PATH=$("\${SHELL:-/bin/sh}" -lc 'printf %s "$PATH"' 2>/dev/null </dev/null)
[ -n "$LOGIN_PATH" ] && PATH="$LOGIN_PATH"
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin"
export PATH
echo "os=$(uname -s)"
echo "arch=$(uname -m)"
echo "host=$(hostname)"
command -v sw_vers >/dev/null 2>&1 && echo "macos=$(sw_vers -productVersion)"
[ -r /etc/os-release ] && ( . /etc/os-release; echo "distro=$PRETTY_NAME" )
for t in ${READINESS_TOOLS.join(" ")}; do p=$(command -v "$t" 2>/dev/null) && echo "tool.$t=$p"; done
command -v scout >/dev/null 2>&1 && echo "scout.version=$(scout --version 2>/dev/null | head -n 1)"
exit 0
`;

const DESTINATION = /^[A-Za-z0-9_][A-Za-z0-9._@:-]*$/;
const DEFAULT_TIMEOUT_MS = 20_000;

export function isSafeSshDestination(destination: string): boolean {
  return DESTINATION.test(destination);
}

export function machineReadinessArgv(destination: string | null): string[] {
  if (destination === null) return ["/bin/sh", "-s"];
  if (!isSafeSshDestination(destination)) {
    throw new Error(`not an ssh destination: ${destination}`);
  }
  return [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    destination,
    "/bin/sh", "-s",
  ];
}

export function parseMachineReadiness(
  stdout: string,
  base: Pick<MachineReadiness, "testedAt" | "via" | "destination">,
): MachineReadiness {
  const values = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key && value && !values.has(key)) values.set(key, value);
  }
  const tools = Object.fromEntries(
    READINESS_TOOLS.map((tool) => [tool, values.get(`tool.${tool}`) ?? null]),
  ) as Record<ReadinessTool, string | null>;
  const os = values.get("os") ?? null;
  return {
    ...base,
    reachable: true,
    failure: null,
    failureDetail: null,
    os,
    arch: values.get("arch") ?? null,
    hostName: values.get("host") ?? null,
    osVersion: values.get("macos") ?? values.get("distro") ?? null,
    scoutVersion: tools.scout ? cleanVersion(values.get("scout.version")) : null,
    tools,
  };
}

function cleanVersion(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/\d+\.\d+\.\d+[\w.+-]*/);
  return match ? match[0] : raw.slice(0, 40);
}

/** ssh's stderr, folded into a reason the page can say in a few words. */
export function classifySshFailure(stderr: string): { failure: MachineReadinessFailure; detail: string } {
  const text = stderr.trim();
  const line = text.split("\n").map((part) => part.trim()).filter(Boolean).pop() ?? "";
  if (/could not resolve hostname|nodename nor servname|name or service not known/i.test(text)) {
    return { failure: "unresolved", detail: "The name doesn't resolve." };
  }
  if (/connection refused/i.test(text)) {
    return { failure: "refused", detail: "SSH isn't accepting connections there." };
  }
  if (/host key verification failed|no .* host key is known/i.test(text)) {
    return { failure: "host-key", detail: "Its host key isn't trusted yet. Connect once in a terminal to accept it." };
  }
  if (/permission denied/i.test(text)) {
    return { failure: "denied", detail: "No key it accepts. It wants a password or a different key." };
  }
  if (/timed out|operation timed out|no route to host/i.test(text)) {
    return { failure: "timeout", detail: "No answer." };
  }
  return { failure: "error", detail: line || "SSH failed." };
}

function emptyTools(): Record<ReadinessTool, string | null> {
  return Object.fromEntries(READINESS_TOOLS.map((tool) => [tool, null])) as Record<ReadinessTool, string | null>;
}

export async function probeMachineReadiness(input: {
  /** null = this machine, read locally. */
  destination: string | null;
  exec?: SshExec;
  now?: () => number;
  timeoutMs?: number;
}): Promise<MachineReadiness> {
  const exec = input.exec ?? defaultSshExec;
  const base = {
    testedAt: (input.now ?? Date.now)(),
    via: input.destination === null ? "local" as const : "ssh" as const,
    destination: input.destination,
  };
  const failed = (failure: MachineReadinessFailure, detail: string): MachineReadiness => ({
    ...base,
    reachable: false,
    failure,
    failureDetail: detail,
    os: null,
    arch: null,
    hostName: null,
    osVersion: null,
    scoutVersion: null,
    tools: emptyTools(),
  });

  let argv: string[];
  try {
    argv = machineReadinessArgv(input.destination);
  } catch (error) {
    return failed("error", error instanceof Error ? error.message : String(error));
  }
  try {
    const result = await exec({
      argv,
      stdin: MACHINE_READINESS_SCRIPT,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    // ssh exits 255 for its own failures; the script itself always exits 0.
    if (result.exitCode !== 0 && !/^os=/m.test(result.stdout)) {
      const { failure, detail } = classifySshFailure(result.stderr);
      return failed(failure, detail);
    }
    return parseMachineReadiness(result.stdout, base);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /timed out/i.test(message) ? failed("timeout", "No answer.") : failed("error", message);
  }
}
