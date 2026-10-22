/** API-2 declarations only. Pure negotiation: no environment, filesystem or secret access. */
export const SCOUT_EXTENSION_CONTEXT_SCHEMA = "scout.extension-context/v1";
export const SCOUT_EXTENSION_INPUT_SCHEMA = "scout.extension-inputs/v1";
export const SCOUT_EXTENSION_CONTEXT_FEATURES = Object.freeze([
  "selection/v1", "web.selection/v1", "distribution.endpoint/v1", "pair.configuration/v1",
  "runtime.tools/v1", "menu.bootstrap/v1", "server.configuration/v1",
] as const);
export type ScoutExtensionContextFeature = typeof SCOUT_EXTENSION_CONTEXT_FEATURES[number];
export type ScoutExtensionCredentialDeclaration = {
  id: "distribution-key"; source: { kind: "environment"; name: "SCOUT_DIST_KEY" };
  presence: "optional"; destination: "distribution"; purpose: string;
};
export type ScoutExtensionDestinationDeclaration = { id: "distribution"; defaultUrl: string; overrideProjection: "distribution.endpoint/v1" };
export type ScoutExtensionInvocation = {
  context: typeof SCOUT_EXTENSION_CONTEXT_SCHEMA; requires: ScoutExtensionContextFeature[];
  inputSchema?: typeof SCOUT_EXTENSION_INPUT_SCHEMA;
  credentialInputs?: ScoutExtensionCredentialDeclaration[];
  destinations?: ScoutExtensionDestinationDeclaration[];
};
export function normalizeScoutExtensionDestination(value: string): { origin: string; basePath: string } {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) throw new Error("invalid destination");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid destination");
  return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, "") || "/" };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
export function parseScoutExtensionInvocation(value: unknown, executableCompletion: unknown): ScoutExtensionInvocation {
  const invalid = () => new Error("unsupported API-2 invocation declaration");
  if (!record(value) || !keys(value, ["context", "requires", "credentialInputs", "inputSchema", "destinations"])
    || value.context !== SCOUT_EXTENSION_CONTEXT_SCHEMA || !Array.isArray(value.requires) || value.requires.length > 7
    || new Set(value.requires).size !== value.requires.length
    || !value.requires.every(id => SCOUT_EXTENSION_CONTEXT_FEATURES.includes(id))
    || executableCompletion !== undefined) throw invalid();
  const base: ScoutExtensionInvocation = { context: SCOUT_EXTENSION_CONTEXT_SCHEMA, requires: [...value.requires] as ScoutExtensionContextFeature[] };
  if (value.credentialInputs !== undefined && !Array.isArray(value.credentialInputs)) throw invalid();
  const inputs = value.credentialInputs as unknown[] | undefined;
  if (!inputs?.length) {
    if (value.inputSchema !== undefined || value.destinations !== undefined) throw invalid();
    return base;
  }
  if (inputs.length !== 1 || value.inputSchema !== SCOUT_EXTENSION_INPUT_SCHEMA || !Array.isArray(value.destinations) || value.destinations.length !== 1) throw invalid();
  const input = inputs[0], destination = value.destinations[0];
  if (!record(input) || !keys(input, ["id", "source", "presence", "destination", "purpose"])
    || input.id !== "distribution-key" || input.presence !== "optional" || input.destination !== "distribution"
    || !record(input.source) || !keys(input.source, ["kind", "name"]) || input.source.kind !== "environment" || input.source.name !== "SCOUT_DIST_KEY"
    || typeof input.purpose !== "string" || !input.purpose.trim() || input.purpose.length > 240 || /[\x00-\x1f\x7f]/.test(input.purpose)
    || !record(destination) || !keys(destination, ["id", "defaultUrl", "overrideProjection"])
    || destination.id !== "distribution" || destination.overrideProjection !== "distribution.endpoint/v1"
    || typeof destination.defaultUrl !== "string" || !base.requires.includes("distribution.endpoint/v1")) throw invalid();
  try { normalizeScoutExtensionDestination(destination.defaultUrl); } catch { throw invalid(); }
  return { ...base, inputSchema: SCOUT_EXTENSION_INPUT_SCHEMA,
    credentialInputs: [{ id: input.id, source: { kind: "environment", name: "SCOUT_DIST_KEY" }, presence: input.presence, destination: input.destination, purpose: input.purpose }],
    destinations: [{ id: destination.id, defaultUrl: destination.defaultUrl, overrideProjection: destination.overrideProjection }] };
}
