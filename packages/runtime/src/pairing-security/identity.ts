// Identity management for Pairing.
//
// Each bridge has a persistent static key pair (its identity).  This module
// handles generation, persistence (~/.scout/pairing/identity.json), and QR payload
// creation for pairing with a phone.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { generateKeyPair, type KeyPair } from "./noise.js";
import { randomUUID } from "node:crypto";
import { pairingTrustOwner, type TrustedPeer } from "./trust-owner.js";
export type { TrustedPeer } from "./trust-owner.js";
import { resolveOpenScoutPairingHome } from "../support-paths.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

// Per-instance: the bridge's Noise static key must never be shared between
// OPENSCOUT_INSTANCEs, or a phone paired to prod would trust a dev bridge.
function pairingDir(): string {
  return resolveOpenScoutPairingHome();
}
function identityFile(): string {
  return join(pairingDir(), "identity.json");
}

// ---------------------------------------------------------------------------
// Identity — the bridge's long-term key pair
// ---------------------------------------------------------------------------

export interface SerializedIdentity {
  publicKey: string;   // hex
  privateKey: string;  // hex
  createdAt: string;   // ISO-8601
}

export function loadOrCreateIdentity(): KeyPair {
  if (existsSync(identityFile())) {
    return loadIdentity();
  }
  return createAndSaveIdentity();
}

function loadIdentity(): KeyPair {
  const data: SerializedIdentity = JSON.parse(readFileSync(identityFile(), "utf8"));
  return {
    publicKey: hexToBytes(data.publicKey),
    privateKey: hexToBytes(data.privateKey),
  };
}

/**
 * Return this bridge's public key (hex) if an identity already exists, without
 * creating one. Used by the always-on LAN discovery beacon, which must not
 * mint an identity merely by booting the web server.
 */
export function tryLoadIdentityPublicKeyHex(): string | null {
  if (!existsSync(identityFile())) return null;
  try {
    const data: SerializedIdentity = JSON.parse(readFileSync(identityFile(), "utf8"));
    return typeof data.publicKey === "string" && data.publicKey.length > 0
      ? data.publicKey
      : null;
  } catch {
    return null;
  }
}

/**
 * This machine's bridge key pair, or null when none exists yet. Local readers
 * (broker, web server) use it to open a secure channel to their own bridge;
 * they must never mint an identity.
 */
export function tryLoadIdentity(): KeyPair | null {
  if (!existsSync(identityFile())) return null;
  try {
    return loadIdentity();
  } catch {
    return null;
  }
}

function createAndSaveIdentity(): KeyPair {
  const keyPair = generateKeyPair();
  mkdirSync(pairingDir(), { recursive: true });

  const data: SerializedIdentity = {
    publicKey: bytesToHex(keyPair.publicKey),
    privateKey: bytesToHex(keyPair.privateKey),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(identityFile(), JSON.stringify(data, null, 2), { mode: 0o600 });
  return keyPair;
}

// ---------------------------------------------------------------------------
// Trusted peers — phones that have completed a handshake
// ---------------------------------------------------------------------------

export function loadTrustedPeers(): Map<string, TrustedPeer> {
  return new Map(pairingTrustOwner().read().peers.map(peer => [peer.publicKey, peer]));
}

/** Explicit pairing grant. Concurrent mutation refuses rather than losing data. */
export function saveTrustedPeer(peer: TrustedPeer): void {
  const owner = pairingTrustOwner(), revision = owner.read().revision;
  owner.mutate(revision, randomUUID(), {type: "grant", peer});
}

/** Reconnect validates membership only; lastSeen persists at grant time. */
export function refreshTrustedPeer(publicKey: string, lastSeen: string): void {
  pairingTrustOwner().refresh(publicKey, lastSeen);
}

export function isTrustedPeer(publicKeyHex: string): boolean {
  return loadTrustedPeers().has(publicKeyHex);
}

// ---------------------------------------------------------------------------
// QR pairing payload — everything the phone needs to connect
// ---------------------------------------------------------------------------

export interface QRPayload {
  /** Protocol version. */
  v: number;
  /** Relay WebSocket URL. */
  relay: string;
  /** Additional relay URLs the phone should try after the primary relay. */
  fallbackRelays?: string[];
  /** Room ID on the relay. */
  room: string;
  /** Bridge's static public key (hex). */
  publicKey: string;
  /** Expiry timestamp (ms since epoch). */
  expiresAt: number;
}

const QR_VERSION = 1;
const QR_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export function createQRPayload(
  bridgePublicKey: Uint8Array,
  relayUrl: string,
  fallbackRelayUrls: string[] = [],
): QRPayload {
  const fallbackRelays = normalizedRelayUrls(fallbackRelayUrls, relayUrl);
  return {
    v: QR_VERSION,
    relay: relayUrl,
    ...(fallbackRelays.length > 0 ? { fallbackRelays } : {}),
    room: crypto.randomUUID(),
    publicKey: bytesToHex(bridgePublicKey),
    expiresAt: Date.now() + QR_EXPIRY_MS,
  };
}

export function validateQRPayload(payload: QRPayload): boolean {
  if (payload.v !== QR_VERSION) return false;
  if (Date.now() > payload.expiresAt) return false;
  if (!payload.relay || !payload.room || !payload.publicKey) return false;
  return true;
}

function normalizedRelayUrls(urls: string[], primaryRelayUrl: string): string[] {
  const seen = new Set([primaryRelayUrl.trim()]);
  const normalized: string[] = [];

  for (const url of urls) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
