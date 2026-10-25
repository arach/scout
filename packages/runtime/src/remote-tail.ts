/** Owned, bounded tail.events client. No local watcher or ambient credentials.
 * Continuity is always unverified: the broker has no cursor-found/gap marker.
 * This first slice accepts only literal trusted-loopback origins. */
import WebSocket from "ws";
import type { IncomingMessage } from "node:http";
import type { TailEvent } from "./tail/types.js";

export interface RemoteTailOptions {
  brokerUrl: string;
  ingress: { kind: "trusted-loopback" };
  since?: string;
  sources?: readonly string[];
  signal: AbortSignal;
  /** Per outage, including the initial connection. A subscription started
   * frame ends an episode; a socket open alone does not. */
  reconnect: { maxAttempts: number; maxElapsedMs: number };
}

export type RemoteTailItem =
  | { type: "connection"; state: "connecting" | "connected" | "reconnecting"; generation: number }
  | { type: "continuity"; state: "unverified"; after?: string; generation: number }
  | { type: "event"; id: string; event: TailEvent; generation: number };

export type RemoteTailErrorReason =
  | "consumer_lag" | "server_error" | "auth_denied" | "retry_exhausted"
  | "protocol_error" | "invalid_options" | "unsupported_ingress" | "handshake_error";

const messages: Record<RemoteTailErrorReason, string> = {
  consumer_lag: "Remote tail consumer exceeded a delivery bound.",
  server_error: "Remote tail subscription refused or stopped.",
  auth_denied: "Remote tail ingress was denied.",
  retry_exhausted: "Remote tail reconnect budget exhausted.",
  protocol_error: "Remote tail received an invalid protocol frame.",
  invalid_options: "Invalid remote tail options or iterator ownership.",
  handshake_error: "Remote tail upgrade was rejected by a live listener or could not be classified safely.",
  unsupported_ingress: "Only trusted-loopback remote tail ingress is supported.",
};

/** Stable terminal shape. Messages never contain URLs, server text or proofs.
 * lastDeliveredId is null until an event was yielded (not the initial since).
 * resyncRequired means recovery is required, not that a gap was proven.
 * Bun 1.4 and Node expose failed-upgrade HTTP status: 401/403 are terminal
 * auth_denied and 503 earns bounded retry. No server message is parsed. */
export class RemoteTailError extends Error {
  override readonly name = "RemoteTailError";
  constructor(
    readonly reason: RemoteTailErrorReason,
    readonly lastDeliveredId: string | null,
    readonly resyncRequired: boolean,
    readonly generation: number,
  ) { super(messages[reason]); }
}

const MAX_COUNT = 256;
const MAX_BYTES = 1024 * 1024;
const MAX_AGE_MS = 30_000;
const MAX_FRAME_BYTES = MAX_BYTES + 64 * 1024;
const REQUEST_ID = 1;

type RecordLike = Record<string, unknown>;
function record(value: unknown): value is RecordLike {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function invalid(reason: RemoteTailErrorReason = "invalid_options"): never {
  throw new RemoteTailError(reason, null, false, 0);
}

function validate(options: RemoteTailOptions): { url: string; sources?: string[] } {
  if (!record(options)) invalid();
  if (!record(options.ingress) || options.ingress.kind !== "trusted-loopback") invalid("unsupported_ingress");
  if (Object.keys(options.ingress).some(key => key !== "kind")) invalid();
  if (Object.keys(options).some(key => !["brokerUrl", "ingress", "since", "sources", "signal", "reconnect"].includes(key))) invalid();
  if (typeof options.brokerUrl !== "string") invalid();
  // Check the literal spelling before URL normalizes numeric/encoded hosts.
  const match = /^(https?|wss?):\/\/(127\.0\.0\.1|\[::1\])(?::([0-9]+))?\/?$/i.exec(options.brokerUrl);
  if (!match) invalid();
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65_535)) invalid();
  if (!(options.signal instanceof AbortSignal)) invalid();
  if (options.since !== undefined && typeof options.since !== "string") invalid();
  if (options.sources !== undefined && (!Array.isArray(options.sources) || [...options.sources].some(source => typeof source !== "string"))) invalid();
  const retry = options.reconnect;
  if (!record(retry) || !Number.isSafeInteger(retry.maxAttempts) || retry.maxAttempts < 1
    || !Number.isFinite(retry.maxElapsedMs) || retry.maxElapsedMs <= 0 || retry.maxElapsedMs > 2_147_483_647) invalid();
  const url = new URL(options.brokerUrl);
  url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
  url.pathname = "/trpc";
  return { url: url.toString(), ...(options.sources === undefined ? {} : { sources: [...options.sources] }) };
}

/** Single-consumer, lazy iterator. Reconnect explicitly sends input.since from
 * the last yielded event, never tRPC lastEventId. Abort/return stop all work.
 * Client bounds: 256 events, 1 MiB serialized events, 30 s oldest queue age;
 * decoded messages are limited to 1 MiB + 64 KiB including the RPC envelope.
 * Invalid options refuse synchronously at generation 0. */
export function subscribeRemoteTail(options: RemoteTailOptions): AsyncIterable<RemoteTailItem> {
  const { url, sources } = validate(options);
  // Snapshot the policy: later mutation cannot change the selected authority.
  const signal = options.signal, initialSince = options.since;
  const { maxAttempts, maxElapsedMs } = options.reconnect;
  let claimed = false, started = false, done = false;
  let generation = 0, lastDeliveredId: string | null = null;
  let failure: RemoteTailError | undefined;
  let socket: WebSocket | null = null;
  let releaseSocket: (() => void) | undefined;
  let notices: RemoteTailItem[] = [];
  const queue: Array<{ item: Extract<RemoteTailItem, { type: "event" }>; bytes: number; at: number }> = [];
  let bytes = 0;
  let wake: (() => void) | undefined;
  let ageTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let episode: { attempts: number; timer: ReturnType<typeof setTimeout> } | undefined;
  let reconnectPending = false;

  const notify = () => { const callback = wake; wake = undefined; callback?.(); };
  const cursor = () => lastDeliveredId ?? initialSince;
  const disposeSocket = () => { releaseSocket?.(); releaseSocket = undefined; socket = null; };
  const stop = () => {
    done = true;
    signal.removeEventListener("abort", stop);
    clearTimeout(ageTimer); ageTimer = undefined;
    clearTimeout(retryTimer); retryTimer = undefined;
    if (episode) clearTimeout(episode.timer);
    episode = undefined;
    reconnectPending = false;
    queue.length = 0; bytes = 0; notices = [];
    disposeSocket();
    notify();
  };
  const fail = (reason: RemoteTailErrorReason) => {
    if (done) return;
    failure = new RemoteTailError(reason, lastDeliveredId,
      ["consumer_lag", "server_error", "retry_exhausted", "protocol_error"].includes(reason), generation);
    stop();
  };
  const armAge = () => {
    clearTimeout(ageTimer); ageTimer = undefined;
    if (queue.length) {
      ageTimer = setTimeout(() => fail("consumer_lag"), Math.max(1, queue[0]!.at + MAX_AGE_MS - Date.now()));
    }
  };
  const beginEpisode = () => {
    if (!episode) episode = { attempts: 0, timer: setTimeout(() => fail("retry_exhausted"), maxElapsedMs) };
  };
  const scheduleRetry = () => {
    if (done || !reconnectPending || queue.length || retryTimer) return;
    if (episode!.attempts >= maxAttempts) { fail("retry_exhausted"); return; }
    const attempt = episode!.attempts;
    const delay = attempt <= 1 ? 0 : Math.min(1000 * 2 ** (attempt - 1), 30_000);
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, delay);
  };
  const lost = () => {
    if (done || reconnectPending) return;
    beginEpisode(); // Drain time counts against the episode deadline.
    reconnectPending = true;
    disposeSocket();
    scheduleRetry();
    notify();
  };

  function connect(): void {
    if (done) return;
    beginEpisode();
    if (episode!.attempts >= maxAttempts) { fail("retry_exhausted"); return; }
    episode!.attempts++;
    generation++;
    const currentGeneration = generation;
    reconnectPending = false;
    notices = [{ type: "connection", state: generation === 1 ? "connecting" : "reconnecting", generation }];
    notify();
    let subscribed = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, { followRedirects: false, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false, allowSynchronousEvents: false });
    } catch { fail("protocol_error"); return; }
    socket = ws;
    const active = () => !done && socket === ws && generation === currentGeneration;
    const open = () => {
      if (!active()) return;
      ws.send(JSON.stringify({ id: REQUEST_ID, method: "subscription", params: {
        path: "tail.events", input: { ...(cursor() === undefined ? {} : { since: cursor() }), ...(sources === undefined ? {} : { sources }) },
      } }));
    };
    const accept = (message: unknown) => {
      if (!active()) return;
      if (!record(message)) { fail("protocol_error"); return; }
      if ("method" in message) {
        if (message.method === "reconnect" && message.id === null) lost();
        else fail("protocol_error");
        return;
      }
      if (message.id !== REQUEST_ID) { fail("protocol_error"); return; }
      if ("error" in message) {
        if (!record(message.error)) { fail("protocol_error"); return; }
        const data = message.error.data;
        const code = record(data) ? data.code : undefined;
        fail(code === "UNAUTHORIZED" || code === "FORBIDDEN" ? "auth_denied" : "server_error");
        return;
      }
      const result = message.result;
      if (!record(result)) { fail("protocol_error"); return; }
      if (result.type === "started") {
        if (subscribed) { fail("protocol_error"); return; }
        subscribed = true;
        if (episode) clearTimeout(episode.timer);
        episode = undefined;
        notices = [
          { type: "connection", state: "connected", generation },
          { type: "continuity", state: "unverified", ...(cursor() === undefined ? {} : { after: cursor() }), generation },
        ];
        notify(); return;
      }
      if (result.type === "stopped") { fail("server_error"); return; }
      if (result.type !== "data" || !subscribed) { fail("protocol_error"); return; }
      const envelope = result.data;
      if (!record(envelope) || !record(envelope.data) || typeof result.id !== "string" || !result.id
        || envelope.id !== result.id || envelope.data.id !== result.id || typeof envelope.data.source !== "string") {
        fail("protocol_error"); return;
      }
      const size = Buffer.byteLength(JSON.stringify(envelope.data));
      if (queue.length >= MAX_COUNT || bytes + size > MAX_BYTES
        || (queue[0] && Date.now() - queue[0].at >= MAX_AGE_MS)) { fail("consumer_lag"); return; }
      queue.push({ item: { type: "event", id: result.id, event: envelope.data as unknown as TailEvent, generation }, bytes: size, at: Date.now() });
      bytes += size;
      if (queue.length === 1) armAge();
      notify();
    };
    const message = (raw: WebSocket.RawData, binary: boolean) => {
      if (!active()) return;
      if (binary) { fail("protocol_error"); return; }
      const text = raw.toString();
      if (Buffer.byteLength(text) > MAX_FRAME_BYTES) { fail("consumer_lag"); return; }
      if (text === "PING") { ws.send("PONG"); return; }
      if (text === "PONG") return;
      try {
        const value: unknown = JSON.parse(text);
        if (Array.isArray(value)) {
          if (!value.length) fail("protocol_error");
          for (const part of value) accept(part);
        } else accept(value);
      } catch { fail("protocol_error"); }
    };
    const error = (error: Error & { code?: string }) => {
      if (!active()) return;
      if (error.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") fail("consumer_lag");
      else if (error.code?.startsWith("WS_ERR_")) fail("protocol_error");
      else lost();
    };
    const close = () => {
      if (active()) lost();
    };
    const unexpected = (_req: unknown, response: IncomingMessage) => {
      if (!active()) return;
      response.resume();
      if (response.statusCode === 401 || response.statusCode === 403) fail("auth_denied");
      else if (response.statusCode === 503) lost();
      else fail("server_error");
    };
    ws.on("open", open).on("message", message).on("error", error).on("close", close);
    ws.on("unexpected-response", unexpected);
    releaseSocket = () => {
      ws.off("open", open).off("message", message).off("error", error).off("close", close).off("unexpected-response", unexpected);
      // terminate(CONNECTING) can emit an error asynchronously; it belongs to
      // this retired socket, never the next generation or the caller's process.
      const ignore = () => {};
      ws.on("error", ignore);
      ws.once("close", () => ws.off("error", ignore));
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ id: REQUEST_ID, method: "subscription.stop" })); } catch { /* best effort */ }
      }
      ws.terminate();
    };
  }

  const read = async (): Promise<IteratorResult<RemoteTailItem>> => {
    if (failure) throw failure;
    if (done) return { done: true, value: undefined };
    if (!started) {
      started = true;
      if (signal.aborted) stop();
      else { signal.addEventListener("abort", stop, { once: true }); connect(); }
    }
    for (;;) {
      if (failure) throw failure;
      if (done) return { done: true, value: undefined };
      const notice = notices.shift();
      if (notice) return { done: false, value: notice };
      const entry = queue.shift();
      if (entry) {
        bytes -= entry.bytes;
        lastDeliveredId = entry.item.id; // Never advance for queue-only frames.
        armAge();
        scheduleRetry();
        return { done: false, value: entry.item };
      }
      scheduleRetry();
      await new Promise<void>(resolve => { wake = resolve; });
    }
  };
  return {
    [Symbol.asyncIterator]() {
      if (claimed) throw new RemoteTailError("invalid_options", lastDeliveredId, false, generation);
      claimed = true;
      let reads: Promise<unknown> = Promise.resolve();
      return {
        next() { const result = reads.then(read); reads = result.catch(() => {}); return result; },
        async return() { stop(); return { done: true as const, value: undefined }; },
        async throw(error?: unknown) { stop(); throw error; },
      };
    },
  };
}
