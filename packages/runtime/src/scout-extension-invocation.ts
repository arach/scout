/** API-2 declarations only. Pure negotiation: no environment, filesystem or secret access. */
export const SCOUT_EXTENSION_CONTEXT_SCHEMA = "scout.extension-context/v1";
export const SCOUT_EXTENSION_CONTEXT_FEATURES = Object.freeze([
  "selection/v1", "web.selection/v1", "distribution.endpoint/v1", "pair.configuration/v1",
  "runtime.tools/v1", "menu.bootstrap/v1", "server.configuration/v1",
] as const);
export type ScoutExtensionContextFeature = typeof SCOUT_EXTENSION_CONTEXT_FEATURES[number];
export type ScoutExtensionInvocation = { context: typeof SCOUT_EXTENSION_CONTEXT_SCHEMA; requires: ScoutExtensionContextFeature[] };
export function parseScoutExtensionInvocation(value: unknown, executableCompletion: unknown): ScoutExtensionInvocation {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)
    || Object.keys(data).some(key => !["context", "requires", "credentialInputs"].includes(key))
    || data.context !== SCOUT_EXTENSION_CONTEXT_SCHEMA || !Array.isArray(data.requires) || data.requires.length > 7
    || new Set(data.requires).size !== data.requires.length
    || !data.requires.every(id => SCOUT_EXTENSION_CONTEXT_FEATURES.includes(id))
    || (data.credentialInputs !== undefined && (!Array.isArray(data.credentialInputs) || data.credentialInputs.length !== 0))
    || executableCompletion !== undefined) throw new Error("unsupported API-2 invocation declaration");
  return { context: SCOUT_EXTENSION_CONTEXT_SCHEMA, requires: [...data.requires] as ScoutExtensionContextFeature[] };
}
