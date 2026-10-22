import { requestScoutBrokerJson, ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { resolveBrokerControlUrl } from "@openscout/runtime/local-config";
import type { QuarantineEvidence, QuarantineMetadata, QuarantineSummary } from "../../../../runtime/src/broker-quarantine.js";
import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";

type QuarantineOptions = { command: "list" | "show" | "acknowledge"; id?: string;
  sessionId?: string; status: "open" | "acknowledged"; limit: number; json: boolean; help: boolean };

export function renderQuarantineCommandHelp(): string {
  return [
    "Usage:",
    "  scout quarantine [list] [--session <id>] [--status open|acknowledged] [--limit 1..100] [--json]",
    "  scout quarantine show <id> [--json]",
    "  scout quarantine acknowledge <id> [--json]",
    "",
    "Inspect preserved records that Scout could not safely apply. List defaults to open records (limit 50).",
    "Show returns the original evidence encoded as base64 with its digest and source location.",
    "Acknowledge marks a record reviewed. It preserves the evidence and never retries work.",
  ].join("\n");
}

export function parseQuarantineCommandOptions(args: string[]): QuarantineOptions {
  const result: QuarantineOptions = { command: "list", status: "open", limit: 50, json: false, help: false };
  if (args.some(value => value === "--help" || value === "-h" || value === "help")) return { ...result, help: true };
  const positional: string[] = [];
  let listFlags = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--json") { result.json = true; continue; }
    if (arg.startsWith("--")) {
      const separator = arg.indexOf("=");
      const flag = separator < 0 ? arg : arg.slice(0, separator);
      if (!["--session", "--status", "--limit"].includes(flag)) throw new ScoutCliError(`Unknown quarantine option: ${flag}`);
      const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
      if (!value?.trim() || value.startsWith("--")) throw new ScoutCliError(`${flag} requires a value`);
      listFlags = true;
      if (flag === "--session") result.sessionId = value;
      if (flag === "--status") {
        if (value !== "open" && value !== "acknowledged") throw new ScoutCliError("--status must be open or acknowledged");
        result.status = value;
      }
      if (flag === "--limit") {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new ScoutCliError("--limit must be an integer from 1 to 100");
        result.limit = Number(value);
      }
    } else positional.push(arg);
  }
  if (positional.length) {
    const command = positional[0];
    if (command !== "list" && command !== "show" && command !== "acknowledge") throw new ScoutCliError(`Unknown quarantine command: ${command}`);
    result.command = command;
  }
  if (result.command === "list") {
    if (positional.length > 1) throw new ScoutCliError("quarantine list does not take a record id");
  } else {
    if (positional.length !== 2 || !positional[1]?.trim()) throw new ScoutCliError(`quarantine ${result.command} requires one record id`);
    if (listFlags) throw new ScoutCliError("--session, --status and --limit apply only to quarantine list");
    result.id = positional[1];
  }
  return result;
}

export async function runQuarantineCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseQuarantineCommandOptions(args);
  if (options.help) { context.output.writeText(renderQuarantineCommandHelp()); return; }
  const baseUrl = context.env.OPENSCOUT_BROKER_URL?.trim() || resolveBrokerControlUrl();
  const params = new URLSearchParams({ status: options.status, limit: String(options.limit) });
  if (options.sessionId) params.set("sessionId", options.sessionId);
  const path = options.command === "list" ? `/v1/quarantine?${params}`
    : `/v1/quarantine/${encodeURIComponent(options.id!)}${options.command === "acknowledge" ? "/acknowledge" : ""}`;
  type Response = { status: QuarantineSummary; records: QuarantineMetadata[] } | { record: QuarantineMetadata | QuarantineEvidence };
  let result: Response;
  try {
    result = await requestScoutBrokerJson<Response>(baseUrl, path, {
      method: options.command === "acknowledge" ? "POST" : "GET",
      socketPath: context.env.OPENSCOUT_BROKER_SOCKET_PATH?.trim() || undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (error instanceof ScoutBrokerHttpError && error.status === 404) throw new ScoutCliError(options.command === "list" ? "Quarantine API is unavailable (HTTP 404)." : `Quarantine record not found: ${options.id} (HTTP 404).`);
    if (error instanceof ScoutBrokerHttpError && error.status === 503) throw new ScoutCliError("Quarantine storage is unavailable (HTTP 503). Retry the same observation or acknowledgement.");
    throw error;
  }
  if (options.json) { context.output.writeText(JSON.stringify(result, null, 2)); return; }
  context.output.writeValue(result, value => {
    if ("records" in value) return [
      `Quarantine: ${value.status.openCount} open, ${value.status.acknowledgedCount} acknowledged`,
      ...(value.records.length ? value.records.map(record =>
        `${record.id}  ${record.status}  ${record.kind}  ${record.bytes} bytes\n  ${record.reason}${record.scope.sessionIds.length ? `\n  Sessions: ${record.scope.sessionIds.join(", ")}` : ""}`)
        : [`No ${options.status} quarantine records${options.sessionId ? ` for session ${options.sessionId}` : ""}.`]),
    ].join("\n");
    if (options.command === "acknowledge") return `Acknowledged ${value.record.id}. Evidence remains stored; no work was retried.`;
    return JSON.stringify(value.record, null, 2);
  });
}
