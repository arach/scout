import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

export const NODE_FINGERPRINT_PREFIX = "osc1";
export const NODE_CARD_TTL_MS = 24 * 60 * 60 * 1_000;

export function stripBonjourCollisionSuffix(value: string): string {
  if (!value || typeof value !== "string") return "";
  let trimmed = value.trim();

  // Check if ending with .local
  const isDotLocal = /\.local\.?$/i.test(trimmed);
  if (isDotLocal) {
    trimmed = trimmed.replace(/\.local\.?$/i, "");
  }

  // Check if ending with -local or -local-openscout (for qualifiers / node IDs)
  const isHyphenLocalOpenscout = /-local-openscout$/i.test(trimmed);
  const isHyphenLocal = !isHyphenLocalOpenscout && /-local$/i.test(trimmed);
  if (isHyphenLocalOpenscout) {
    trimmed = trimmed.replace(/-local-openscout$/i, "");
  } else if (isHyphenLocal) {
    trimmed = trimmed.replace(/-local$/i, "");
  }

  // Only strip numeric collision suffixes if this is an mDNS/Bonjour identifier
  if (!isDotLocal && !isHyphenLocalOpenscout && !isHyphenLocal) {
    return trimmed;
  }

  // Strip trailing numeric collision suffix e.g. -2, -292, -372
  trimmed = trimmed.replace(/(?<=[a-zA-Z].*?)(?:-\d+)+$/, "");

  if (isDotLocal) return `${trimmed}.local`;
  if (isHyphenLocalOpenscout) return `${trimmed}-local-openscout`;
  if (isHyphenLocal) return `${trimmed}-local`;
  return trimmed;
}

/**
 * Compute the canonical mesh node ID for a given node ID or hostname string,
 * stripping volatile Bonjour collision numbering while preserving custom IDs.
 */
export function canonicalMeshNodeId(nodeId: string): string {
  if (!nodeId || typeof nodeId !== "string") return "";
  return stripBonjourCollisionSuffix(nodeId);
}


export type NodeIdentity = {
  version: 1;
  /** base64 DER (spki) Ed25519 public key */
  publicKey: string;
  /** base64 DER (pkcs8) Ed25519 private key — never leaves this machine */
  privateKey: string;
  createdAt: number;
  /**
   * Stable, human-readable machine qualifier used by broker and agent ids.
   * Persisting it prevents DHCP/mDNS hostname collision suffixes from changing
   * local authority across broker restarts.
   */
  nodeQualifier?: string;
};

/** §11.2: additive TLS attestation on the signed node card (P1.5). */
export type NodeCardTls = {
  /** SHA-256 hex (64 lowercase) of the TLS certificate's SubjectPublicKeyInfo DER */
  spkiFingerprint: string;
};

export type SignedNodeCard = {
  nodeId: string;
  label: string;
  publicKey: string;
  /** full SHA-256 hex of the public key — canonical machine identity */
  keyId: string;
  /** display-only human anchor */
  fingerprint: string;
  version: string;
  capabilities: string[];
  endpoints: string[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  /**
   * Optional §11.2 TLS attestation. Included in the signed canonical-JSON
   * payload when present, so P1 verifiers accept it (hashed like every other
   * field) and P1.5 verifiers accept its absence.
   */
  tls?: NodeCardTls;
  /** base64 Ed25519 signature over canonicalJson of every field above */
  signature: string;
};

/** Canonical machine identity: full SHA-256 hex of the DER public key. */
export function nodeKeyId(publicKeyBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

/** Display-only human anchor: `osc1:7f3k-9q2x`. Not used for authz or lookup. */
export function nodeFingerprint(publicKeyBase64: string): string {
  const digest = createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest();
  const encoded = base32Encode(digest.subarray(0, 10)).toLowerCase();
  return `${NODE_FINGERPRINT_PREFIX}:${encoded.slice(0, 4)}-${encoded.slice(4, 8)}`;
}

export function signNodePayload(identity: NodeIdentity, payload: Buffer | string): string {
  const key = importPrivateKey(identity.privateKey);
  return sign(null, typeof payload === "string" ? Buffer.from(payload, "utf8") : payload, key).toString("base64");
}

export function verifyNodeSignature(
  publicKeyBase64: string,
  payload: Buffer | string,
  signatureBase64: string,
): boolean {
  try {
    const key = importPublicKey(publicKeyBase64);
    return verify(
      null,
      typeof payload === "string" ? Buffer.from(payload, "utf8") : payload,
      key,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

/**
 * Canonical JSON, cross-language: object keys sorted (by UTF-16 code unit,
 * matching JSON.stringify ordering on sorted keys), no insignificant
 * whitespace, applied recursively. Swift and other clients must reproduce
 * this byte-for-byte; covered by golden-vector tests.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function buildSignedNodeCard(
  identity: NodeIdentity,
  fields: {
    nodeId: string;
    label: string;
    version: string;
    capabilities: string[];
    endpoints: string[];
    /**
     * §11.2 attestation wired from the node's TLS identity when it has one
     * (`{ spkiFingerprint: tlsIdentity.spkiFingerprint }`). Omitted entirely
     * on nodes without a TLS identity — the field's optionality is the
     * versioning, so P1 cards stay valid.
     */
    tls?: NodeCardTls;
  },
  now: number = Date.now(),
): SignedNodeCard {
  const unsigned = {
    nodeId: fields.nodeId,
    label: fields.label,
    publicKey: identity.publicKey,
    keyId: nodeKeyId(identity.publicKey),
    fingerprint: nodeFingerprint(identity.publicKey),
    version: fields.version,
    capabilities: [...fields.capabilities].sort(),
    endpoints: [...fields.endpoints].sort(),
    issuedAt: now,
    expiresAt: now + NODE_CARD_TTL_MS,
    nonce: randomBytes(16).toString("base64"),
    ...(fields.tls ? { tls: { spkiFingerprint: fields.tls.spkiFingerprint } } : {}),
  };
  return {
    ...unsigned,
    signature: signNodePayload(identity, canonicalJson(unsigned)),
  };
}

export function verifySignedNodeCard(card: SignedNodeCard, now: number = Date.now()): boolean {
  if (nodeKeyId(card.publicKey) !== card.keyId) {
    return false;
  }
  if (nodeFingerprint(card.publicKey) !== card.fingerprint) {
    return false;
  }
  if (!Number.isFinite(card.expiresAt) || card.expiresAt <= now) {
    return false;
  }
  // §11.2 hardening: a present tls field must be well-formed — a pin is only
  // ever stored from a signature-valid card carrying exactly 64 lowercase hex.
  if (card.tls !== undefined) {
    if (
      typeof card.tls !== "object"
      || card.tls === null
      || typeof card.tls.spkiFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(card.tls.spkiFingerprint)
    ) {
      return false;
    }
  }
  const { signature, ...unsigned } = card;
  return verifyNodeSignature(card.publicKey, canonicalJson(unsigned), signature);
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function importPrivateKey(privateKeyBase64: string) {
  return createPrivateKey({ key: Buffer.from(privateKeyBase64, "base64"), format: "der", type: "pkcs8" });
}

function importPublicKey(publicKeyBase64: string) {
  return createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
}
