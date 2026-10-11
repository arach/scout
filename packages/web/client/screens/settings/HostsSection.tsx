/**
 * Settings › Mesh › Hosts (full web client).
 *
 * Every machine the broker knows, grouped by the network it is on. A closed
 * row shows four readiness gauges; opening it shows what is there and what to
 * do next. Test reads over SSH with a fixed read-only script; Open terminal
 * hands `ssh <name>` to the operator's terminal app. Nothing connects until
 * the operator presses one of them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MachineRecord } from "@openscout/protocol";
import type { MachineReadiness } from "@openscout/runtime/system-probes";

import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import {
  buildHostsModel,
  hostBlock,
  isBehind,
  rowNote,
  sshCommand,
  type Gauge,
  type HostRow,
} from "./hosts-model.ts";
import "./hosts-section.css";

type MachinesResponse = { machines: MachineRecord[] };
type ReadingsResponse = { readings: Record<string, MachineReadiness> };
type SshConfigSummary = { files: string[]; hostCount: number; services: { alias: string; hostName: string; user: string | null }[] };

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function GaugeView({ gauge }: { gauge: Gauge }) {
  return (
    <span className="sq-hosts-gauge" data-full={gauge.full || undefined}>
      <span className="sq-hosts-bar" aria-hidden>
        {gauge.segments.map((segment, index) => <span key={index} data-seg={segment} />)}
      </span>
      <span className="sq-hosts-reading">{gauge.value}</span>
    </span>
  );
}

const GAUGE_LABELS = ["SSH", "Scout", "Terminal", "Agents"];

function Facts({ label, rows }: { label: string; rows: [string, string, boolean?][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="sq-hosts-facts">
      <span className="sq-hosts-facts-label">{label}</span>
      <dl>
        {rows.map(([key, value, dim]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-dim={dim || undefined}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function waysIn(row: HostRow): [string, string, boolean?][] {
  const rows: [string, string, boolean?][] = [];
  if (row.kind === "self") rows.push(["local", "this Mac"]);
  if (row.ssh) {
    rows.push(["ssh", `ssh ${row.ssh.alias} → ${row.ssh.user ? `${row.ssh.user}@` : ""}${row.ssh.hostName}${row.ssh.port ? `:${row.ssh.port}` : ""}`]);
    if (row.ssh.identityFile) rows.push(["key", row.ssh.identityFile]);
    if (row.ssh.proxyJump) rows.push(["via", row.ssh.proxyJump]);
    rows.push(["from", row.ssh.configPath, true]);
  } else if (row.kind === "machine" && row.destination) {
    rows.push(["ssh", "no entry in your SSH config", true]);
  }
  if (row.tailnetDnsName) rows.push(["tailnet", row.tailnetDnsName]);
  for (const evidence of row.machine?.evidence ?? []) {
    if (evidence.kind === "lan" && evidence.hostName) {
      rows.push(["lan", evidence.hostName, true]);
      break;
    }
  }
  return rows;
}

function whatsThere(row: HostRow, newest: string | null): [string, string, boolean?][] {
  const reading = row.reading;
  if (!reading) return [["tools", "not tested", true]];
  if (!reading.reachable) return [["test", reading.failureDetail ?? "failed", true]];
  const scout = reading.tools.scout
    ? `${reading.scoutVersion ?? "version unknown"}${isBehind(row, newest) ? ", behind" : newest && reading.scoutVersion === newest ? ", newest seen" : ""}`
    : "not installed";
  return [
    ["scout", scout, !reading.tools.scout],
    ...(["herdr", "tmux", "orca", "claude", "codex"] as const).map((tool): [string, string, boolean] => [
      tool,
      reading.tools[tool] ?? "not found",
      !reading.tools[tool],
    ]),
  ];
}

function names(row: HostRow): [string, string, boolean?][] {
  const machine = row.machine;
  if (!machine) return [];
  const rows: [string, string, boolean?][] = [];
  if (row.ssh && row.ssh.aliases.length > 1) rows.push(["aliases", row.ssh.aliases.join(", ")]);
  const os = row.reading?.osVersion;
  rows.push(["platform", os ? `${row.reading?.os === "Darwin" ? "macOS " : ""}${os}` : machine.platform]);
  const seenBy = [...new Set(machine.evidence.filter((evidence) => evidence.kind !== "ssh").map((evidence) => evidence.kind))];
  rows.push(["seen by", seenBy.length > 0 ? seenBy.join(" + ") : "nothing yet; listed in config", seenBy.length === 0]);
  if (machine.lastSeenAt > 0 && row.presence !== "online") rows.push(["last seen", timeAgo(machine.lastSeenAt)]);
  if (row.reading) rows.push(["tested", timeAgo(row.reading.testedAt), true]);
  return rows;
}

function HostRowView({
  row,
  open,
  newest,
  busy,
  onToggle,
  onTest,
  onOpenTerminal,
  onCopy,
  copied,
}: {
  row: HostRow;
  open: boolean;
  newest: string | null;
  busy: string | null;
  onToggle: () => void;
  onTest: () => void;
  onOpenTerminal: () => void;
  onCopy: (key: string, text: string) => void;
  copied: string | null;
}) {
  const note = rowNote(row, newest);
  const block = hostBlock(row);
  const command = sshCommand(row);
  const testing = busy === `test:${row.id}`;
  const reachable = row.reading?.reachable === true;
  const canTest = row.kind === "self" || !!row.destination;
  const canOpen = row.kind !== "self" && !!row.destination;
  const behind = isBehind(row, newest);
  const updateCommand = row.kind === "self" ? "scout update" : row.machine ? `scout update ${row.machine.name}` : null;
  const copyLabel = (key: string, label: string) => (copied === key ? "Copied" : label);

  return (
    <div className="sq-hosts-row" data-open={open || undefined}>
      <button type="button" className="sq-hosts-summary" aria-expanded={open} onClick={onToggle}>
        <span className="sq-hosts-name">
          <span className="sq-hosts-dot" data-presence={row.kind === "self" ? "self" : row.presence} aria-hidden />
          <span className="sq-hosts-title">{row.name}</span>
          {row.tag ? <span className="sq-hosts-tag">{row.tag}</span> : null}
        </span>
        <span className="sq-hosts-line">{row.summary}</span>
        <span className="sq-hosts-gauges">
          {row.gauges.map((gauge) => <GaugeView key={gauge.key} gauge={gauge} />)}
        </span>
        <svg className="sq-hosts-chevron" viewBox="0 0 16 16" aria-hidden>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="sq-hosts-detail">
          {note ? <p className="sq-hosts-note">{note}</p> : null}
          {row.kind === "neighbours" ? (
            <ul className="sq-hosts-macs">
              {row.neighbours.map((machine) => (
                <li key={machine.id}>
                  <span>{machine.macAddresses[0] ?? machine.name}</span>
                  <span>{timeAgo(machine.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="sq-hosts-panels">
              <Facts label="Ways in" rows={waysIn(row)} />
              <Facts label="What's there" rows={whatsThere(row, newest)} />
              <Facts label="Names" rows={names(row)} />
            </div>
          )}
          {block ? (
            <div className="sq-hosts-block">
              <span className="sq-hosts-facts-label">Host block to add</span>
              <pre>{block}</pre>
            </div>
          ) : null}
          {row.kind !== "neighbours" ? (
            <div className="sq-hosts-actions">
              {canOpen ? (
                <button type="button" className="sq-button" data-primary={reachable || undefined} disabled={busy !== null} onClick={onOpenTerminal}>
                  {busy === `open:${row.id}` ? "Opening" : "Open terminal"}
                </button>
              ) : null}
              {canTest ? (
                <button type="button" className="sq-button" data-primary={(!reachable && !row.reading && !canOpen) || undefined} disabled={busy !== null} onClick={onTest}>
                  {testing ? "Testing" : row.reading ? "Test again" : row.ssh || row.kind === "self" ? "Test" : "Test SSH"}
                </button>
              ) : null}
              {behind && updateCommand ? (
                <button type="button" className="sq-button" onClick={() => onCopy(`update:${row.id}`, updateCommand)}>
                  {copyLabel(`update:${row.id}`, "Copy update command")}
                </button>
              ) : null}
              {command ? (
                <button type="button" className="sq-button" data-quiet onClick={() => onCopy(`ssh:${row.id}`, command)}>
                  {copyLabel(`ssh:${row.id}`, "Copy ssh command")}
                </button>
              ) : null}
              {block ? (
                <button type="button" className="sq-button" data-quiet onClick={() => onCopy(`block:${row.id}`, block)}>
                  {copyLabel(`block:${row.id}`, "Copy Host block")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function HostsSection() {
  const [machines, setMachines] = useState<MachineRecord[] | null>(null);
  const [readings, setReadings] = useState<Record<string, MachineReadiness>>({});
  const [config, setConfig] = useState<SshConfigSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    try {
      const [roster, tested, summary] = await Promise.all([
        api<MachinesResponse>(refresh ? "/api/machines?refresh=1" : "/api/machines"),
        api<ReadingsResponse>("/api/machines/readiness"),
        api<SshConfigSummary>("/api/machines/ssh-config").catch(() => null),
      ]);
      setMachines(roster.machines);
      setReadings(tested.readings);
      setConfig(summary);
      setError(null);
    } catch (err) {
      setError(errorText(err, "The broker did not answer."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const model = useMemo(() => (machines ? buildHostsModel(machines, readings) : null), [machines, readings]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err, "That did not work."));
    } finally {
      setBusy(null);
    }
  };

  const testOne = (row: HostRow) => run(`test:${row.id}`, async () => {
    const result = await api<{ reading: MachineReadiness }>(`/api/machines/${encodeURIComponent(row.id)}/test`, { method: "POST", body: "{}" });
    setReadings((current) => ({ ...current, [row.id]: result.reading }));
  });

  const testAll = () => run("test-all", async () => {
    const result = await api<ReadingsResponse>("/api/machines/test", { method: "POST", body: "{}" });
    setReadings(result.readings);
  });

  const scan = () => run("scan", async () => {
    await api("/api/machines/scan", { method: "POST", body: "{}" });
    await load();
  });

  const openTerminal = (row: HostRow) => run(`open:${row.id}`, async () => {
    await api(`/api/machines/${encodeURIComponent(row.id)}/open-terminal`, { method: "POST", body: "{}" });
  });

  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
      },
      () => setError("The clipboard is not available here."),
    );
  };

  const sources = ["tailnet", "local network", config && config.files.length > 0 ? "~/.ssh/config" : null].filter(Boolean).join(", ");

  return (
    <section className="sq-hosts">
      <div className="sq-hosts-head">
        <div>
          <h2 className="sq-label">Hosts</h2>
          <p className="sq-hosts-lead">
            {model ? `${model.machineCount} machines · ${sources}` : "Asking the broker…"}
          </p>
        </div>
        <div className="sq-hosts-head-actions">
          <button type="button" className="sq-button" disabled={busy !== null || !model} onClick={() => void testAll()}>
            {busy === "test-all" ? "Testing" : "Test all"}
          </button>
          <button type="button" className="sq-button" disabled={busy !== null} onClick={() => void scan()}>
            {busy === "scan" ? "Scanning" : "Scan again"}
          </button>
        </div>
      </div>
      {error ? <p className="sq-note" data-tone="error" role="alert">{error}</p> : null}

      {model?.sections.map((section) => (
        <div key={section.id} className="sq-hosts-group">
          <div className="sq-hosts-grouphead">
            <span className="sq-hosts-grouplabel">
              {section.label}
              <span>{section.aside}</span>
            </span>
            <span className="sq-hosts-gauges sq-hosts-gaugehead" aria-hidden>
              {GAUGE_LABELS.map((label) => <span key={label}>{label}</span>)}
            </span>
            <span className="sq-hosts-chevron-spacer" aria-hidden />
          </div>
          <div className="sq-card">
            {section.rows.map((row) => (
              <HostRowView
                key={row.id}
                row={row}
                open={open === row.id}
                newest={model.newestScout}
                busy={busy}
                copied={copied}
                onToggle={() => setOpen((current) => (current === row.id ? null : row.id))}
                onTest={() => void testOne(row)}
                onOpenTerminal={() => void openTerminal(row)}
                onCopy={copy}
              />
            ))}
          </div>
          {section.id === "tailnet" && model.devices.length > 0 ? (
            <p className="sq-note">Also here: {model.devices.join(", ")}. Phones and tablets don't take SSH.</p>
          ) : null}
        </div>
      ))}
      {config && config.services.length > 0 ? (
        <p className="sq-note">
          Also in your SSH config: {config.services.map((service) => `${service.alias} (${service.user ? `${service.user}@` : ""}${service.hostName})`).join(", ")}. Git services, not machines.
        </p>
      ) : null}
      <p className="sq-note">Test reads what is installed over SSH and changes nothing. Your SSH config is read, never written.</p>
    </section>
  );
}
