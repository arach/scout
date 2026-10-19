import base64
import json
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from scout_tailscale.signing import (
    CardError,
    canonical_json,
    claim_proof,
    key_id,
    public_key_b64,
    sign_request,
    signing_payload,
    verify_node_card,
)

VECTORS = Path(__file__).parent / "vectors"


def vector_key():
    data = json.loads((VECTORS / "signing-v1.json").read_text("utf-8"))
    key = serialization.load_der_private_key(base64.b64decode(data["privateKeyPkcs8"]), password=None)
    return data, key


class SigningVectors(unittest.TestCase):
    """The TypeScript broker produced these; Python must match them byte-for-byte."""

    def test_key_identity_matches_runtime(self):
        data, key = vector_key()
        self.assertEqual(bytes.fromhex(data["seedHex"]), key.private_bytes_raw())
        self.assertEqual(public_key_b64(key), data["publicKeySpki"])
        self.assertEqual(key_id(key), data["keyId"])

    def test_payloads_and_signatures_match_runtime(self):
        data, key = vector_key()
        for case in data["cases"]:
            with self.subTest(path=case["path"]):
                body = case["body"].encode("utf-8")
                payload = signing_payload(case["method"], case["path"], body, case["destinationKeyId"], case["ts"], case["nonce"])
                self.assertEqual(payload, case["payload"])
                headers = sign_request(key, case["method"], case["path"], body, case["destinationKeyId"], case["ts"], case["nonce"])
                self.assertEqual(headers["x-openscout-signature"], case["signature"])
                self.assertEqual(headers["x-openscout-peer"], data["keyId"])

    def test_newlines_cannot_be_smuggled_across_fields(self):
        _, key = vector_key()
        for field in ("path", "nonce"):
            with self.subTest(field=field):
                args = {"path": "/v1/guest/whoami", "nonce": "n"}
                args[field] = args[field] + "\nextra"
                with self.assertRaises(ValueError):
                    sign_request(key, "GET", args["path"], b"", "a" * 64, 1, args["nonce"])

    def test_fresh_nonce_per_request(self):
        _, key = vector_key()
        first = sign_request(key, "GET", "/v1/guest/whoami", b"", "a" * 64)
        second = sign_request(key, "GET", "/v1/guest/whoami", b"", "a" * 64)
        self.assertNotEqual(first["x-openscout-nonce"], second["x-openscout-nonce"])

    def test_claim_proof_is_bound_to_device_code(self):
        key = Ed25519PrivateKey.generate()
        proof = base64.b64decode(claim_proof(key, "ab" * 32))
        key.public_key().verify(proof, ("scout-tailscale-claim-v1\n" + "ab" * 32).encode())
        with self.assertRaises(Exception):
            key.public_key().verify(proof, ("scout-tailscale-claim-v1\n" + "cd" * 32).encode())


class NodeCards(unittest.TestCase):
    def setUp(self):
        data = json.loads((VECTORS / "node-card-v1.json").read_text("utf-8"))
        self.card, self.now = data["card"], data["verifiedAt"]

    def test_runtime_card_verifies(self):
        self.assertIs(verify_node_card(self.card, self.card["keyId"], self.now), self.card)

    def test_canonical_json_matches_runtime_sort_and_escaping(self):
        self.assertEqual(canonical_json({"b": 1, "a": ["x", {"d": True, "c": None}], "é": "\"✓\n"}),
                         '{"a":["x",{"c":null,"d":true}],"b":1,"é":"\\"✓\\n"}')

    def test_tampered_or_foreign_cards_are_refused(self):
        cases = {
            "endpoint swapped": {**self.card, "endpoints": ["https://attacker.example:443"]},
            "pin swapped": {**self.card, "tls": {"spkiFingerprint": "c" * 64}},
            "no pin": {k: v for k, v in self.card.items() if k != "tls"},
            "bad signature": {**self.card, "signature": base64.b64encode(b"\0" * 64).decode()},
        }
        for name, card in cases.items():
            with self.subTest(name):
                with self.assertRaises(CardError):
                    verify_node_card(card, self.card["keyId"], self.now)
        with self.assertRaises(CardError):
            verify_node_card(self.card, "d" * 64, self.now)

    def test_expiry_is_enforced_unless_recovering(self):
        later = self.card["expiresAt"] + 1
        with self.assertRaises(CardError):
            verify_node_card(self.card, self.card["keyId"], later)
        verify_node_card(self.card, self.card["keyId"], later, allow_expired=True)


if __name__ == "__main__":
    unittest.main()
