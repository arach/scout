"""Ed25519 identity and the broker's canonical request signature (v1).

The payload is the one the broker verifies for mesh peers and guests
(packages/runtime/src/mesh-peer-auth.ts), newline-joined:

    v1, METHOD, path+query, sha256hex(body), destinationKeyId, ts_ms, nonce

tests/vectors/signing-v1.json pins it byte-for-byte against the TypeScript
implementation.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PAYLOAD_VERSION = "v1"
CLAIM_CONTEXT = "scout-tailscale-claim-v1"
DIRECTORY_CONTEXT = "scout-tailscale-directory-v1"
HEADERS = {
    "peer": "x-openscout-peer",
    "ts": "x-openscout-ts",
    "nonce": "x-openscout-nonce",
    "signature": "x-openscout-signature",
}


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def public_spki_der(key: Ed25519PrivateKey | Ed25519PublicKey) -> bytes:
    public = key.public_key() if isinstance(key, Ed25519PrivateKey) else key
    return public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def public_key_b64(key: Ed25519PrivateKey) -> str:
    return base64.b64encode(public_spki_der(key)).decode("ascii")


def key_id(key: Ed25519PrivateKey | Ed25519PublicKey) -> str:
    """Full SHA-256 hex of the SPKI DER: the id the broker and hosted service use."""
    return sha256_hex(public_spki_der(key))


def generate_key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


def private_key_pem(key: Ed25519PrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def load_private_key_pem(data: bytes) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(data, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("the stored key is not Ed25519")
    return key


def load_public_key_b64(value: str) -> Ed25519PublicKey:
    key = serialization.load_der_public_key(base64.b64decode(value, validate=True))
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError("public key is not Ed25519")
    return key


def _no_newlines(value: str, name: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError(f"request {name} must not contain newlines")
    return value


def signing_payload(method: str, path: str, body: bytes, destination_key_id: str, ts: int, nonce: str) -> str:
    return "\n".join([
        PAYLOAD_VERSION,
        _no_newlines(method.upper(), "method"),
        _no_newlines(path, "path"),
        sha256_hex(body),
        _no_newlines(destination_key_id, "destination key id"),
        str(int(ts)),
        _no_newlines(nonce, "nonce"),
    ])


def sign_request(
    key: Ed25519PrivateKey,
    method: str,
    path: str,
    body: bytes,
    destination_key_id: str,
    ts: int | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    """Headers for one request. A fresh nonce every time: the broker rejects replays."""
    ts = int(time.time() * 1000) if ts is None else ts
    nonce = base64.b64encode(secrets.token_bytes(16)).decode("ascii") if nonce is None else nonce
    payload = signing_payload(method, path, body, destination_key_id, ts, nonce)
    return {
        HEADERS["peer"]: key_id(key),
        HEADERS["ts"]: str(ts),
        HEADERS["nonce"]: nonce,
        HEADERS["signature"]: base64.b64encode(key.sign(payload.encode("utf-8"))).decode("ascii"),
    }


def claim_proof(key: Ed25519PrivateKey, device_code: str) -> str:
    """Proof of possession for a direct claim: Ed25519 over `context\\ndevice_code`."""
    return base64.b64encode(key.sign(f"{CLAIM_CONTEXT}\n{device_code}".encode("utf-8"))).decode("ascii")


def directory_proof(key: Ed25519PrivateKey, owner: str, ts: int, nonce: str) -> str:
    """Signs a machine-directory read: Ed25519 over `context\nowner\nts\nnonce`."""
    message = f"{DIRECTORY_CONTEXT}\n{_no_newlines(owner, 'owner')}\n{int(ts)}\n{_no_newlines(nonce, 'nonce')}"
    return base64.b64encode(key.sign(message.encode("utf-8"))).decode("ascii")


def canonical_json(value: object) -> str:
    """The broker's canonical JSON (node-identity.ts canonicalJson): sorted keys, no whitespace."""
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(value[k])}" for k in keys) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, bool) or value is None or isinstance(value, (int, str)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    raise ValueError("node cards carry only strings, integers, booleans, lists and objects")


class CardError(ValueError):
    pass


def verify_node_card(card: object, expected_key_id: str, now_ms: int | None = None, allow_expired: bool = False) -> dict:
    """Verifies a signed node card and returns it. The node key id is the trust anchor."""
    if not isinstance(card, dict):
        raise CardError("node card is not an object")
    try:
        public = load_public_key_b64(str(card.get("publicKey", "")))
    except Exception as error:
        raise CardError("node card public key is invalid") from error
    if key_id(public) != card.get("keyId") or card.get("keyId") != expected_key_id:
        raise CardError("node card is for a different node key")
    tls = card.get("tls")
    pin = tls.get("spkiFingerprint") if isinstance(tls, dict) else None
    if not isinstance(pin, str) or len(pin) != 64 or any(c not in "0123456789abcdef" for c in pin):
        raise CardError("node card carries no TLS pin")
    expires = card.get("expiresAt")
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    if not isinstance(expires, int) or (not allow_expired and expires <= now_ms):
        raise CardError("node card has expired")
    unsigned = {k: v for k, v in card.items() if k != "signature"}
    try:
        public.verify(base64.b64decode(str(card.get("signature", "")), validate=True), canonical_json(unsigned).encode("utf-8"))
    except (InvalidSignature, ValueError) as error:
        raise CardError("node card signature is invalid") from error
    return card


def new_request_id() -> str:
    return "st-" + secrets.token_urlsafe(18).replace("-", "_")


__all__ = [
    "CardError",
    "HEADERS",
    "canonical_json",
    "claim_proof",
    "generate_key",
    "key_id",
    "load_private_key_pem",
    "new_request_id",
    "private_key_pem",
    "public_key_b64",
    "sign_request",
    "signing_payload",
    "verify_node_card",
]
