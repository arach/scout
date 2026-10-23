// Encrypted transport — wraps a WebSocket connection with Noise encryption.
//
// Usage from the bridge side:
//   1. Client connects via WebSocket
//   2. Bridge creates a SecureTransport with its static key
//   3. Handshake messages exchange automatically
//   4. Once complete, all subsequent messages are encrypted/decrypted transparently
//
// Wire format:
//   Binary frames with a 1-byte tag prefix:
//     0x01 + payload → handshake message
//     0x02 + payload → transport (encrypted application data)
//
//   Legacy JSON format is still accepted on receive for backward compat:
//     { phase: "handshake", payload: "<base64>" }
//     { phase: "transport", payload: "<base64>" }

import {
  NoiseHandshake,
  type KeyPair,
  type NoiseSession,
  type HandshakePattern,
  type Role,
} from "./noise.js";
import { pairingTrustOwner, type PairingTrustOwner, type PairingTrustContext, type TransportAuthorityView } from "./trust-owner.js";
import { saveTrustedPeer, refreshTrustedPeer, loadTrustedPeers, bytesToHex } from "./identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Binary wire tags
const TAG_HANDSHAKE = 0x01;
const TAG_TRANSPORT = 0x02;

// Legacy JSON format (accepted on receive for backward compat)
interface WireMessage {
  phase: "handshake" | "transport";
  payload: string; // base64
}

export interface SecureTransportEvents {
  /** Handshake complete — transport is ready for encrypted messages. */
  onReady?: (remotePublicKey: Uint8Array, info: SecureTransportReadyInfo) => void;
  /** Decrypted application message received. */
  onMessage?: (message: string) => void;
  /** Error during handshake or transport. */
  onError?: (error: Error) => void;
  /** Connection closed. */
  onClose?: () => void;
}

export interface SecureTransportReadyInfo {
  remotePublicKeyHex: string;
  /** True only when this peer was already in the trust store before this handshake. */
  wasTrustedPeer: boolean;
  /** True when this handshake left the peer trusted, either pre-existing or newly paired. */
  trustedPeer: boolean;
  /** True when this transport was allowed to persist a new trust record. */
  trustedOnComplete: boolean;
}

// Minimal WebSocket interface — works with both Bun.serve sockets and client WebSockets.
export interface SocketLike {
  send(data: string | Uint8Array): void;
}

/** Other relay close codes are occupied, including 4005 (Host asleep). */
export const PAIRING_AUTHORITY_CHANGED_CLOSE_CODE = 4006;
const AUTHORITY_CHANGED_REASON = "authority changed, reconnect";
const CONTROLLER_CAPACITY = 1024;
type LiveEntry = {
  transport: SecureTransport; domain: TransportDomain; key?: string; handle?: object;
  kind: "pending" | "unadmitted" | "paired-peer" | "local-service" | "invalid";
  stamp?: string; group?: string; abort: AbortController; timer?: ReturnType<typeof setTimeout>;
  close(code: number, reason: string): void;
};
const liveTransports = new WeakMap<SecureTransport, LiveEntry>();
const liveHandles = new WeakMap<object, LiveEntry>();
const pilotBindings = new WeakMap<object, object>();
const bridgeDomains = new WeakMap<object, TransportDomain>();
const compositionBrand = Symbol.for("scout.transport.registry.composition/v1");
export type TransportContext = {bridge?: object; transport?: SecureTransport; transportHandle?: object; pilotBinding?: object};

/** Trusted bootstrap, not a wire context factory. This grants no paired identity. */
export function plaintextPilotContext<T extends {bridge: object}>(ctx: T): T & {pilotBinding: object} {
  const pilotBinding = Object.freeze({}); pilotBindings.set(pilotBinding, ctx.bridge);
  return {...ctx, pilotBinding};
}

/** Resolves only a genuine transport and its exact dispatch binding. Fields such
 * as secureTransport/trustedPeer/deviceId have no authority. */
export function requireTransportContext(ctx: TransportContext, pairedOnly = false, context?: PairingTrustContext) {
  if (!pairedOnly && ctx.pilotBinding && pilotBindings.get(ctx.pilotBinding) === ctx.bridge)
    return Object.freeze({kind: "plaintext" as const, publicKey: undefined});
  const entry = ctx.transportHandle && liveHandles.get(ctx.transportHandle);
  if (!entry || entry.transport !== ctx.transport || entry.domain.bridge !== ctx.bridge
    || !entry.domain.check(entry, context) || (pairedOnly && entry.kind !== "paired-peer"))
    throw new Error("Unauthorized: live authenticated transport required");
  return Object.freeze({kind: entry.kind, publicKey: entry.key!, signal: entry.abort.signal});
}
export function hasPairedTransport(ctx: TransportContext): boolean {
  try { requireTransportContext(ctx, true); return true; } catch { return false; }
}

/** One boot domain shared by a bridge's endpoints and retained room peers.
 * Construction verifies v2 readiness BEFORE listeners. Migration is an explicit
 * local cutover obligation, never an inbound phone operation. */
export class TransportDomain {
  private entries = new Set<LiveEntry>();
  private rootId: string;
  private indicator = "";
  private backstop = performance.now();
  private timer?: ReturnType<typeof setInterval>;
  private unobserve: () => void;
  private batchView?: TransportAuthorityView;
  private disposed = false;
  private leases = 0;
  private fanouts = new Map<object, {
    listeners: Set<(event: unknown) => void>; stop: () => void; stopped: boolean;
  }>();
  /** Endpoints/retained carriers own explicit idempotent boot-domain leases. */
  retain(): () => void {
    if (this.disposed) throw Error("Transport domain disposed");
    this.leases++; let released = false;
    return () => { if (!released) { released = true; if (--this.leases === 0) this.dispose(); } };
  }
  constructor(readonly bridge: object, readonly hostKey: string, readonly owner: PairingTrustOwner = pairingTrustOwner()) {
    this.rootId = owner.withTransportAuthority(v => v.rootId);
    this.unobserve = owner.observeTransportAuthority(view => this.reconcile(view));
  }
  private reconcile(view: TransportAuthorityView) {
    // A publication/fresh admission can interrupt a synchronous producer. Drop
    // the old batch permission; never rebase a handle or trust a hint as a grant.
    if (this.batchView && (this.batchView.rootId !== view.rootId || this.batchView.stamp !== view.stamp))
      this.batchView = undefined;
    for (const e of this.entries) if (e.kind === "paired-peer" &&
      (view.rootId !== this.rootId || e.stamp !== view.stamp || !view.has(e.key!)))
      this.invalidate(e, view.rootId === this.rootId && view.has(e.key!) ? PAIRING_AUTHORITY_CHANGED_CLOSE_CODE : 4003);
  }
  /** Scheduling is only a hint; admissions and sends never consult it. */
  sweep(): void {
    try {
      const indicator = this.owner.transportChangeIndicator(), now = performance.now();
      if (indicator === this.indicator && now - this.backstop < 60_000) return;
      this.indicator = indicator; this.backstop = now;
      this.owner.withTransportAuthority(view => this.reconcile(view));
      if (this.owner.transportRootIdentity() !== this.rootId) this.dispose();
    } catch {
      let rootChanged = true;
      try { rootChanged = this.owner.transportRootIdentity() !== this.rootId; } catch {}
      for (const e of this.entries) if (e.kind !== "local-service" || rootChanged) this.invalidate(e, 4003);
    }
  }
  /** Internal controllers are allocated before handshake, but no identity is
   * minted until Noise finalization. Capacity exhaustion refuses, never evicts. */
  track(transport: SecureTransport, close: LiveEntry["close"], group?: string): void {
    if (this.disposed || this.entries.size >= CONTROLLER_CAPACITY) throw new Error("Transport registry capacity unavailable");
    const e: LiveEntry = {transport, domain: this, kind: "pending", close, group, abort: new AbortController()};
    liveTransports.set(transport, e); this.entries.add(e);
    e.timer = setTimeout(() => this.invalidate(e, 4003), 10_000); e.timer.unref?.();
    if (!this.timer) {this.timer = setInterval(() => this.sweep(), 1000); this.timer.unref?.();}
  }
  check(e: LiveEntry, context?: PairingTrustContext): boolean {
    if (this.disposed || !this.entries.has(e) || !e.transport.isReady()
      || (e.kind !== "paired-peer" && e.kind !== "local-service")) return false;
    try {
      if (e.kind === "local-service") {
        if (this.owner.transportRootIdentity() !== this.rootId || e.key !== this.hostKey) throw Error("local domain changed");
        return true;
      }
      const decide = (view: TransportAuthorityView) => {
        this.reconcile(view); return e.kind === "paired-peer";
      };
      // A managed caller's explicit context is always validated by the owner.
      if (this.batchView && context === undefined) {
        const view = this.batchView;
        if (view.rootId !== this.rootId || e.stamp !== view.stamp || !view.has(e.key!))
          this.invalidate(e, view.rootId === this.rootId && view.has(e.key!) ? PAIRING_AUTHORITY_CHANGED_CLOSE_CODE : 4003);
        return e.kind === "paired-peer";
      }
      return this.owner.withTransportAuthority(decide, context);
    } catch { this.invalidate(e, 4003); return false; }
  }
  /** One fresh decision per synchronous delivery batch. Frames/cleanup are
   * emitted AFTER the managed authority gate releases. No view crosses a wait,
   * queued callback, timer or later turn. A nested batch shares this stack only. */
  batch<T>(body: () => T): T {
    if (this.disposed) throw Error("Transport domain disposed");
    const synchronous = () => {
      const result = body();
      if (result && typeof (result as {then?: unknown}).then === "function") throw Error("synchronous batch required");
      return result;
    };
    if (this.batchView) return synchronous();
    const view = this.owner.withTransportAuthority(fresh => {
      this.reconcile(fresh); return fresh;
    });
    this.batchView = view;
    try { return synchronous(); }
    finally { this.batchView = undefined; }
  }
  /** One source callback fans out to every local subscription for this boot
   * domain, even across direct/relay carriers. No view is stored by the hub.
   * Async iterator continuations are separate decisions, not this batch. */
  subscribe<T>(source: object, start: (emit: (event: T) => void) => () => void, listener: (event: T) => void): () => void {
    if (this.disposed) throw Error("Transport domain disposed");
    let hub = this.fanouts.get(source);
    const first = !hub;
    if (!hub) {
      hub = {listeners: new Set(), stop: () => {}, stopped: false};
      this.fanouts.set(source, hub);
    }
    const current = hub, callback = listener as (event: unknown) => void;
    current.listeners.add(callback);
    const release = () => {
      if (!current.listeners.delete(callback) || current.listeners.size) return;
      if (this.fanouts.get(source) === current) this.fanouts.delete(source);
      current.stopped = true; current.stop();
    };
    if (first) {
      try {
        const stop = start(event => {
          if (this.disposed || current.stopped) return;
          try {
            this.batch(() => {
              for (const deliver of [...current.listeners]) {
                if (this.disposed) break;
                if (current.listeners.has(deliver)) {
                  try { deliver(event); } catch { /* A failed listener cannot deliver or suppress a sibling. */ }
                }
              }
            });
          } catch { /* Authority unavailable: no protected callback/delivery. */ }
        });
        current.stop = stop;
        if (current.stopped) stop(); // release during a synchronous first event
      } catch (error) { release(); throw error; }
    }
    return release;
  }
  activate(e: LiveEntry, local = false): boolean {
    if (e.kind !== "unadmitted" || !this.entries.has(e)) return false;
    try {
      if (local) {
        if (e.key !== this.hostKey || this.owner.transportRootIdentity() !== this.rootId) throw Error("wrong local identity");
        e.kind = "local-service";
      } else this.owner.withTransportAuthority(view => {
        if (view.rootId !== this.rootId || !view.has(e.key!)) throw Error("untrusted peer");
        this.reconcile(view);
        e.stamp = view.stamp; e.kind = "paired-peer";
      });
      clearTimeout(e.timer);
      if (e.group) for (const older of this.entries) if (older !== e && older.kind === "paired-peer"
        && older.group === e.group && older.key === e.key) this.invalidate(older, 4001);
      return true;
    } catch { this.invalidate(e, 4003); return false; }
  }
  invalidate(e: LiveEntry, code = 1000): void {
    if (e.kind === "invalid") return;
    e.kind = "invalid"; clearTimeout(e.timer); this.entries.delete(e);
    // Mark crypto dead and abort synchronously; cleanup/frames run after gates.
    e.transport.dispose();
    if (!this.entries.size) {clearInterval(this.timer); this.timer = undefined;}
    queueMicrotask(() => {e.abort.abort(); try {e.close(code, code === PAIRING_AUTHORITY_CHANGED_CLOSE_CODE ? AUTHORITY_CHANGED_REASON : "Transport no longer authorized");} catch {}});
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const e of this.entries) this.invalidate(e, 4003);
    clearInterval(this.timer); this.unobserve(); bridgeDomains.delete(this.bridge);
    for (const hub of this.fanouts.values()) {
      hub.stopped = true; hub.listeners.clear(); try { hub.stop(); } catch { /* Teardown continues. */ }
    }
    this.fanouts.clear();
    if ((this.bridge as any)[compositionBrand] === this) delete (this.bridge as any)[compositionBrand];
  }
}
export function transportDomainForBridge(bridge: object, hostKey: string, owner?: PairingTrustOwner): TransportDomain {
  const loaded = (bridge as any)[compositionBrand];
  if (loaded && !(loaded instanceof TransportDomain)) throw Error("Duplicate runtime transport registry");
  let domain = bridgeDomains.get(bridge);
  if (!domain) {domain = new TransportDomain(bridge, hostKey, owner); bridgeDomains.set(bridge, domain);
    Object.defineProperty(bridge, compositionBrand, {value: domain, configurable: true});}
  if (domain.hostKey !== hostKey || (owner && domain.owner !== owner)) {domain.dispose(); throw Error("Transport domain composition mismatch");}
  return domain;
}

/** Subscribe to one synchronous emitter; plaintext remains explicitly outside
 * paired authorization and cannot manufacture a transport handle. */
export function subscribeTransportEvents<T>(domain: TransportDomain | undefined,
  source: {onEvent(listener: (event: T) => void): () => void}, listener: (event: T) => void): () => void {
  return domain ? domain.subscribe(source, emit => source.onEvent(emit), listener) : source.onEvent(listener);
}

/** Trusted boot teardown, including retained rooms absent from window maps. */
export function disposeTransportDomainForBridge(bridge: object): void { bridgeDomains.get(bridge)?.dispose(); }

export type TransportWatchOptions<Message, Lifecycle> = {
  allConversations: true; signal?: AbortSignal;
  onMessage(message: Message): void; onLifecycle?(event: Lifecycle): void;
  /** Trusted local composition only; never forwarded to the underlying watch. */
  transportDomain?: TransportDomain;
};

/** One underlying watch, with one fresh delivery decision per boot domain for
 * each synchronous source callback. No authority retained by the watch. */
export function createTransportWatchFanout<Message, Lifecycle>(
  watch: (options: TransportWatchOptions<Message, Lifecycle>) => Promise<void>,
) {
  type Options = TransportWatchOptions<Message, Lifecycle>;
  type Listener = {options: Options; finish(error?: unknown): void};
  const listeners = new Set<Listener>();
  let active: AbortController | null = null;
  const start = () => {
    if (active) return;
    const controller = new AbortController(); active = controller;
    const dispatch = (deliver: (options: Options) => void) => {
      if (active !== controller) return;
      const groups = new Map<TransportDomain | undefined, Listener[]>();
      for (const listener of listeners) {
        const key = listener.options.transportDomain;
        const group = groups.get(key) ?? []; group.push(listener); groups.set(key, group);
      }
      for (const [domain, group] of groups) {
        const batch = () => {
          for (const listener of group) if (listeners.has(listener)) {
            try { deliver(listener.options); } catch (error) { listener.finish(error); }
          }
        };
        try { if (domain) domain.batch(batch); else batch(); }
        catch (error) { for (const listener of group) listener.finish(error); }
      }
    };
    const finish = (error?: unknown) => {
      if (active !== controller) return;
      active = null; controller.abort();
      for (const listener of [...listeners]) listener.finish(error);
    };
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      return watch({allConversations: true, signal: controller.signal,
        onMessage: message => dispatch(options => options.onMessage(message)),
        onLifecycle: event => dispatch(options => options.onLifecycle?.(event))});
    }).then(() => finish(), finish);
  };
  return (options: Options): Promise<void> => {
    if (options.signal?.aborted) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const abort = () => listener.finish();
      const listener: Listener = {options, finish(error) {
        if (!listeners.delete(listener)) return;
        options.signal?.removeEventListener("abort", abort);
        if (!listeners.size) {const previous = active; active = null; previous?.abort();}
        if (error !== undefined) reject(error); else resolve();
      }};
      listeners.add(listener); options.signal?.addEventListener("abort", abort, {once: true}); start();
    });
  };
}

// ---------------------------------------------------------------------------
// SecureTransport
// ---------------------------------------------------------------------------

export class SecureTransport {
  private handshake: NoiseHandshake;
  private session: NoiseSession | null = null;
  private socket: SocketLike;
  private events: SecureTransportEvents;
  private trustOnComplete: boolean;
  private skipTrustWrite: (remotePublicKeyHex: string) => boolean;
  private ready = false;
  private disposed = false;

  constructor(
    socket: SocketLike,
    role: Role,
    staticKey: KeyPair,
    events: SecureTransportEvents,
    options?: {
      domain?: TransportDomain;
      close?: (code: number, reason: string) => void;
      replacementGroup?: string;
      pattern?: HandshakePattern;
      remoteStaticKey?: Uint8Array;
      trustOnComplete?: boolean;
      /** Leave the trust store untouched for this peer, not even lastSeen. */
      skipTrustWrite?: (remotePublicKeyHex: string) => boolean;
    },
  ) {
    this.socket = socket;
    this.events = events;
    this.trustOnComplete = options?.trustOnComplete ?? true;
    this.skipTrustWrite = options?.skipTrustWrite ?? (() => false);

    options?.domain?.track(this, options.close ?? (() => {}), options.replacementGroup);
    const pattern = options?.pattern ?? "XX";
    this.handshake = new NoiseHandshake(pattern, role, staticKey, options?.remoteStaticKey);

    // If it's our turn to send first, kick off the handshake.
    if (this.handshake.isMySend()) {
      this.sendHandshakeMessage();
    }
  }

  /** Feed an incoming WebSocket message into the transport. */
  receive(raw: string | Uint8Array): void {
    if (this.disposed) return;
    try {
      // Binary frame: 1-byte tag + payload
      if (typeof raw !== "string") {
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
        if (bytes.length < 2) return;
        const tag = bytes[0];
        const payload = bytes.subarray(1);
        if (tag === TAG_HANDSHAKE) {
          this.handleHandshakeMessage(payload);
        } else if (tag === TAG_TRANSPORT) {
          this.handleTransportMessage(payload);
        }
        return;
      }

      // Legacy JSON format (backward compat)
      const wire: WireMessage = JSON.parse(raw);
      if (wire.phase === "handshake") {
        this.handleHandshakeMessage(base64ToBytes(wire.payload));
      } else if (wire.phase === "transport") {
        this.handleTransportMessage(base64ToBytes(wire.payload));
      }
    } catch (err: any) {
      this.dispose();
      this.events.onError?.(err);
    }
  }

  /** Encrypt and send an application message. */
  send(message: string): void {
    const entry = liveTransports.get(this);
    if (this.disposed || (entry && !entry.domain.check(entry))) return;
    if (!this.ready || !this.session) {
      throw new Error("SecureTransport: not ready (handshake incomplete)");
    }

    const plaintext = new TextEncoder().encode(message);
    const ciphertext = this.session.encrypt(plaintext);
    const wire: WireMessage = {
      phase: "transport",
      payload: bytesToBase64(ciphertext),
    };
    this.socket.send(JSON.stringify(wire));
  }

  /** True if the handshake is complete and messages can be sent. */
  isReady(): boolean {
    return this.ready && !this.disposed;
  }

  /** Trusted dispatcher composition; the handle is minted only by Noise. */
  bindContext<T extends {bridge?: object}>(ctx: T): T & TransportContext {
    const e = liveTransports.get(this);
    if (!e?.handle || ctx.bridge !== e.domain.bridge) throw Error("Transport context domain mismatch");
    return {...ctx, transport: this, transportHandle: e.handle};
  }
  activatePaired(): boolean { const e = liveTransports.get(this); return !!e && e.domain.activate(e); }
  activateLocalService(): boolean { const e = liveTransports.get(this); return !!e && e.domain.activate(e, true); }
  isLive(): boolean { const e = liveTransports.get(this); return !!e && e.domain.check(e); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.ready = false; this.session = null;
    const e = liveTransports.get(this); if (e) e.domain.invalidate(e);
  }

  // ---------------------------------------------------------------------------
  // Handshake
  // ---------------------------------------------------------------------------

  private sendHandshakeMessage(): void {
    const payload = this.handshake.writeMessage();
    const wire: WireMessage = {
      phase: "handshake",
      payload: bytesToBase64(payload),
    };
    this.socket.send(JSON.stringify(wire));

    if (this.handshake.isComplete()) {
      this.completeHandshake();
    }
  }

  private handleHandshakeMessage(message: Uint8Array): void {
    this.handshake.readMessage(message);

    if (this.handshake.isComplete()) {
      this.completeHandshake();
      return;
    }

    // Our turn to respond.
    if (this.handshake.isMySend()) {
      this.sendHandshakeMessage();
    }
  }

  private completeHandshake(): void {
    if (this.disposed || this.ready) return;
    this.session = this.handshake.finalize();
    this.ready = true;

    const key = new Uint8Array(this.session.remoteStaticKey);
    const remotePublicKeyHex = bytesToHex(key);
    const entry = liveTransports.get(this);
    if (entry) {
      entry.key = remotePublicKeyHex; entry.kind = "unadmitted";
      entry.handle = Object.freeze({toJSON() {throw Error("Transport handle is not serializable");}});
      liveHandles.set(entry.handle, entry);
    }
    const skipTrust = this.skipTrustWrite(remotePublicKeyHex);
    const trustedPeers = skipTrust ? new Map() : loadTrustedPeers();
    const existingPeer = trustedPeers.get(remotePublicKeyHex);
    const wasTrustedPeer = Boolean(existingPeer);
    const trustedPeer = wasTrustedPeer || this.trustOnComplete;

    if (trustedPeer && !skipTrust) {
      const now = new Date().toISOString();
      if (wasTrustedPeer) refreshTrustedPeer(remotePublicKeyHex, now);
      else saveTrustedPeer({ publicKey: remotePublicKeyHex, pairedAt: now, lastSeen: now });
    }

    this.events.onReady?.(key, {
      remotePublicKeyHex,
      wasTrustedPeer,
      trustedPeer,
      trustedOnComplete: this.trustOnComplete,
    });
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private handleTransportMessage(ciphertext: Uint8Array): void {
    const entry = liveTransports.get(this);
    if (this.disposed || (entry && !entry.domain.check(entry))) return;
    if (!this.session) {
      this.events.onError?.(new Error("SecureTransport: received transport message before handshake"));
      return;
    }

    try {
      const plaintext = this.session.decrypt(ciphertext);
      const message = new TextDecoder().decode(plaintext);
      this.events.onMessage?.(message);
    } catch (err: any) {
      // Decrypt failure = stale session (peer using old keys after restart).
      // Signal error + close so the peer reconnects with a fresh handshake.
      this.dispose();
      this.events.onError?.(err);
      this.events.onClose?.();
    }
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers (using built-in btoa/atob)
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked to avoid stack overflow on large payloads.
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(""));
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
