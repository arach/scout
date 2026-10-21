/**
 * Source-level extraction of the broker HTTP route inventory ("METHOD path"),
 * shared by broker-daemon-route-inventory.test.ts (the checked-in snapshot)
 * and mesh-route-matrix.test.ts (the deny-by-default tier cross-check). Pure
 * string-in/string-out so tests supply the router sources. No handler is imported
 * or executed: the delegated closure is read through an injected source loader.
 */
import { posix } from "node:path";

export type LiteralRouteBranch = {
  method: string;
  path: string;
  line: number;
};

export function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function literalRouteBranches(source: string): LiteralRouteBranch[] {
  const branches: LiteralRouteBranch[] = [];
  const patterns = [
    /method\s*===\s*"([A-Z]+)"\s*&&\s*url\.pathname\s*===\s*"([^"]+)"/g,
    /url\.pathname\s*===\s*"([^"]+)"\s*&&\s*method\s*===\s*"([A-Z]+)"/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const method = pattern === patterns[0] ? match[1] : match[2];
      const path = pattern === patterns[0] ? match[2] : match[1];
      if (!method || !path) continue;
      branches.push({
        method,
        path,
        line: lineNumberAt(source, match.index ?? 0),
      });
    }
  }

  return branches;
}

function routePatternFromRegexSource(pattern: string): string {
  return pattern
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\(\?<([A-Za-z][A-Za-z0-9_]*)>\[\^\/\]\+\)/g, ":$1")
    .replaceAll("([^/]+)", ":id")
    .replaceAll("\\/", "/")
    .replaceAll("\\.", ".");
}

// Extracts every "METHOD path" route the router dispatches on, covering the
// dispatch shapes used in the router and delegated HTTP handlers:
//   - method === "M" && url.pathname === "P" (and the flipped order)
//   - method === "M" && (url.pathname === "P1" || url.pathname === "P2" || …)
//   - (url.pathname === "P1" || url.pathname === "P2") && method === "M"
//   - (method === "M1" || method === "M2") && url.pathname === "P"
//   - const xMatch = method === "M" [|| method === "M2" …] ? url.pathname.match(/…/) : null
//   - method === "M" && url.pathname.startsWith("P")
// Param captures ([^/]+) are rendered as ":id"; named captures retain their names.
export function extractRouteInventory(source: string): Set<string> {
  // Delegated handlers use request.method too. Resolve local literal path
  // constants without executing the module; an unresolved path must fail closed.
  let text = source.replace(/\brequest\.method\b/g, "method").replace(/\s+/g, " ");
  for (const constant of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*("[^"\n]+")\s*;/g)) {
    text = text.replace(new RegExp(`(url\\.pathname\\s*===\\s*)${constant[1]}\\b`, "g"), `$1${constant[2]}`);
  }
  const unresolved = text.match(/url\.pathname\s*===\s*([A-Za-z_$][\w$]*)/);
  if (unresolved) throw new Error(`Unresolved route path constant: ${unresolved[1]}`);
  const routes = new Set<string>();

  // const xMatch = method === "M" [|| method === "M2" …] ? url.pathname.match(/…/) : null
  for (const match of text.matchAll(
    /(method === "[A-Z]+"(?: \|\| method === "[A-Z]+")*) \? url\.pathname\.match\(\/([^ ]+?)\/\) : null/g,
  )) {
    const path = routePatternFromRegexSource(match[2] ?? "");
    for (const method of (match[1] ?? "").matchAll(/method === "([A-Z]+)"/g)) {
      routes.add(`${method[1]} ${path}`);
    }
  }

  // method === "M" && (url.pathname === "P1" || url.pathname === "P2" || …)
  for (const match of text.matchAll(
    /method === "([A-Z]+)" && \(([^()]*url\.pathname === [^()]*)\)/g,
  )) {
    for (const path of (match[2] ?? "").matchAll(/url\.pathname === "([^"]+)"/g)) {
      routes.add(`${match[1]} ${path[1]}`);
    }
  }

  // (url.pathname === "P1" || url.pathname === "P2") && method === "M"
  for (const match of text.matchAll(
    /\((url\.pathname === "[^"]+"(?: \|\| url\.pathname === "[^"]+")*)\) && method === "([A-Z]+)"/g,
  )) {
    for (const path of (match[1] ?? "").matchAll(/url\.pathname === "([^"]+)"/g)) {
      routes.add(`${match[2]} ${path[1]}`);
    }
  }

  // (method === "M1" || method === "M2") && url.pathname === "P"
  for (const match of text.matchAll(
    /\(method === "([A-Z]+)" \|\| method === "([A-Z]+)"\) && url\.pathname === "([^"]+)"/g,
  )) {
    routes.add(`${match[1]} ${match[3]}`);
    routes.add(`${match[2]} ${match[3]}`);
  }

  // method === "M" && url.pathname === "P" (and the flipped order)
  for (const match of text.matchAll(/method === "([A-Z]+)" && url\.pathname === "([^"]+)"/g)) {
    routes.add(`${match[1]} ${match[2]}`);
  }
  for (const match of text.matchAll(/url\.pathname === "([^"]+)" && method === "([A-Z]+)"/g)) {
    routes.add(`${match[2]} ${match[1]}`);
  }

  // method === "M" && url.pathname.startsWith("P")
  for (const match of text.matchAll(
    /method === "([A-Z]+)" && url\.pathname\.startsWith\("([^"]+)"\)/g,
  )) {
    routes.add(`${match[1]} ${match[2]}:id`);
  }

  return routes;
}

/** Follow called relative imports that receive the HTTP context, including
 * named aliases, namespace calls and nested delegation. handle* imports are
 * included even when their context is passed through a wrapper. Type-only and
 * unused imports do not create routes. Keep dispatch expressions in the
 * extraction forms above; dynamic path constants are deliberately refused. */
export function delegatedRouteInventory(readSource: (file: string) => string, entry = "broker-http-router.ts") {
  const sources = new Map<string, string>(), routes = new Set<string>();
  const visit = (file: string) => {
    if (sources.has(file)) return;
    const source = readSource(file); // Missing delegated source fails the gate.
    sources.set(file, source);
    for (const route of extractRouteInventory(source)) routes.add(route);
    for (const imported of source.matchAll(/^\s*import\s+(?!type\b)(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+"(\.\.?\/[^"\n]+)"/gm)) {
      const [, clause, specifier] = imported;
      const dependency = posix.join(posix.dirname(file), specifier!.replace(/\.js$/, ".ts"));
      const called = (name: string, handler: boolean) => {
        const identifier = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${identifier}\\s*\\(\\s*${handler ? "" : "(?:request\\b|response\\b|url\\b|\\{[^}]*\\b(?:request|response|url)\\b)"}`).test(source);
      };
      if (clause!.startsWith("*")) {
        const name = clause!.match(/as\s+(\w+)/)![1]!;
        const members = [...source.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\s*\\(`, "g"))];
        if (members.some(member => called(`${name}.${member[1]}`, /^handle[A-Z]/.test(member[1]!)))) visit(dependency);
      } else {
        const bindings = clause!.startsWith("{") ? clause!.slice(1, -1).split(",") : [clause!];
        if (bindings.some(binding => {
          if (/^\s*type\b/.test(binding)) return false;
          const [original, alias] = binding.trim().split(/\s+as\s+/);
          return !!original && called(alias ?? original, /^handle[A-Z]/.test(original));
        })) visit(dependency);
      }
    }
  };
  visit(entry);
  return { routes: [...routes].sort(), sources };
}
