import { findScoutExtension, type ScoutExtension } from "@openscout/runtime/scout-extensions";
import { ScoutCommandUnavailableError } from "./command-unavailable.ts";
import type { ScoutExtensionContext } from "./extension-context.ts";
import { assertScoutExtensionInputGrant, inputRefusal, scoutExtensionGrantId, scoutExtensionInputBinding, type ExtensionInputSelection } from "./extension-input-grants.ts";

export const EXTENSION_INPUT_REQUEST_SCHEMA = "scout.extension-input-request/v1";
export const EXTENSION_INPUT_RESPONSE_SCHEMA = "scout.extension-inputs/v1";
export const EXTENSION_INPUT_LIMITS = Object.freeze({ request: 4096, response: 16384, value: 8192, milliseconds: 5000 });
export type ExtensionInputMetadata = { id: "distribution-key"; present: boolean; treeDigest: string; declarationDigest: string; destination: { origin: string; basePath: string } };
export type ExtensionInputResponse = { schema: typeof EXTENSION_INPUT_RESPONSE_SCHEMA; id: "distribution-key"; treeDigest: string; declarationDigest: string;
  destination: { origin: string; basePath: string }; status: "absent" | "provided" | "refused"; value?: string; reason?: string };

/** The raw named value stays in this parent closure. No store lookup or eager grant check. */
export function prepareScoutExtensionInputSession(extension: ScoutExtension, frame: ScoutExtensionContext, selectionEnv: NodeJS.ProcessEnv, selectionStillCurrent: () => boolean) {
  if (!extension.invocation?.credentialInputs?.length) return undefined;
  const selection: ExtensionInputSelection = { uid: frame.selection.uid, home: frame.selection.home, instance: frame.selection.instance,
    instanceRoot: frame.selection.instanceRoot, scoutHome: frame.paths.scoutHome, endpoint: frame.configuration["distribution.endpoint/v1"]?.endpoint?.value ?? undefined };
  const binding = scoutExtensionInputBinding(extension, selectionEnv, selection);
  if (binding.treeDigest !== frame.extensions.treeDigest || binding.extensionRoot.path !== frame.extensions.selectedRoot) inputRefusal(extension.name, "selection_changed");
  const policyEnv: NodeJS.ProcessEnv = { HOME: frame.selection.home, SCOUT_HOME: frame.paths.scoutHome, OPENSCOUT_HOME: frame.paths.openScoutHome,
    OPENSCOUT_EXTENSIONS_HOME: selectionEnv.OPENSCOUT_EXTENSIONS_HOME };
  const frozenRaw = selectionEnv.SCOUT_DIST_KEY;
  const present = typeof frozenRaw === "string" && frozenRaw.trim().length > 0;
  const metadata: ExtensionInputMetadata = { id: "distribution-key", present, treeDigest: binding.treeDigest, declarationDigest: binding.declarationDigest, destination: { ...binding.destination } };
  let requested = false;
  const revalidate = () => {
    try {
    if (!selectionStillCurrent()) inputRefusal(extension.name, "selection_changed");
    if (selectionEnv.SCOUT_DIST_KEY !== frozenRaw) inputRefusal(extension.name, "input_source_changed");
    const current = findScoutExtension(extension.name, selectionEnv);
    if (!current || current.refused) inputRefusal(extension.name, "selection_changed");
    const fresh = scoutExtensionInputBinding(current, selectionEnv, { ...selection, endpoint: selectionEnv.OPENSCOUT_DIST_URL });
    if (scoutExtensionGrantId(fresh) !== scoutExtensionGrantId(binding)) inputRefusal(extension.name, "selection_changed");
    } catch (error) { if (error instanceof ScoutCommandUnavailableError) throw error; inputRefusal(extension.name, "selection_changed"); }
  };
  const response = (status: ExtensionInputResponse["status"]): ExtensionInputResponse => ({ schema: EXTENSION_INPUT_RESPONSE_SCHEMA, id: metadata.id, treeDigest: metadata.treeDigest, declarationDigest: metadata.declarationDigest, destination: { ...metadata.destination }, status });
  return {
    metadata,
    request(value: unknown): ExtensionInputResponse {
      if (requested) inputRefusal(extension.name, "input_protocol_invalid");
      requested = true;
      const data = value as Record<string, unknown> | null;
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 3
        || data.schema !== EXTENSION_INPUT_REQUEST_SCHEMA || data.id !== metadata.id || data.treeDigest !== metadata.treeDigest) inputRefusal(extension.name, "input_protocol_invalid");
      revalidate();
      if (!present) return response("absent");
      // This is intentionally a fresh read under the same lock used by revoke.
      assertScoutExtensionInputGrant(policyEnv, binding, revalidate);
      if (Buffer.byteLength(frozenRaw!, "utf8") > EXTENSION_INPUT_LIMITS.value || /[\p{Cc}\p{Cf}]/u.test(frozenRaw!)
        || Buffer.from(frozenRaw!, "utf8").toString("utf8") !== frozenRaw) inputRefusal(extension.name, "input_value_invalid");
      return { ...response("provided"), value: frozenRaw! };
    },
    refusal(error: ScoutCommandUnavailableError): ExtensionInputResponse { return { ...response("refused"), reason: error.reason }; },
  };
}
export type ScoutExtensionInputSession = NonNullable<ReturnType<typeof prepareScoutExtensionInputSession>>;
export function encodeScoutExtensionInputResponse(response: ExtensionInputResponse, command = "extensions"): Buffer {
  if (response.status !== "provided" && Object.hasOwn(response, "value")) inputRefusal(command, "input_protocol_invalid");
  const wire = Buffer.from(JSON.stringify(response) + "\n");
  if (wire.length > EXTENSION_INPUT_LIMITS.response) inputRefusal(command, "input_value_invalid");
  return wire;
}
