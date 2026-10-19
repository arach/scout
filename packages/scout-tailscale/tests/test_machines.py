import base64
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from scout_tailscale.core import GuestClient, ScoutError, Store, accept_bootstrap, add_machine, client_for_ask, migrate_state, pair
from scout_tailscale.machines import choose_machine, sync_directory, tailnet_peers
from scout_tailscale.transport import TransportError
from scout_tailscale.signing import canonical_json, key_id, public_key_b64

from test_core import NODE_KEY, FakeHosted, RecordingEndpoint, bootstrap_claim, signed_card


def row(claim, state="active", **extra):
    b = claim["bootstrap"]
    return {"request_id": "r", "state": state, "node_id": b["nodeId"], "grant_id": b["grantId"], "label": b["card"].get("label"),
            "allowed_targets": claim["allowed_targets"], "expires_at": claim["expires_at"],
            **({"bootstrap": b} if state == "active" else {}), **extra}


class DirectoryMerge(unittest.TestCase):
    def setUp(self):
        self.store = Store(Path(tempfile.mkdtemp()) / "s")
        pair(self.store, "arach", "muse", sleep=lambda _: None, post=FakeHosted(self.store, [(200, bootstrap_claim())]))

    def sync(self, rows, status=200):
        key = self.store.key()
        return sync_directory(self.store, post=lambda url, body: (status, {
            "protocol": "scout-directory/1", "client_key_id": key_id(key), "machines": rows}))

    def test_machines_missing_from_the_listing_are_kept(self):
        result = self.sync([])
        self.assertEqual(result["changes"], [])
        self.assertEqual(self.store.state()["machines"]["mini"]["state"], "active")

    def test_an_unreadable_directory_changes_nothing(self):
        before = self.store.state()
        self.assertFalse(self.sync([], status=503)["ok"])
        self.assertEqual(self.store.state(), before)

    def test_a_different_node_key_is_never_adopted_from_a_listing(self):
        other = Ed25519PrivateKey.generate()
        claim = bootstrap_claim()
        forged = signed_card()
        # Same node id, different node key: must not replace the pinned identity.
        forged = {**forged, "publicKey": public_key_b64(other), "keyId": key_id(other)}
        forged.pop("signature")
        forged["signature"] = base64.b64encode(other.sign(canonical_json(forged).encode())).decode()
        claim["bootstrap"] = {**claim["bootstrap"], "grantId": "grant-2", "nodeKeyId": key_id(other), "card": forged}
        result = self.sync([row(claim)])
        self.assertEqual(result["changes"], [{"machine": "mini", "change": "node_key_changed"}])
        self.assertEqual(self.store.state()["machines"]["mini"]["grant"]["id"], "grant-1")

    def test_an_ended_grant_is_not_revived_by_a_stale_listing(self):
        self.sync([row(bootstrap_claim(), state="revoked")])
        self.assertEqual(self.store.state()["machines"]["mini"]["state"], "revoked")
        self.sync([row(bootstrap_claim())])
        self.assertEqual(self.store.state()["machines"]["mini"]["state"], "revoked")

    def test_history_for_an_older_grant_does_not_touch_the_current_one(self):
        self.sync([row(bootstrap_claim(), state="revoked", grant_id="grant-0")])
        self.assertEqual(self.store.state()["machines"]["mini"]["state"], "active")


    def test_the_newest_active_grant_for_a_node_wins(self):
        newer = bootstrap_claim()
        newer["bootstrap"] = {**newer["bootstrap"], "grantId": "grant-new"}
        # Newest first, as the directory orders them: the older active row must not replace it.
        result = self.sync([row(newer), row(bootstrap_claim())])
        self.assertEqual(result["changes"], [{"machine": "mini", "change": "reapproved"}])
        self.assertEqual(self.store.state()["machines"]["mini"]["grant"]["id"], "grant-new")
        self.sync([row(newer), row(bootstrap_claim())])
        self.assertEqual(self.store.state()["machines"]["mini"]["grant"]["id"], "grant-new")


def other_node_claim(node_id: str, grant_id: str) -> dict:
    card = {**signed_card(), "nodeId": node_id, "label": node_id}
    card.pop("signature")
    card["signature"] = base64.b64encode(NODE_KEY.sign(canonical_json(card).encode())).decode()
    claim = bootstrap_claim(card)
    claim["bootstrap"] = {**claim["bootstrap"], "nodeId": node_id, "grantId": grant_id}
    return claim


class Choice(unittest.TestCase):
    def setUp(self):
        self.store = Store(Path(tempfile.mkdtemp()) / "s")
        pair(self.store, "arach", "muse", sleep=lambda _: None, post=FakeHosted(self.store, [(200, bootstrap_claim())]))
        add_machine(self.store, accept_bootstrap(other_node_claim("laptop", "grant-l")))

    def test_none_reachable_is_reported_as_such(self):
        def down(url, pin, proxy=None):
            return RecordingEndpoint([TransportError("connection refused")] * 4)
        with self.assertRaises(ScoutError) as caught:
            choose_machine(self.store, "scout.main", endpoint_factory=down)
        self.assertEqual((caught.exception.code, caught.exception.exit_code), ("no_reachable_machine", 1))
        self.assertNotIn("more than one", str(caught.exception))
        self.assertEqual(sorted(c["status"] for c in caught.exception.details["candidates"]), ["unreachable", "unreachable"])

    def test_concurrent_endpoint_updates_are_not_lost(self):
        for mid in ("mini", "laptop"):
            self.store.update_state(lambda state, mid=mid: state["machines"][mid]["node"].update(
                endpoints=["https://a.invalid:1", "https://b.invalid:1"]))
        clients = [GuestClient(self.store, lambda *a, **k: None, machine=m) for m in ("mini", "laptop") for _ in range(10)]
        barrier = threading.Barrier(len(clients))

        def remember(client, index):
            barrier.wait()
            client._remember_endpoint(f"https://{client.machine_id}-{index}.invalid:1")

        threads = [threading.Thread(target=remember, args=(c, i)) for i, c in enumerate(clients)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        known = self.store.state()["machines"]
        # Each machine keeps an endpoint written for it; neither update clobbered the other machine.
        self.assertTrue(known["mini"]["node"]["endpoint"].startswith("https://mini-"))
        self.assertTrue(known["laptop"]["node"]["endpoint"].startswith("https://laptop-"))

    def test_update_state_is_serialized(self):
        self.store.update_state(lambda state: {**state, "counter": 0})

        def bump():
            for _ in range(25):
                self.store.update_state(lambda state: {**state, "counter": state["counter"] + 1})

        threads = [threading.Thread(target=bump) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(self.store.state()["counter"], 200)


class LegacyJournal(unittest.TestCase):
    """0.1 wrote a single-node state.json and asks without their authority."""

    def write_v1(self, grant_id="grant-1"):
        root = Path(tempfile.mkdtemp()) / "s"
        store = Store(root)
        store.key(create=True)
        accepted = accept_bootstrap(bootstrap_claim())
        grant = {**accepted["grant"], "id": grant_id} if grant_id else {k: v for k, v in accepted["grant"].items() if k != "id"}
        store.save_state({"node": accepted["node"], "grant": grant, "owner": "arach", "pairedAt": 1})
        store.save_asks({"st-legacy-0001": {"target": "scout.main", "task": "old work", "state": "running", "createdAt": 1}})
        return store

    def test_upgrade_binds_old_asks_then_reapproval_refuses_resume(self):
        store = self.write_v1()
        store.state()  # upgrade on first read
        self.assertEqual({k: store.asks()["st-legacy-0001"][k] for k in ("node", "nodeKeyId", "grantId")},
                         {"node": "mini", "nodeKeyId": key_id(NODE_KEY), "grantId": "grant-1"})
        self.assertNotIn("node", json.loads((store.root / "state.json").read_text()))
        # The owner revokes and approves again on the same node: a new grant.
        newer = bootstrap_claim()
        newer["bootstrap"] = {**newer["bootstrap"], "grantId": "grant-2"}
        sync_directory(store, post=lambda url, body: (200, {"protocol": "scout-directory/1", "client_key_id": key_id(store.key()),
                                                             "machines": [row(newer), row(bootstrap_claim(), state="revoked")]}))
        endpoint = RecordingEndpoint([])
        client = client_for_ask(store, "st-legacy-0001", lambda *a, **k: endpoint)
        with self.assertRaises(ScoutError) as caught:
            client.resume("st-legacy-0001")
        self.assertEqual((caught.exception.code, caught.exception.exit_code), ("original_grant_gone", 4))
        self.assertEqual(endpoint.requests, [])

    def test_unprovable_origins_fail_closed(self):
        store = self.write_v1(grant_id=None)
        store.state()
        self.assertNotIn("node", store.asks()["st-legacy-0001"])
        with self.assertRaises(ScoutError) as caught:
            client_for_ask(store, "st-legacy-0001")
        self.assertEqual((caught.exception.code, caught.exception.exit_code), ("unbound_ask", 4))
        # A partially recorded origin is refused too, before anything is sent.
        store.update_asks(lambda journal: journal["st-legacy-0001"].update(node="mini"))
        endpoint = RecordingEndpoint([])
        with self.assertRaises(ScoutError) as caught:
            client_for_ask(store, "st-legacy-0001", lambda *a, **k: endpoint).resume("st-legacy-0001")
        self.assertEqual(caught.exception.code, "unbound_ask")
        self.assertEqual(endpoint.requests, [])


class Compatibility(unittest.TestCase):
    def test_single_node_state_migrates(self):
        v1 = {"node": {"id": "mini", "keyId": "k", "endpoint": "https://m:1", "pin": "p"}, "grant": {"id": "g"},
              "owner": "arach", "pairedAt": 1, "proxy": "http://t:1"}
        v2 = migrate_state(v1)
        self.assertEqual(v2["machines"]["mini"]["grant"], {"id": "g"})
        self.assertEqual((v2["owner"], v2["proxy"], v2["version"]), ("arach", "http://t:1", 2))
        self.assertNotIn("node", v2)

    def test_tailnet_listing_is_optional(self):
        def missing(*_, **__):
            raise FileNotFoundError("tailscale")
        with mock.patch.dict(os.environ, {"SCOUT_TAILSCALE_TAILSCALE": "tailscale"}):
            self.assertEqual(tailnet_peers(run=missing)["available"], False)


if __name__ == "__main__":
    unittest.main()
