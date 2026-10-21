import { normalizeMachineHostName, type NodeDefinition } from "@openscout/protocol";

/** Exact ids select one node; names/hostnames/tokens select every matching node. */
export function resolveScoutMachines(nodes: readonly NodeDefinition[], reference: string): NodeDefinition[] {
  const needle = reference.trim().toLowerCase();
  const byId = nodes.find((node) => node.id.toLowerCase() === needle);
  if (byId) return [byId];
  const names = (node: NodeDefinition): string[] => [node.name, node.hostName]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value.toLowerCase(), normalizeMachineHostName(value)]);
  const exact = nodes.filter((node) => names(node).includes(needle));
  const matches = exact.length ? exact : nodes.filter((node) => names(node)
    .some((name) => name.split(/[^a-z0-9]+/).includes(needle)));
  if (matches.length) return matches;
  throw new Error(`Unknown machine "${reference}". Known machines: ${nodes.map((node) => `${node.name} (${node.id})`).join(", ") || "none"}.`);
}
