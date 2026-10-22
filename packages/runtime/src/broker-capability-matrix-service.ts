import type { RuntimeEnv } from "./portable-types.js";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import type { ScoutCapabilityMatrixSnapshot } from "@openscout/protocol";

import {
  buildHarnessReadinessProbeInputsFromCatalogSnapshot,
  buildHarnessSupportInputsFromCatalogSnapshot,
  buildRuntimeCapabilityMatrixSnapshot,
} from "./capability-matrix.js";
import {
  loadHarnessCatalogSnapshot,
  type HarnessCatalogSnapshot,
} from "./harness-catalog.js";
import {
  discoverConfiguredMcpServers,
  createStdioMcpDiscoveryTransport,
  type McpDiscoveryJsonRpcTransport,
} from "./mcp-discovery.js";
import {
  loadRuntimeMcpServerCatalog,
  resolveRuntimeMcpServerCatalogPath,
  type RuntimeMcpServerCatalogLoadResult,
} from "./mcp-server-catalog.js";
import {
  loadRuntimeModelCatalogInput,
  resolveRuntimeModelCatalogPath,
  type RuntimeModelCatalogLoadResult,
} from "./model-catalog.js";
import { resolveOpenScoutSupportPaths } from "./support-paths.js";

export const DEFAULT_CAPABILITY_MATRIX_CACHE_TTL_MS = 60_000;
/** Explicit force can replace an older refresh; this is not a command timer. */
export const CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS = 120_000;

export type BrokerCapabilityMatrixServiceOptions = {
  nodeId: string;
  env?: RuntimeEnv;
  now?: () => number;
  monotonicNow?: () => number;
  cachePath?: () => string;
  readTextFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeTextFile?: (
    path: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;
  ensureDirectory?: (
    path: string,
    options: { recursive: true },
  ) => Promise<unknown>;
  renameFile?: (from: string, to: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  loadHarnessCatalogSnapshot?: (options: {
    now: () => number;
    env?: RuntimeEnv;
    overridePath?: string;
    signal?: AbortSignal;
  }) => Promise<HarnessCatalogSnapshot>;
  loadRuntimeModelCatalogInput?: (options: {
    capturedAt: number;
    path?: string;
  }) => Promise<RuntimeModelCatalogLoadResult>;
  loadRuntimeMcpServerCatalog?: (options?: {
    path?: string;
  }) => Promise<RuntimeMcpServerCatalogLoadResult>;
  discoverConfiguredMcpServers?: typeof discoverConfiguredMcpServers;
};

export function resolveCapabilityMatrixCacheTtlMs(
  env: RuntimeEnv = process.env,
): number {
  const raw = env.OPENSCOUT_CAPABILITY_MATRIX_CACHE_TTL_MS?.trim();
  if (!raw) {
    return DEFAULT_CAPABILITY_MATRIX_CACHE_TTL_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_CAPABILITY_MATRIX_CACHE_TTL_MS;
}

export function defaultCapabilityMatrixCachePath(): string {
  return join(resolveOpenScoutSupportPaths().runtimeDirectory, "capability-matrix.json");
}

export function isCapabilityMatrixSnapshot(value: unknown): value is ScoutCapabilityMatrixSnapshot {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { generatedAt?: unknown }).generatedAt === "number"
    && Array.isArray((value as { sources?: unknown }).sources)
    && Array.isArray((value as { capabilities?: unknown }).capabilities)
    && Array.isArray((value as { warnings?: unknown }).warnings);
}

export function capabilityMatrixSnapshotIsFresh(
  snapshot: ScoutCapabilityMatrixSnapshot,
  now: number,
  ttlMs: number,
): boolean {
  return ttlMs > 0
    && Number.isFinite(snapshot.generatedAt)
    && now - snapshot.generatedAt >= 0
    && now - snapshot.generatedAt <= ttlMs;
}

type MatrixSnapshot = ScoutCapabilityMatrixSnapshot;
type Flight = {
  phase: "cache" | "refresh";
  controller: AbortController;
  promise: Promise<MatrixSnapshot>;
  resolve: (snapshot: MatrixSnapshot) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  joinedAt: number;
};

export class BrokerCapabilityMatrixService {
  private cache: MatrixSnapshot | null = null;
  private flight: Flight | null = null;
  private stopped = false;
  // Serializes already-issued filesystem commits, not diagnostic evaluation.
  private commitTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: BrokerCapabilityMatrixServiceOptions) {}

  read(options: { force?: boolean } = {}): Promise<MatrixSnapshot> {
    try {
      if (this.stopped)
        throw this.abortError("Capability matrix service stopped.");
      const now = this.now();
      const ttl = resolveCapabilityMatrixCacheTtlMs(this.options.env);
      if (
        !options.force &&
        this.cache &&
        capabilityMatrixSnapshotIsFresh(this.cache, now, ttl)
      ) {
        return Promise.resolve(this.cache);
      }
      const current = this.flight;
      if (current) {
        if (options.force && current.phase === "cache")
          this.startRefresh(current);
        else if (
          options.force &&
          this.monotonicNow() - current.joinedAt >=
            CAPABILITY_MATRIX_REFRESH_JOIN_MAX_AGE_MS
        ) {
          // Reserve the replacement before abort listeners can reenter read().
          const replacement = this.reserveFlight();
          this.cancel(
            current,
            this.abortError("Capability matrix refresh superseded."),
          );
          if (this.current(replacement)) this.startRefresh(replacement);
          return replacement.promise;
        }
        return current.promise;
      }
      const flight = this.reserveFlight();
      if (options.force) this.startRefresh(flight);
      else this.startCacheRead(flight, now, ttl);
      return flight.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Reject waiters immediately. Abort requests direct-child cleanup, not
   * subtree custody; no diagnostic or filesystem promise is joined here. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cache = null;
    const current = this.flight;
    this.flight = null;
    if (current)
      this.cancel(
        current,
        this.abortError("Capability matrix service stopped."),
      );
  }

  private reserveFlight(): Flight {
    let resolve!: Flight["resolve"], reject!: Flight["reject"];
    const promise = new Promise<MatrixSnapshot>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Also observe terminal rejection when a request owner disappears.
    void promise.catch(() => undefined);
    const flight: Flight = {
      phase: "cache",
      controller: new AbortController(),
      promise,
      resolve,
      reject,
      settled: false,
      joinedAt: this.monotonicNow(),
    };
    this.flight = flight;
    return flight;
  }

  private current(flight: Flight): boolean {
    return (
      !this.stopped &&
      this.flight === flight &&
      !flight.settled &&
      !flight.controller.signal.aborted
    );
  }

  private assertCurrent(flight: Flight): void {
    if (!this.current(flight))
      throw (
        flight.controller.signal.reason ??
        this.abortError("Capability matrix refresh retired.")
      );
  }

  private cancel(flight: Flight, error: unknown): void {
    if (flight.settled) return;
    flight.settled = true;
    flight.reject(error);
    flight.controller.abort(error);
  }

  private fail(flight: Flight, error: unknown): void {
    if (!this.current(flight)) return;
    this.flight = null;
    this.cancel(flight, error);
  }

  private complete(flight: Flight, snapshot: MatrixSnapshot): void {
    if (!this.current(flight)) return;
    this.cache = snapshot;
    this.flight = null;
    flight.settled = true;
    flight.resolve(snapshot);
  }

  private startCacheRead(flight: Flight, now: number, ttl: number): void {
    let path: string;
    try {
      path = this.cachePath();
    } catch (error) {
      this.fail(flight, error);
      return;
    }
    // A forced read promotes this same public promise without waiting for disk.
    void this.readPersisted(path, now, ttl).then(
      (snapshot) => {
        if (!this.current(flight) || flight.phase !== "cache") return;
        if (snapshot) this.complete(flight, snapshot);
        else this.startRefresh(flight);
      },
      (error) => this.fail(flight, error),
    );
  }

  private startRefresh(flight: Flight): void {
    if (!this.current(flight) || flight.phase === "refresh") return;
    try {
      flight.phase = "refresh";
      flight.joinedAt = this.monotonicNow();
      // Capture real diagnostic inputs at refresh start. options.env retains
      // its previous cache-TTL meaning, not a new harness environment policy.
      const env = { ...process.env };
      const now = this.now();
      const paths = {
        cache: this.cachePath(),
        harness: resolveOpenScoutSupportPaths().harnessCatalogPath,
        model: resolveRuntimeModelCatalogPath(),
        mcp: resolveRuntimeMcpServerCatalogPath(),
      };
      const ttl = resolveCapabilityMatrixCacheTtlMs(this.options.env);
      void this.refresh(flight, now, env, paths, ttl).then(
        (snapshot) => this.complete(flight, snapshot),
        (error) => this.fail(flight, error),
      );
    } catch (error) {
      this.fail(flight, error);
    }
  }

  private async refresh(
    flight: Flight,
    now: number,
    env: RuntimeEnv,
    paths: { cache: string; harness: string; model: string; mcp: string },
    ttl: number,
  ): Promise<MatrixSnapshot> {
    this.assertCurrent(flight);
    const catalog = await (
      this.options.loadHarnessCatalogSnapshot ?? loadHarnessCatalogSnapshot
    )({
      now: () => now,
      env,
      overridePath: paths.harness,
      signal: flight.controller.signal,
    });
    this.assertCurrent(flight);
    const modelCatalog = await (
      this.options.loadRuntimeModelCatalogInput ?? loadRuntimeModelCatalogInput
    )({ capturedAt: now, path: paths.model });
    this.assertCurrent(flight);
    const mcpCatalog = await (
      this.options.loadRuntimeMcpServerCatalog ?? loadRuntimeMcpServerCatalog
    )({ path: paths.mcp });
    this.assertCurrent(flight);
    const mcpDiscovery =
      mcpCatalog.servers.length > 0
        ? await (
            this.options.discoverConfiguredMcpServers ??
            discoverConfiguredMcpServers
          )({
            servers: mcpCatalog.servers,
            scope: { machineId: this.options.nodeId },
            now: () => now,
            createTransport: (server) =>
              this.ownedTransport(flight, server, env),
          })
        : { inputs: [], warnings: [] };
    this.assertCurrent(flight);
    const snapshot = buildRuntimeCapabilityMatrixSnapshot({
      generatedAt: catalog.generatedAt,
      scope: { machineId: this.options.nodeId },
      inputs: [
        ...buildHarnessSupportInputsFromCatalogSnapshot(catalog),
        ...buildHarnessReadinessProbeInputsFromCatalogSnapshot(catalog),
        ...mcpDiscovery.inputs,
        ...(modelCatalog.input ? [modelCatalog.input] : []),
      ],
      warnings: [
        ...mcpCatalog.warnings,
        ...mcpDiscovery.warnings,
        ...modelCatalog.warnings,
      ],
    });
    if (ttl > 0) await this.writePersisted(flight, paths.cache, snapshot);
    this.assertCurrent(flight);
    return snapshot;
  }

  private ownedTransport(
    flight: Flight,
    server: Parameters<typeof createStdioMcpDiscoveryTransport>[0],
    env: RuntimeEnv,
  ): McpDiscoveryJsonRpcTransport {
    this.assertCurrent(flight);
    const transport = createStdioMcpDiscoveryTransport(server, { env });
    const signal = flight.controller.signal;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      signal.removeEventListener("abort", abort);
      if (!closing) closing = Promise.resolve().then(() => transport.close());
      return closing;
    };
    const abort = () => {
      void close().catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return {
      request: (method, params) => {
        this.assertCurrent(flight);
        return transport.request(method, params);
      },
      notify: (method, params) => {
        this.assertCurrent(flight);
        return transport.notify(method, params);
      },
      close,
    };
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private monotonicNow(): number {
    return (this.options.monotonicNow ?? (() => performance.now()))();
  }
  private cachePath(): string {
    return (this.options.cachePath ?? defaultCapabilityMatrixCachePath)();
  }
  private abortError(message: string): DOMException {
    return new DOMException(message, "AbortError");
  }

  private async readPersisted(
    path: string,
    now: number,
    ttl: number,
  ): Promise<MatrixSnapshot | null> {
    try {
      const parsed = JSON.parse(
        await (this.options.readTextFile ?? readFile)(path, "utf8"),
      ) as unknown;
      return isCapabilityMatrixSnapshot(parsed) &&
        capabilityMatrixSnapshotIsFresh(parsed, now, ttl)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private async writePersisted(
    flight: Flight,
    path: string,
    snapshot: MatrixSnapshot,
  ): Promise<void> {
    const stage = `${path}.${randomUUID()}.tmp`;
    try {
      this.assertCurrent(flight);
      await (this.options.ensureDirectory ?? mkdir)(dirname(path), {
        recursive: true,
      });
      this.assertCurrent(flight);
      await (
        this.options.writeTextFile ??
        ((target, content, encoding) =>
          writeFile(target, content, { encoding, mode: 0o600 }))
      )(stage, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      this.assertCurrent(flight);
      const commit = this.commitTail.then(async () => {
        this.assertCurrent(flight);
        await (this.options.renameFile ?? rename)(stage, path);
      });
      this.commitTail = commit.catch(() => undefined);
      await commit;
      this.assertCurrent(flight);
    } catch (error) {
      // Disk cache remains advisory. Retirement/cancellation is not a cache hit.
      this.assertCurrent(flight);
    } finally {
      // Cleanup may finish after stop, but never publishes a stale generation.
      void Promise.resolve()
        .then(() => (this.options.removeFile ?? unlink)(stage))
        .catch(() => undefined);
    }
  }
}
