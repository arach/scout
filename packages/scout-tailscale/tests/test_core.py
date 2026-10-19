import base64
import contextlib
import io
import json
import os
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from scout_tailscale import cli
from scout_tailscale.core import GuestClient, ScoutError, Store, pair, parse_owner
from scout_tailscale.signing import canonical_json, key_id, load_public_key_b64, public_key_b64, signing_payload
from scout_tailscale.transport import TransportError

NODE_KEY = Ed25519PrivateKey.generate()


def signed_card(endpoints=("https://mini.tail.ts.net:43111", "http://127.0.0.1:43110"), pin="b" * 64, expires_in=86_400_000):
    now = int(time.time() * 1000)
    card = {"nodeId": "mini", "label": "Mini", "publicKey": public_key_b64(NODE_KEY), "keyId": key_id(NODE_KEY),
            "fingerprint": "osc1:test", "version": "dev", "capabilities": [], "endpoints": sorted(endpoints),
            "issuedAt": now, "expiresAt": now + expires_in, "nonce": "n", "tls": {"spkiFingerprint": pin}}
    card["signature"] = base64.b64encode(NODE_KEY.sign(canonical_json(card).encode())).decode()
    return card


def bootstrap_claim(card=None):
    card = card or signed_card()
    return {"mode": "direct", "allowed_targets": ["scout.main"], "expires_at": "2026-10-28T00:00:00.000Z",
            "bootstrap": {"protocol": "scout-guest/1", "grantId": "grant-1", "nodeId": "mini", "nodeKeyId": key_id(NODE_KEY), "card": card}}


class FakeHosted:
    def __init__(self, store: Store, polls):
        self.store, self.polls, self.calls = store, list(polls), []

    def __call__(self, url, body):
        self.calls.append((url, body))
        if url.endswith("/join"):
            client_key = load_public_key_b64(body["public_key"])
            return 200, {"mode": "direct", "client_key_id": key_id(client_key), "device_code": "ab" * 32,
                         "user_code": "BCDF-GHJK", "interval": 5, "expires_in": 600}
        # Every poll must carry a proof from the key bound at join.
        join_key = load_public_key_b64(self.calls[0][1]["public_key"])
        join_key.verify(base64.b64decode(body["proof"]), ("scout-tailscale-claim-v1\n" + body["device_code"]).encode())
        return self.polls.pop(0)


class TempStore(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.store = Store(Path(self.dir) / "state")


class Pairing(TempStore):
    def test_join_failure_retains_status_and_safe_error_without_credentials(self):
        for status, body, expected in [
            (503, {"error": "service_unavailable"}, "service_unavailable"),
            (200, {"mode": "hosted", "device_code": "secret-device-code"}, "unexpected_response"),
            (403, {"error": "secret-device-code", "token": "secret-token"}, "unexpected_response"),
        ]:
            with self.subTest(status=status, body=body):
                with self.assertRaises(ScoutError) as caught:
                    pair(self.store, "arach", "muse", wait=False, post=lambda *_: (status, body))
                error = caught.exception
                self.assertEqual(error.code, "join_failed")
                self.assertEqual(error.details, {"httpStatus": status, "error": expected})
                self.assertIn(f"HTTP {status}, {expected}", str(error))
                self.assertNotIn("secret-", str(error))
                self.assertNotIn("pending", self.store.state())

    def test_pairs_after_approval_with_signed_claims(self):
        hosted = FakeHosted(self.store, [(400, {"error": "authorization_pending"}), (400, {"error": "slow_down"}), (200, bootstrap_claim())])
        codes = []
        result = pair(self.store, "https://oscout.net/Arach", "muse", on_code=codes.append, sleep=lambda _: None, post=hosted)
        self.assertEqual(hosted.calls[0][0], "https://oscout.net/arach/join")
        self.assertEqual(codes[0].user_code, "BCDF-GHJK")
        self.assertEqual(result["node"]["endpoint"], "https://mini.tail.ts.net:43111")
        self.assertEqual(result["node"]["pin"], "b" * 64)
        state = self.store.state()
        self.assertNotIn("pending", state)
        self.assertEqual(state["machines"]["mini"]["grant"]["allowedTargets"], ["scout.main"])

    def test_resume_reuses_the_pending_request(self):
        hosted = FakeHosted(self.store, [(200, bootstrap_claim())])
        pair(self.store, "arach", "muse", wait=False, post=hosted)
        resumed = []
        pair(self.store, "arach", "muse", on_code=resumed.append, sleep=lambda _: None, post=hosted)
        self.assertEqual([url for url, _ in hosted.calls].count("https://oscout.net/arach/join"), 1)
        self.assertTrue(resumed[0].resumed)
        # Once paired, connecting again requests another machine: a new join, same key.
        pair(self.store, "arach", "muse", wait=False, post=hosted)
        self.assertEqual([url for url, _ in hosted.calls].count("https://oscout.net/arach/join"), 2)
        self.assertEqual(hosted.calls[-1][1]["public_key"], hosted.calls[0][1]["public_key"])
        with self.assertRaises(ScoutError) as caught:
            pair(self.store, "someone-else", "muse", wait=False, post=hosted)
        self.assertEqual(caught.exception.code, "other_owner")

    def test_denial_clears_pending_and_bad_bootstraps_are_refused(self):
        hosted = FakeHosted(self.store, [(400, {"error": "access_denied"})])
        with self.assertRaises(ScoutError) as caught:
            pair(self.store, "arach", "muse", sleep=lambda _: None, post=hosted)
        self.assertEqual(caught.exception.code, "access_denied")
        self.assertNotIn("pending", self.store.state())

        tampered = bootstrap_claim()
        tampered["bootstrap"]["card"] = {**tampered["bootstrap"]["card"], "endpoints": ["https://evil.example"]}
        for claim in [tampered, bootstrap_claim(signed_card(endpoints=("http://127.0.0.1:43110",)))]:
            store = Store(Path(tempfile.mkdtemp()) / "s")
            with self.assertRaises(ScoutError):
                pair(store, "arach", "muse", sleep=lambda _: None, post=FakeHosted(store, [(200, claim)]))
            self.assertNotIn("node", store.state())

    def test_owner_must_be_a_profile(self):
        for owner in ["https://evil.example/arach", "http://oscout.net/arach", "oscout.net/a/b", "-bad"]:
            with self.assertRaises(ScoutError):
                parse_owner(owner)
        self.assertEqual(parse_owner("oscout.net/Arach"), "arach")

    def test_state_is_owner_only(self):
        pair(self.store, "arach", "muse", wait=False, post=FakeHosted(self.store, []))
        self.assertEqual(stat.S_IMODE(os.stat(self.store.root).st_mode), 0o700)
        for name in ("key.pem", "state.json"):
            self.assertEqual(stat.S_IMODE(os.stat(self.store.root / name).st_mode), 0o600)
        self.assertEqual(self.store.permission_problems(), [])


class RecordingEndpoint:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def request(self, method, path, body=b"", headers=None, timeout=None):
        self.requests.append((method, path, body, headers))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        status, payload = response
        return status, {}, json.dumps(payload).encode()


class Guest(TempStore):
    def setUp(self):
        super().setUp()
        pair(self.store, "arach", "muse", sleep=lambda _: None, post=FakeHosted(self.store, [(200, bootstrap_claim())]))

    def client(self, responses):
        endpoint = RecordingEndpoint(responses)
        return GuestClient(self.store, lambda url, pin, proxy=None: endpoint), endpoint

    def test_node_card_accepts_broker_envelope_and_legacy_card(self):
        card = signed_card()
        for response in [card, {"id": "mini", "card": card, "gateMode": "enforce"}]:
            with self.subTest(response=response):
                client, endpoint = self.client([(200, response)])
                self.assertEqual(client.node_card(), card)
                self.assertEqual(endpoint.requests[0][:2], ("GET", "/v1/node"))

    def test_node_card_envelope_never_bypasses_verification(self):
        card = signed_card()
        invalid = [None, {}, [], {**card, "label": "tampered"}, signed_card(expires_in=-1)]
        for nested in invalid:
            with self.subTest(nested=nested):
                # Even a valid outer card must not rescue an invalid nested card.
                client, _ = self.client([(200, {**card, "card": nested})])
                with self.assertRaises(ScoutError) as caught:
                    client.node_card()
                self.assertEqual(caught.exception.code, "node_card_invalid")

    def test_session_is_bound_to_its_original_grant(self):
        client, endpoint = self.client([(200, {"sessionId": "sess.mailbox"}), (200, {"items": []})])
        client.attach_session("muse-thread")
        self.assertEqual(client.session_action("poll", "sess.mailbox"), {"items": []})
        self.assertEqual(endpoint.requests[1][1], "/v1/guest/sessions/poll")
        client.grant = {**client.grant, "id": "replacement-grant"}
        with self.assertRaises(ScoutError) as raised:
            client.session_action("reply", "sess.mailbox", deliveryId="delivery", body="hello")
        self.assertEqual(raised.exception.code, "session_origin_changed")
        self.assertEqual(len(endpoint.requests), 2)

    def test_requests_are_signed_for_the_paired_node(self):
        client, endpoint = self.client([(200, {"agents": [{"id": "scout.main"}]})])
        self.assertEqual(client.agents("helper bot"), [{"id": "scout.main"}])
        method, path, body, headers = endpoint.requests[0]
        self.assertEqual(path, "/v1/guest/agents?query=helper%20bot")
        payload = signing_payload(method, path, body, key_id(NODE_KEY), int(headers["x-openscout-ts"]), headers["x-openscout-nonce"])
        self.store.key().public_key().verify(base64.b64decode(headers["x-openscout-signature"]), payload.encode())

    def test_ask_is_journaled_before_sending_and_resumes_with_the_same_id(self):
        client, endpoint = self.client([TransportError("connection reset"), (200, {"requestId": "x", "duplicate": True, "state": "running"})])
        with self.assertRaises(TransportError):
            client.ask("scout.main", "summarize the build", "st-retry-001")
        self.assertEqual(self.store.asks()["st-retry-001"]["state"], "sending")
        client.resume("st-retry-001")
        first, second = (json.loads(r[2]) for r in endpoint.requests)
        self.assertEqual(first, second)
        self.assertEqual(self.store.asks()["st-retry-001"]["state"], "running")
        with self.assertRaises(ScoutError):
            client.ask("scout.main", "a different task", "st-retry-001")

    def test_wait_is_bounded_per_request(self):
        client, endpoint = self.client([(200, {"requestId": "st-1", "state": "running"}), (200, {"requestId": "st-1", "state": "completed", "output": "done"})])
        result = client.wait("st-1", timeout=300)
        self.assertEqual(result["output"], "done")
        self.assertTrue(all(path.endswith("?wait=20") for _, path, _, _ in endpoint.requests))

    def test_node_errors_carry_codes(self):
        client, _ = self.client([(401, {"error": "grant_inactive"})])
        with self.assertRaises(ScoutError) as caught:
            client.whoami()
        self.assertEqual((caught.exception.code, caught.exception.exit_code), ("grant_inactive", 4))


class Cli(TempStore):
    def run_cli(self, *argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        environ = {"SCOUT_TAILSCALE_HOME": str(self.store.root), **(env or {})}
        with mock.patch.dict(os.environ, environ), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = cli.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_status_json_never_contains_secrets(self):
        pair(self.store, "arach", "muse", wait=False, post=FakeHosted(self.store, []))
        code, out, _ = self.run_cli("--json", "status", env={"HTTPS_PROXY": "http://u:hunter2@proxy:1"})
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["pending"]["userCode"], "BCDF-GHJK")
        for secret in ["ab" * 32, "PRIVATE KEY", "hunter2"]:
            self.assertNotIn(secret, out)

    def connect(self, whoami_response, proxy_env=None):
        endpoint = RecordingEndpoint([whoami_response])
        seen = {}

        def factory(url, pin, proxy=None):
            seen["proxy"] = proxy
            return endpoint

        hosted = FakeHosted(self.store, [(200, bootstrap_claim())])
        real_pair = cli.pair
        with mock.patch.object(cli, "pair", lambda *a, **k: real_pair(*a, **k, sleep=lambda _: None, post=hosted)), \
                mock.patch.object(cli, "GuestClient", lambda store, **kw: GuestClient(store, factory, **kw)):
            result = self.run_cli("--json", "connect", "--owner", "arach", "--proxy", "http://tunnel:8080", env=proxy_env)
        return (*result, seen)

    def test_connect_reports_connected_only_after_a_signed_request_is_accepted(self):
        code, out, _, seen = self.connect((200, {"grant": {"id": "grant-1"}}), {"HTTPS_PROXY": "http://public-egress:3128"})
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["verified"], True)
        # The explicit tunnel proxy is used for node traffic, not the ambient egress proxy.
        self.assertEqual(seen["proxy"], "http://tunnel:8080")

    def test_connect_with_pin_mismatch_is_not_connected_and_exits_3(self):
        from scout_tailscale.transport import PinMismatch
        code, out, _, _ = self.connect(PinMismatch("f" * 64))
        payload = json.loads(out)
        self.assertEqual((code, payload["ok"], payload["paired"], payload["verified"], payload["error"]), (3, False, True, False, "pin_mismatch"))

    def test_connect_with_refused_signature_is_not_connected(self):
        code, out, _, _ = self.connect((401, {"error": "unauthorized"}))
        payload = json.loads(out)
        self.assertEqual((code, payload["ok"], payload["verified"]), (4, False, False))
        self.assertNotIn("Connected", out)

    def test_unpaired_commands_exit_4(self):
        code, out, _ = self.run_cli("--json", "who")
        self.assertEqual((code, json.loads(out)["error"]), (4, "not_paired"))


if __name__ == "__main__":
    unittest.main()
