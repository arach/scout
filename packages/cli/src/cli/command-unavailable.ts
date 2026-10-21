import { ScoutCliError } from "./errors.ts";
import { findScoutExtension, type ScoutExtension, type ScoutExtensionRefusalReason } from "./extensions.ts";
import type { ScoutCommandRegistration } from "./registry.ts";

export const SCOUT_COMMAND_UNAVAILABLE_EXIT_CODE = 69;
export const SCOUT_COMMAND_UNAVAILABLE_SCHEMA = "scout.cli.command-unavailable/v1";
export type ScoutCommandUnavailableReason = "missing" | "tombstoned" | ScoutExtensionRefusalReason;

/** Reserved names are never implicit asks, even when their artifact is unavailable. */
export class ScoutCommandUnavailableError extends ScoutCliError {
  readonly exitCode = SCOUT_COMMAND_UNAVAILABLE_EXIT_CODE;

  constructor(readonly command: string, readonly reason: ScoutCommandUnavailableReason, guidance: string) {
    super(`scout ${command} is unavailable (${reason}). ${guidance}`.trim());
    this.name = "ScoutCommandUnavailableError";
  }

  toJSON() {
    return { schema: SCOUT_COMMAND_UNAVAILABLE_SCHEMA, error: "command_unavailable", command: this.command, reason: this.reason };
  }
}

/** Read-only resolution. The caller must do this before automatic maintenance. */
export function resolveReservedScoutExtension(registration: ScoutCommandRegistration, env: NodeJS.ProcessEnv): ScoutExtension {
  const extension = findScoutExtension(registration.name, env);
  const reason = !extension ? "missing" : extension.removed ? "tombstoned" : extension.refused ? extension.refusalReason ?? "refused" : undefined;
  if (reason) {
    throw new ScoutCommandUnavailableError(registration.name, reason,
      [extension?.refused, registration.install ?? "Install or repair the matching extension for the selected Scout instance."].filter(Boolean).join(" "));
  }
  return extension!;
}

/** One JSON object on stderr; prose remains guidance, not a machine interface. */
export function renderScoutCommandUnavailable(error: ScoutCommandUnavailableError, json: boolean): string {
  return json ? JSON.stringify(error.toJSON()) : `error: ${error.message}`;
}
