// A text channel from this machine's own processes (broker, web server) to
// the local pairing bridge.
//
// A plaintext bridge takes JSON frames as-is. A secure bridge only answers
// Noise peers it trusts, so local readers handshake with the bridge's own
// identity key: holding that private key proves the same user on the same
// Mac. The handshake never writes to the paired-device list on either side,
// and the reader checks the bridge answered with that same key, so another
// process squatting the port cannot pose as the bridge.
//
// Which mode to expect comes from the same local config the bridge reads
// (secure unless `secure: false`), never from the endpoint alone: `/health`
// may upgrade a reader to Noise but cannot talk it down to plaintext.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tryLoadIdentity, bytesToHex, type QRPayload } from "./pairing-security/identity.js";
import { SecureTransport } from "./pairing-security/transport.js";
import { resolveOpenScoutPairingHome } from "./support-paths.js";

export interface PairingLocalChannel {
  readonly secure: boolean;
  isOpen(): boolean;
  send(text: string): void;
  close(): void;
}

export interface PairingLocalChannelHandlers {
  onMessage(text: string): void;
  onClose(): void;
}

type LocalSocketEvent = { data?: unknown };
type LocalSocket = {
  readyState: number;
  binaryType?: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (event: LocalSocketEvent) => void): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: (event: LocalSocketEvent) => void): void;
};
type LocalSocketConstructor = new (url: string) => LocalSocket;

export type PairingBridgeMode = "secure" | "plaintext";

/** The mode the local bridge is configured for, by the bridge's own rule. */
export function configuredPairingBridgeMode(): PairingBridgeMode {
  const configPath = join(resolveOpenScoutPairingHome(), "config.json");
  if (!existsSync(configPath)) return "secure";
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { secure?: unknown } | null;
    return config?.secure === false ? "plaintext" : "secure";
  } catch {
    return "secure";
  }
}

export async function readPairingBridgeMode(port: number, timeoutMs: number): Promise<PairingBridgeMode> {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null) as { mode?: unknown } | null;
  return body?.mode === "secure" ? "secure" : "plaintext";
}

export async function openPairingLocalChannel(
  port: number,
  handlers: PairingLocalChannelHandlers,
  options: {
    timeoutMs: number;
    subscribeEvents?: boolean;
    /** Defaults to the local pairing config; tests pin it. */
    expectedMode?: PairingBridgeMode;
  },
): Promise<PairingLocalChannel> {
  const deadline = Date.now() + options.timeoutMs;
  let mode = options.expectedMode ?? configuredPairingBridgeMode();
  try {
    if (mode === "plaintext") {
      mode = await readPairingBridgeMode(port, options.timeoutMs);
    }
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new Error(timedOut
      ? `Timed out connecting to the pairing bridge on port ${port}.`
      : `Unable to connect to the pairing bridge on port ${port}.`);
  }
  const identity = mode === "secure" ? tryLoadIdentity() : null;
  if (mode === "secure" && !identity) {
    throw new Error("The pairing bridge is in secure mode but this machine has no pairing identity.");
  }

  const ctor = (globalThis as { WebSocket?: LocalSocketConstructor }).WebSocket;
  if (!ctor) {
    throw new Error("Global WebSocket is unavailable in this runtime.");
  }
  const query = options.subscribeEvents === false ? "?events=0" : "";
  const socket = new ctor(`ws://127.0.0.1:${port}${query}`);
  socket.binaryType = "arraybuffer";

  let transport: SecureTransport | null = null;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    socket.removeEventListener("message", handleMessage);
    if (socket.readyState === 0 || socket.readyState === 1) {
      socket.close();
    }
    handlers.onClose();
  };

  function handleMessage(event: LocalSocketEvent) {
    const data = event.data;
    if (transport) {
      transport.receive(
        typeof data === "string" ? data
          : data instanceof ArrayBuffer ? new Uint8Array(data)
          : data instanceof Uint8Array ? data
          : String(data ?? ""),
      );
      return;
    }
    handlers.onMessage(typeof data === "string" ? data
      : data instanceof ArrayBuffer ? new TextDecoder().decode(data)
      : String(data ?? ""));
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => fail(new Error(`Timed out connecting to the pairing bridge on port ${port}.`)),
      Math.max(0, deadline - Date.now()),
    );
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener("open", handleOpen);
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeEventListener("open", handleOpen);
      finish();
      reject(error);
    };
    // Before the channel is up a close is a connect failure; after, it ends the channel.
    const handleSocketEnd = () => {
      if (settled) finish();
      else fail(new Error(`Unable to connect to the pairing bridge on port ${port}.`));
    };
    const handleOpen = () => {
      if (!identity) {
        succeed();
        return;
      }
      const ownKeyHex = bytesToHex(identity.publicKey);
      try {
        transport = new SecureTransport(
          { send: (frame) => socket.send(typeof frame === "string" ? frame : new TextDecoder().decode(frame)) },
          "initiator",
          identity,
          {
            onReady: (_remoteKey, info) => {
              if (info.remotePublicKeyHex !== ownKeyHex) {
                fail(new Error("The process on the pairing bridge port did not answer with this machine's bridge key."));
                return;
              }
              succeed();
            },
            onMessage: (text) => handlers.onMessage(text),
            onError: (error) => fail(error),
            onClose: () => finish(),
          },
          { trustOnComplete: false, skipTrustWrite: () => true },
        );
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleSocketEnd);
    socket.addEventListener("error", handleSocketEnd);
    socket.addEventListener("message", handleMessage);
  });

  return {
    secure: Boolean(transport),
    isOpen: () => !closed && socket.readyState === 1,
    send(text: string) {
      if (transport) {
        transport.send(text);
      } else {
        socket.send(text);
      }
    },
    close: finish,
  };
}

/** Explicit local QR workflow control, authenticated with this host's own key.
 * A phone's paired key cannot invoke the server-side control hook. */
export type PairingOpportunityControlAction = "open" | "cancel" | "request-open" | "request-read" | "request-cancel";
export type PairingRequestBinding = { requestId: string; publicKey?: string };
export type LocalPairingOpportunity = { windowId: string; payload: QRPayload };

export function requestLocalPairingOpportunity(port: number, action: "open" | "cancel", windowId?: string) {
  return requestLocalPairingControl(port, {action, windowId});
}

/** Same own-key control, isolated from the QR surface and keyed by request. */
export function requestLocalApprovalPairingOpportunity(
  port: number, action: "open" | "read" | "cancel", binding: PairingRequestBinding,
) {
  return requestLocalPairingControl(port, {action: `request-${action}`, binding});
}

async function requestLocalPairingControl(
  port: number, params: {action: PairingOpportunityControlAction; windowId?: string; binding?: PairingRequestBinding},
): Promise<LocalPairingOpportunity | null> {
  let channel: PairingLocalChannel | undefined;
  type Result = {windowId: string; payload: QRPayload} | null;
  let settle!: (value: Result) => void, fail!: (error: Error) => void;
  const id = `pairing-${crypto.randomUUID()}`;
  const result = new Promise<Result>((resolve, reject) => { settle = resolve; fail = reject; });
  // Attach rejection handling before the channel can synchronously close.
  void result.catch(() => {});
  let expired = false;
  const timer = setTimeout(() => { expired = true; fail(new Error("Local pairing control timed out")); }, 5_000);
  try {
    channel = await openPairingLocalChannel(port, {
      onMessage(text) {
        try {
          const response = JSON.parse(text);
          if (response.id !== id) return;
          if (response.error) fail(new Error(response.error.message));
          else settle(response.result);
        } catch { /* Unrelated bridge events are not control replies. */ }
      },
      onClose() { fail(new Error("Local pairing control disconnected")); },
    }, {timeoutMs: 5_000, subscribeEvents: false, expectedMode: "secure"});
    if (expired) throw new Error("Local pairing control timed out");
    channel.send(JSON.stringify({id, method: "pairing/opportunity", params}));
    return await result;
  } finally { clearTimeout(timer); channel?.close(); }
}
