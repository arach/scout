/**
 * Readiness readings for Settings › Hosts.
 *
 * The broker owns which machines exist; this owns only "what did a test find
 * there", in memory, because a reading is a moment rather than a fact about
 * the machine. Nothing runs until the operator presses Test.
 */

import type { MachineRecord } from "@openscout/protocol";
import {
  isSafeSshDestination,
  probeMachineReadiness,
  readSshConfig,
  type MachineReadiness,
} from "@openscout/runtime/system-probes";

/** How the page reaches a machine: this Mac locally, else ssh by the name the operator uses. */
export type MachineWayIn =
  | { kind: "local" }
  | { kind: "ssh"; destination: string; source: "config" | "tailnet" };

export function machineWayIn(machine: MachineRecord): MachineWayIn | null {
  if (machine.isSelf) return { kind: "local" };
  const configured = machine.sshTargets?.find((target) => isSafeSshDestination(target.alias));
  if (configured) return { kind: "ssh", destination: configured.alias, source: "config" };
  const tailnet = machineTailnetDnsName(machine);
  if (tailnet) return { kind: "ssh", destination: tailnet, source: "tailnet" };
  return null;
}

/** The machine's MagicDNS name, from its tailnet sighting. */
export function machineTailnetDnsName(machine: Pick<MachineRecord, "evidence">): string | null {
  for (const evidence of machine.evidence) {
    if (evidence.kind !== "tailnet" || !evidence.dnsName) continue;
    const name = evidence.dnsName.replace(/\.$/, "");
    if (isSafeSshDestination(name)) return name;
  }
  return null;
}

export type ReadinessProbe = (destination: string | null) => Promise<MachineReadiness>;

export function createReadinessStore(probe: ReadinessProbe = (destination) => probeMachineReadiness({ destination })) {
  const readings = new Map<string, MachineReadiness>();
  const inFlight = new Map<string, Promise<MachineReadiness>>();

  async function test(machine: MachineRecord): Promise<MachineReadiness | null> {
    const way = machineWayIn(machine);
    if (!way) return null;
    const running = inFlight.get(machine.id);
    if (running) return running;
    const next = probe(way.kind === "local" ? null : way.destination)
      .then((reading) => {
        readings.set(machine.id, reading);
        return reading;
      })
      .finally(() => inFlight.delete(machine.id));
    inFlight.set(machine.id, next);
    return next;
  }

  async function testAll(machines: readonly MachineRecord[], concurrency = 4): Promise<void> {
    // Phones never take ssh, and older records of this Mac are the same
    // machine: test the newest one once.
    const self = machines.filter((machine) => machine.isSelf).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0];
    const queue = machines.filter((machine) =>
      (machine.isSelf ? machine === self : machine.platform !== "ios" && machine.platform !== "android")
      && machineWayIn(machine) !== null);
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await test(next);
    });
    await Promise.all(workers);
  }

  return {
    test,
    testAll,
    snapshot: (): Record<string, MachineReadiness> => Object.fromEntries(readings),
  };
}

export type SshConfigSummary = {
  files: string[];
  hostCount: number;
  services: { alias: string; hostName: string; user: string | null }[];
};

export async function loadSshConfigSummary(): Promise<SshConfigSummary> {
  const snapshot = await readSshConfig();
  return {
    files: snapshot.files,
    hostCount: snapshot.hosts.length,
    services: snapshot.services.map((service) => ({
      alias: service.alias,
      hostName: service.hostName,
      user: service.user ?? null,
    })),
  };
}
