/**
 * Settings › Hosts, as data: every machine the broker knows, grouped by the
 * network it is on, with four readiness gauges read off the last Test.
 *
 * Order is fixed by what the machine is (this Mac, then machines with an SSH
 * entry, then the rest by name) and never by what a test found, so pressing
 * Test lights a row in place instead of moving it.
 */

import {
  machineLabel,
  machinePresence,
  type MachinePresence,
  type MachineRecord,
  type MachineSshTarget,
} from "@openscout/protocol";
import type { MachineReadiness } from "@openscout/runtime/system-probes";

export type GaugeKey = "ssh" | "scout" | "terminal" | "agents";
/** on = present, off = looked and missing, unknown = not looked yet. */
export type Segment = "on" | "off" | "unknown";
export type Gauge = { key: GaugeKey; segments: Segment[]; value: string; full: boolean };

export type HostRowKind = "self" | "machine" | "neighbours" | "configured";

export type HostRow = {
  id: string;
  kind: HostRowKind;
  name: string;
  tag: string | null;
  summary: string;
  presence: MachinePresence | "listed";
  gauges: Gauge[];
  machine: MachineRecord | null;
  reading: MachineReadiness | null;
  ssh: MachineSshTarget | null;
  tailnetDnsName: string | null;
  /** How Test and Open terminal reach it; null when nothing can. */
  destination: string | null;
  /** MAC-only neighbours folded into one row. */
  neighbours: MachineRecord[];
};

export type HostSection = { id: "tailnet" | "local" | "configured"; label: string; aside: string; rows: HostRow[] };

export type HostsModel = {
  sections: HostSection[];
  devices: string[];
  newestScout: string | null;
  machineCount: number;
};

const TERMINAL_TOOLS = ["herdr", "tmux", "orca"] as const;
const AGENT_TOOLS = ["claude", "codex"] as const;

export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function newestScoutVersion(readings: readonly (MachineReadiness | null)[]): string | null {
  let newest: string | null = null;
  for (const reading of readings) {
    const version = reading?.scoutVersion;
    if (version && (!newest || compareVersions(version, newest) > 0)) newest = version;
  }
  return newest;
}

export function tailnetDnsName(machine: MachineRecord): string | null {
  for (const evidence of machine.evidence) {
    if (evidence.kind === "tailnet" && evidence.dnsName) return evidence.dnsName.replace(/\.$/, "");
  }
  return null;
}

function tailnetSuffix(machines: readonly MachineRecord[]): string | null {
  for (const machine of machines) {
    const name = tailnetDnsName(machine);
    const at = name?.indexOf(".") ?? -1;
    if (name && at > 0) return name.slice(at + 1);
  }
  return null;
}

const SSH_FAILURE_WORDS: Record<NonNullable<MachineReadiness["failure"]>, string> = {
  unresolved: "won't resolve",
  refused: "refused",
  denied: "key refused",
  "host-key": "host key new",
  timeout: "no answer",
  error: "failed",
};

function sshGauge(row: { kind: HostRowKind; ssh: MachineSshTarget | null; destination: string | null }, reading: MachineReadiness | null): Gauge {
  if (row.kind === "self") return { key: "ssh", segments: [], value: "this Mac", full: true };
  if (!row.destination) return { key: "ssh", segments: ["off", "off", "off"], value: "no way in", full: false };
  const entry: Segment = row.ssh ? "on" : "off";
  if (!reading) {
    return { key: "ssh", segments: [entry, "unknown", "unknown"], value: row.ssh ? "not tested" : "no entry", full: false };
  }
  if (reading.reachable) return { key: "ssh", segments: [entry, "on", "on"], value: "answers", full: !!row.ssh };
  const resolved: Segment = reading.failure === "unresolved" ? "off" : "on";
  return { key: "ssh", segments: [entry, resolved, "off"], value: SSH_FAILURE_WORDS[reading.failure ?? "error"], full: false };
}

function scoutGauge(reading: MachineReadiness | null, newest: string | null): Gauge {
  if (!reading?.reachable) return { key: "scout", segments: ["unknown", "unknown", "unknown"], value: "—", full: false };
  if (!reading.tools.scout) return { key: "scout", segments: ["off", "off", "off"], value: "not installed", full: false };
  const version = reading.scoutVersion;
  if (!version) return { key: "scout", segments: ["on", "off", "off"], value: "on PATH", full: false };
  if (!newest || compareVersions(version, newest) >= 0) return { key: "scout", segments: ["on", "on", "on"], value: version, full: true };
  const sameMinor = version.split(".").slice(0, 2).join(".") === newest.split(".").slice(0, 2).join(".");
  return { key: "scout", segments: sameMinor ? ["on", "on", "off"] : ["on", "off", "off"], value: version, full: false };
}

function toolGauge(key: GaugeKey, tools: readonly string[], reading: MachineReadiness | null): Gauge {
  if (!reading?.reachable) return { key, segments: tools.map(() => "unknown"), value: "—", full: false };
  const present = tools.filter((tool) => reading.tools[tool as keyof MachineReadiness["tools"]]);
  return {
    key,
    segments: tools.map((_, index) => (index < present.length ? "on" : "off")),
    value: present.length === 0 ? "none" : present.join(" "),
    full: present.length === tools.length,
  };
}

export function rowGauges(row: Pick<HostRow, "kind" | "ssh" | "destination" | "reading">, newest: string | null): Gauge[] {
  return [
    sshGauge(row, row.reading),
    scoutGauge(row.reading, newest),
    toolGauge("terminal", TERMINAL_TOOLS, row.reading),
    toolGauge("agents", AGENT_TOOLS, row.reading),
  ];
}

function hasKind(machine: MachineRecord, kind: MachineRecord["evidence"][number]["kind"]): boolean {
  return machine.evidence.some((evidence) => evidence.kind === kind);
}

function isDevice(machine: MachineRecord): boolean {
  return machine.platform === "ios" || machine.platform === "android";
}

function isMacOnly(machine: MachineRecord): boolean {
  return machine.evidence.every((evidence) => evidence.kind === "lan") && machine.hostNames.length === 0;
}

const PLATFORM_TAG: Partial<Record<MachineRecord["platform"], string>> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

function machineRow(
  machine: MachineRecord,
  kind: HostRowKind,
  reading: MachineReadiness | null,
  newest: string | null,
  now: number,
): HostRow {
  const ssh = machine.sshTargets?.[0] ?? null;
  const dns = tailnetDnsName(machine);
  const destination = kind === "self" ? null : ssh?.alias ?? dns;
  const login = ssh
    ? `ssh ${ssh.alias} → ${ssh.user ? `${ssh.user}@` : ""}${ssh.hostName}`
    : dns
      ? `${dns} · no SSH entry`
      : machine.hostNames[0] ?? machine.addresses[0] ?? "";
  const row: HostRow = {
    id: machine.id,
    kind,
    name: machineLabel(machine),
    tag: kind === "self" ? "This Mac" : PLATFORM_TAG[machine.platform] ?? null,
    summary: kind === "self" ? `you are here${dns ? ` · ${dns}` : ""}` : login,
    presence: kind === "configured" ? "listed" : machinePresence(machine, now),
    gauges: [],
    machine,
    reading,
    ssh,
    tailnetDnsName: dns,
    destination: kind === "self" ? null : destination,
    neighbours: [],
  };
  row.gauges = rowGauges(row, newest);
  return row;
}

function byName(a: MachineRecord, b: MachineRecord): number {
  return machineLabel(a).localeCompare(machineLabel(b));
}

export function buildHostsModel(
  machines: readonly MachineRecord[],
  readings: Readonly<Record<string, MachineReadiness>>,
  now: number = Date.now(),
): HostsModel {
  const newest = newestScoutVersion(Object.values(readings));
  const self = [...machines].filter((machine) => machine.isSelf).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
  // Older records of this Mac (a rename leaves the old tailnet node behind)
  // are the same machine, not another host to reach.
  const rest = machines.filter((machine) => !machine.isSelf && !isDevice(machine));
  const reading = (machine: MachineRecord) => readings[machine.id] ?? null;

  const onTailnet = rest.filter((machine) => hasKind(machine, "tailnet"));
  const configuredOnly = rest.filter((machine) => machine.evidence.length > 0 && machine.evidence.every((evidence) => evidence.kind === "ssh"));
  const local = rest.filter((machine) => !onTailnet.includes(machine) && !configuredOnly.includes(machine));
  const neighbours = local.filter(isMacOnly);
  const namedLocal = local.filter((machine) => !isMacOnly(machine));

  const tailnetRows: HostRow[] = [];
  if (self) tailnetRows.push(machineRow(self, "self", reading(self), newest, now));
  const withEntry = onTailnet.filter((machine) => machine.sshTargets?.length).sort(byName);
  const withoutEntry = onTailnet.filter((machine) => !machine.sshTargets?.length).sort(byName);
  for (const machine of [...withEntry, ...withoutEntry]) {
    tailnetRows.push(machineRow(machine, "machine", reading(machine), newest, now));
  }

  const localRows = namedLocal.sort(byName).map((machine) => machineRow(machine, "machine", reading(machine), newest, now));
  if (neighbours.length > 0) {
    localRows.push({
      id: "neighbours",
      kind: "neighbours",
      name: `${neighbours.length} ${neighbours.length === 1 ? "neighbour" : "neighbours"}`,
      tag: null,
      summary: "known only by hardware address",
      presence: neighbours.some((machine) => machinePresence(machine, now) === "online") ? "online" : "recent",
      gauges: (["ssh", "scout", "terminal", "agents"] as const).map((key) => ({ key, segments: [], value: "—", full: false })),
      machine: null,
      reading: null,
      ssh: null,
      tailnetDnsName: null,
      destination: null,
      neighbours: [...neighbours].sort((a, b) => b.lastSeenAt - a.lastSeenAt),
    });
  }

  const configuredRows = configuredOnly.sort(byName).map((machine) => machineRow(machine, "configured", reading(machine), newest, now));
  const suffix = tailnetSuffix(machines);
  const tested = tailnetRows.filter((row) => row.reading).length;

  const sections: HostSection[] = [
    {
      id: "tailnet",
      label: suffix ? `Tailnet · ${suffix}` : "Tailnet",
      aside: `${tailnetRows.length} ${tailnetRows.length === 1 ? "machine" : "machines"} · ${tested} tested`,
      rows: tailnetRows,
    },
    { id: "local", label: "Local network", aside: "not on your tailnet", rows: localRows },
    { id: "configured", label: "SSH config only", aside: "entries no network can see", rows: configuredRows },
  ];

  return {
    sections: sections.filter((section) => section.rows.length > 0),
    devices: machines.filter(isDevice).map(machineLabel).sort(),
    newestScout: newest,
    machineCount: machines.length,
  };
}

/** One sentence on what matters about this row right now. */
export function rowNote(row: HostRow, newest: string | null): string | null {
  const reading = row.reading;
  if (row.kind === "neighbours") {
    return "Devices answering on this network that never gave a name. Nothing to connect to until one shows up on your tailnet or in your SSH config.";
  }
  if (!reading) {
    if (row.kind === "configured") return "In your SSH config, but no network has seen it. Test to find out whether the entry still works.";
    if (!row.ssh && row.destination) return "On your tailnet. You have no SSH entry for it; Test tries its tailnet name as you.";
    return row.destination || row.kind === "self" ? "Not tested yet. Test reads what's installed there; it changes nothing." : null;
  }
  if (!reading.reachable) return reading.failureDetail;
  const missing = [...TERMINAL_TOOLS.slice(0, 2), ...AGENT_TOOLS].filter((tool) => !reading.tools[tool]);
  const parts: string[] = [];
  if (!reading.tools.scout) parts.push("Scout isn't installed.");
  else if (reading.scoutVersion && newest && compareVersions(reading.scoutVersion, newest) < 0) {
    parts.push(`Scout ${reading.scoutVersion} here; the newest in your fleet is ${newest}.`);
  }
  if (missing.length > 0) parts.push(`Not found: ${missing.join(", ")}.`);
  return parts.length > 0 ? parts.join(" ") : "Ready for agents.";
}

export function isBehind(row: HostRow, newest: string | null): boolean {
  const version = row.reading?.scoutVersion;
  return !!(version && newest && compareVersions(version, newest) < 0);
}

export function sshCommand(row: HostRow): string | null {
  return row.destination ? `ssh ${row.destination}` : null;
}

export function hostBlock(row: HostRow): string | null {
  if (row.ssh || !row.tailnetDnsName || !row.machine) return null;
  return `Host ${row.machine.name}\n  HostName ${row.tailnetDnsName}`;
}
