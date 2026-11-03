export {};

/** Product-free Inspector v3 diagnostic. No heap snapshot is published by this tool.
 * Based on Fable's retainer walk; validate stride and exhaust the ancestor graph,
 * rather than classifying from a few sampled paths or from the prototype object. */
export async function walkRetainers(file: string) {
const snapshot = JSON.parse(await Bun.file(file).text());
if (snapshot.version !== 3 || snapshot.type !== "Inspector") throw Error("unsupported heap snapshot format");
const {nodes, nodeClassNames, edges, edgeTypes, edgeNames} = snapshot;
const fields = 4; // Inspector v3: [id, size, classNameIndex, flags], NOT five.
if (nodes.length % fields || edges.length % 4) throw Error("misaligned heap snapshot");
const classes = new Map<number, string>();
for (let n = 0; n < nodes.length; n += fields) {
  const name = nodeClassNames[nodes[n + 2]];
  if (typeof name !== "string" || classes.has(nodes[n])) throw Error("invalid heap node");
  classes.set(nodes[n], name);
}
type Edge = {from: number; to: number; type: string; name: string};
const incoming = new Map<number, Edge[]>(), outgoing = new Map<number, Edge[]>();
for (let n = 0; n < edges.length; n += 4) {
  const from = edges[n], to = edges[n + 1], type = edgeTypes[edges[n + 2]];
  if (!classes.has(from) || !classes.has(to) || !["Internal", "Property", "Index", "Variable"].includes(type)) throw Error("invalid heap edge");
  const name = type === "Property" || type === "Variable" ? String(edgeNames[edges[n + 3]]) : String(edges[n + 3]);
  const edge = {from, to, type, name};
  (incoming.get(to) ?? incoming.set(to, []).get(to)!).push(edge);
  (outgoing.get(from) ?? outgoing.set(from, []).get(from)!).push(edge);
}
// The Subprocess prototype shares its class name. Only a ChildProcess.#handle
// instance is the survivor whose lifetime this Node-compat witness observes.
const targets = [...classes].filter(([id, name]) => name === "Subprocess" && incoming.get(id)?.some(e =>
  classes.get(e.from) === "ChildProcess" && e.type === "Property" && e.name === "#handle")).map(([id]) => id);
if (!targets.length) { console.log(JSON.stringify({event: "no-subprocess-instance"})); process.exitCode = 1; }
for (const target of targets) {
  const seen = new Set<number>([target]), queue = [target], path = new Map<number, Edge[]>(), roots: number[] = [];
  path.set(target, []);
  for (let n = 0; n < queue.length; n++) {
    const id = queue[n]!;
    // Inspector includes the WeakRef's internal target edge for inspection.
    // That edge does not retain. Custom properties and registry held-value
    // paths ARE strong and must stay traversable (including a leaked target).
    const parents = (incoming.get(id) ?? []).filter(e => !(classes.get(id) === "Subprocess"
      && classes.get(e.from) === "WeakRef" && e.type === "Internal"));
    if (id === 0 || !parents.length) { roots.push(id); continue; }
    for (const edge of parents) if (!seen.has(edge.from)) {
      seen.add(edge.from); queue.push(edge.from); path.set(edge.from, [edge, ...path.get(id)!]);
    }
  }
  const counts: Record<string, number> = {}, variables: Array<{id: number; names: string[]}> = [];
  for (const id of seen) {
    const name = classes.get(id)!; counts[name] = (counts[name] ?? 0) + 1;
    if (name === "JSLexicalEnvironment") variables.push({id, names: (outgoing.get(id) ?? []).filter(e => e.type === "Variable").map(e => e.name)});
  }
  const vmOnly = roots.length > 0 && roots.every(id => classes.get(id) === "FunctionCodeBlock")
    && Object.keys(counts).every(name => ["Subprocess", "ChildProcess", "Function", "JSLexicalEnvironment", "FunctionCodeBlock", "Object", "Array"].includes(name))
    && variables.every(v => v.names.every(name => name === "this"));
  console.log(JSON.stringify({event: "retainer-summary", target, classification: vmOnly ? "vm-codeblock-pin" : "unclassified",
    exhaustive: true, roots: roots.map(id => ({id, class: classes.get(id)})), ancestorClasses: counts, lexicalVariables: variables}));
  for (const root of roots) console.log(`ROOT PATH:\n  ${path.get(root)!.map(e => `${classes.get(e.from)}#${e.from} -[${e.type}:${e.name}]->`).join("\n  ")}\n  Subprocess#${target}`);
  if (!vmOnly) process.exitCode = 1;
}

}
if (import.meta.main) await walkRetainers(process.argv[2]!);
