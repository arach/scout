import { homedir } from "node:os";
import { resolveMeshBridgeExtension } from "./mesh-bridge-extension.js";
import { MESH_BRIDGE_INSTALL_FIX, meshBridgeSelectionRefusal, resolveMeshBridgeDesiredState, resolveMeshBridgeEntrypoint } from "./mesh-bridge-supervisor.js";

/** Read-only cutover gate. No credential values, child processes or service writes. */
export function inspectMeshBridgePreflight(input: {
  supportDirectory: string;
  env: NodeJS.ProcessEnv;
  home?: string;
}) {
  const desired = resolveMeshBridgeDesiredState({ ...input, home: input.home ?? homedir() });
  const selected = resolveMeshBridgeExtension(input.env);
  const invalid = !desired.run && desired.reason === "invalid-config";
  // A legacy owner defers supervision, not the requirement to migrate this machine.
  const enabled = invalid ? null : desired.run || desired.reason === "legacy-launch-agent";
  const refusal = meshBridgeSelectionRefusal(selected, input.env);
  const ok = !invalid && (!enabled || !refusal);
  return {
    ok,
    enabled,
    extensionState: selected.state,
    overrideConfigured: !!input.env.OPENSCOUT_MESH_BRIDGE_BIN?.trim(),
    overrideAvailable: resolveMeshBridgeEntrypoint({ env: input.env }) !== null,
    enabledWithoutExtension: enabled === null ? null : enabled && selected.state !== "ready",
    reason: invalid ? "invalid-config" : enabled && refusal ? refusal : desired.run ? "ready" : desired.reason,
    fix: ok ? null : invalid ? "Repair the bridge configuration in this instance's support directory, then rerun openscout-runtime mesh-bridge-preflight. No configuration or credentials were printed." : MESH_BRIDGE_INSTALL_FIX,
  };
}
