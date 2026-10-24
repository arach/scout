// The host has one router. Pin the former procedure union and, when the
// private iOS source overlay is available, verify its native wire map.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeRouter } from "./router.ts";

const REPO_ROOT = join(import.meta.dir, "../../../../../../..");
const IOS_CORE_SOURCES_DIR = join(REPO_ROOT, "packages/scout-ios-core/Sources/ScoutIOSCore");
const RPC_WIRE_PATH = join(IOS_CORE_SOURCES_DIR, "RPCWire.swift");

// The private Swift overlay must not carry unused route-map entries.
const KNOWN_DEAD_ROUTE_MAP_ENTRIES: string[] = [];

// ---------------------------------------------------------------------------
// tRPC router enumeration
// ---------------------------------------------------------------------------

type TRPCProcedureKind = "query" | "mutation" | "subscription";

const TRPC_PROCEDURE_KINDS: readonly TRPCProcedureKind[] = ["query", "mutation", "subscription"];

type RouterLike = {
  _def: {
    procedures: Record<string, unknown>;
  };
};

// tRPC v11 keeps a flat map of dotted procedure paths ("mobile.sessions") on
// the router's `_def.procedures` — the same surface createCaller and the wire
// handler dispatch through. It is internal API, so fail loudly (rather than
// passing vacuously) if an upgrade moves it.
function procedureKinds(router: RouterLike, label: string): Map<string, TRPCProcedureKind> {
  const kinds = new Map<string, TRPCProcedureKind>();

  for (const [path, procedure] of Object.entries(router._def.procedures)) {
    const kind = (procedure as { _def?: { type?: unknown } })._def?.type;
    if (!TRPC_PROCEDURE_KINDS.includes(kind as TRPCProcedureKind)) {
      throw new Error(
        `${label} procedure ${path} has unrecognized kind ${JSON.stringify(kind)} — did a tRPC upgrade move _def.type?`,
      );
    }
    kinds.set(path, kind as TRPCProcedureKind);
  }

  if (!kinds.has("bridgeStatus") || kinds.size === 0) {
    throw new Error(
      `${label} router enumeration looks broken (${kinds.size} procedures, no bridgeStatus) — did a tRPC upgrade move _def.procedures?`,
    );
  }

  return kinds;
}

// ---------------------------------------------------------------------------
// RPCWire.swift route map extraction
// ---------------------------------------------------------------------------

type SwiftRoute = {
  logicalName: string;
  path: string;
  method: TRPCProcedureKind;
  line: number;
};

// One dictionary entry, e.g.:
//   "mobile/sessions":         TRPCRoute(path: "mobile.sessions",        method: .query),
const SWIFT_ROUTE_ENTRY_PATTERN =
  /^"([^"]+)":\s*TRPCRoute\(path:\s*"([^"]+)",\s*method:\s*\.(query|mutation|subscription)\),?$/;

// Structured scan of the `trpcRouteMap` literal: every non-comment line
// between the declaration and the closing `]` must parse as a route entry, so
// a reformat breaks the test loudly instead of silently extracting nothing.
// Returns the entries plus the source with the literal blanked out (used by
// the dead-entry scan so the map itself never counts as a "reference").
function extractTrpcRouteMap(source: string): { routes: SwiftRoute[]; sourceWithoutMap: string } {
  const lines = source.split("\n");
  const headerIndex = lines.findIndex((line) =>
    /^(?:public\s+|internal\s+)?let trpcRouteMap: \[String: TRPCRoute\] = \[$/.test(line.trim()),
  );
  if (headerIndex === -1) {
    throw new Error(`Could not find the trpcRouteMap literal in ${RPC_WIRE_PATH} — update the extraction.`);
  }

  const routes: SwiftRoute[] = [];
  let closingIndex = -1;

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === "]") {
      closingIndex = index;
      break;
    }
    if (trimmed === "" || trimmed.startsWith("//")) continue;

    const match = trimmed.match(SWIFT_ROUTE_ENTRY_PATTERN);
    if (!match) {
      throw new Error(
        `Unparseable trpcRouteMap entry at RPCWire.swift:${index + 1}: ${JSON.stringify(trimmed)} — update the extraction.`,
      );
    }
    routes.push({
      logicalName: match[1],
      path: match[2],
      method: match[3] as TRPCProcedureKind,
      line: index + 1,
    });
  }

  if (closingIndex === -1) {
    throw new Error(`trpcRouteMap literal in ${RPC_WIRE_PATH} never closed — update the extraction.`);
  }
  if (routes.length === 0) {
    throw new Error(`trpcRouteMap literal in ${RPC_WIRE_PATH} parsed to zero entries — update the extraction.`);
  }

  const duplicates = routes
    .map((route) => route.logicalName)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate trpcRouteMap logical names: ${duplicates.join(", ")}`);
  }

  const sourceWithoutMap = [
    ...lines.slice(0, headerIndex),
    ...lines.slice(closingIndex + 1),
  ].join("\n");

  return { routes, sourceWithoutMap };
}

// Concatenated Swift sources of the iOS core (Sources/ only — a route name
// quoted in Tests/ does not make it live), with the trpcRouteMap literal
// itself removed. A logical name is "live" if its quoted string appears
// anywhere in here (e.g. `connection.rpc("mobile/sessions", …)`).
function iosCoreSourcesWithoutRouteMap(sourceWithoutMap: string): string {
  const chunks: string[] = [];
  for (const entry of readdirSync(IOS_CORE_SOURCES_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".swift")) continue;
    const filePath = join(entry.parentPath, entry.name);
    chunks.push(filePath === RPC_WIRE_PATH ? sourceWithoutMap : readFileSync(filePath, "utf8"));
  }
  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// The iOS core sources are private; source-only checkouts keep the
// web/desktop comparisons and skip the Swift-legged tripwires.
const hasIosCoreSources = existsSync(RPC_WIRE_PATH);
const { routes: swiftRoutes, sourceWithoutMap } = hasIosCoreSources
  ? extractTrpcRouteMap(readFileSync(RPC_WIRE_PATH, "utf8"))
  : { routes: [], sourceWithoutMap: "" };
const webProcedures = procedureKinds(bridgeRouter, "canonical web");

describe("iOS RPC drift tripwire", () => {
  test("the canonical host preserves the web and desktop procedure union", () => {
    for (const route of ["history.snapshot", "mobile.askSession", "mobile.askSessionDurable", "mobile.commsMarkRead", "mobile.heartrate", "mobile.meshStatus", "mobile.sessionUpdate", "mobile.tail", "tail.events"]) {
      expect(webProcedures.has(route)).toBe(true);
    }
    expect(webProcedures.get("tail.events")).toBe("subscription");
  });
  test.skipIf(!hasIosCoreSources)("every trpcRouteMap entry resolves to a canonical bridge procedure with a matching method", () => {
    const problems: string[] = [];

    for (const route of swiftRoutes) {
      const kind = webProcedures.get(route.path);
      if (!kind) {
        problems.push(
          `${route.logicalName} -> ${route.path} (RPCWire.swift:${route.line}) has no procedure in the canonical router`,
        );
      } else if (kind !== route.method) {
        problems.push(
          `${route.logicalName} -> ${route.path} (RPCWire.swift:${route.line}) is .${route.method} in Swift but a ${kind} on the router`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  test.skipIf(!hasIosCoreSources)("route map entries no Swift code invokes stay pinned to the known-dead list", () => {
    const liveSources = iosCoreSourcesWithoutRouteMap(sourceWithoutMap);
    const deadEntries = swiftRoutes
      .map((route) => route.logicalName)
      .filter((name) => !liveSources.includes(`"${name}"`))
      .sort();

    // Failing with an EXTRA entry: a new route map entry nobody calls —
    // remove it (or wire up its caller). Failing with a MISSING entry: the
    // dead entry was cleaned up — prune KNOWN_DEAD_ROUTE_MAP_ENTRIES too.
    expect(deadEntries).toEqual([...KNOWN_DEAD_ROUTE_MAP_ENTRIES].sort());
  });

});
