"""Multi-machine discovery end to end: two real TypeScript guest fixtures
("mini" and "laptop"), the owner directory contract, and a tailnet listing.

Each fixture is a separate node with its own node key, TLS key, agents and
grant, exactly as two Macs would be. The hosted directory is an in-process
stand-in that speaks the same contract and verifies the client's signature;
the hosted route itself is tested in apps/mesh-front-door. Each fixture
advertises an unresolvable tailnet name first and loopback second, so the
client's per-node endpoint fallback is exercised too.
"""

import base64
import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from scout_tailscale import cli, machines as machines_module
from scout_tailscale.core import Store, pair
from scout_tailscale.signing import DIRECTORY_CONTEXT, key_id, load_public_key_b64

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixture" / "guest-fixture.ts"
RUNTIME = ROOT.parent / "runtime" / "src" / "broker-guest-http-routes.ts"

sys.path.insert(0, str(Path(__file__).parent))
from test_fixture_e2e import free_port  # noqa: E402


class Fixture:
    def __init__(self, root: Path, name: str, agents: str):
        self.name, self.port, self.admin = name, free_port(), free_port()
        self.host = f"{name}.tailnet-test.invalid"
        state = root / name
        self.process = subprocess.Popen(
            ["bun", str(FIXTURE), "serve", "--host", "127.0.0.1", "--port", str(self.port), "--admin", str(self.admin),
             "--state", str(state), "--label", name, "--agents", agents, "--reply-delay-ms", "100",
             "--advertise", f"https://{self.host}:{self.port},https://127.0.0.1:{self.port}"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + 30
        while not (state / "fixture.json").exists():
            if time.time() > deadline or self.process.poll() is not None:
                raise RuntimeError(f"fixture {name} did not start")
            time.sleep(0.1)
        self.info = json.loads((state / "fixture.json").read_text())

    def grant(self, public_key: str, request_id: str, targets: str) -> dict:
        out = subprocess.run(["bun", str(FIXTURE), "grant", "--admin", str(self.admin), "--public-key", public_key,
                              "--request-id", request_id, "--targets", targets], check=True, capture_output=True, text=True)
        return json.loads(out.stdout)

    def revoke(self, request_id: str) -> None:
        subprocess.run(["bun", str(FIXTURE), "revoke", "--admin", str(self.admin), "--request-id", request_id],
                       check=True, capture_output=True)

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait(10)


class Directory:
    """The owner's directory, as oscout.net serves it: rows bound to the signing key."""

    def __init__(self):
        self.rows: list[dict] = []
        self.calls = 0

    def add(self, claim: dict, state: str = "active", request_id: str | None = None) -> None:
        bootstrap = claim["bootstrap"]
        self.rows.insert(0, {"request_id": request_id or f"req-{len(self.rows)}", "state": state,
                             "node_id": bootstrap["nodeId"], "grant_id": bootstrap["grantId"],
                             "label": bootstrap["card"].get("label"), "allowed_targets": claim["allowed_targets"],
                             "expires_at": claim["expires_at"], "bootstrap": bootstrap})

    def set_state(self, grant_id: str, state: str) -> None:
        for row in self.rows:
            if row["grant_id"] == grant_id:
                row["state"] = state

    def __call__(self, url: str, body: dict):
        self.calls += 1
        assert url == "https://oscout.net/arach/directory", url
        key = load_public_key_b64(body["public_key"])
        key.verify(base64.b64decode(body["proof"]), f"{DIRECTORY_CONTEXT}\narach\n{body['ts']}\n{body['nonce']}".encode())
        live = [r for r in self.rows if r["state"] in ("active", "revoking")]
        history = [r for r in self.rows if r not in live]
        return 200, {"protocol": "scout-directory/1", "owner": "arach", "client_key_id": key_id(key),
                     "machines": [{k: v for k, v in r.items() if k != "bootstrap" or r["state"] == "active"} for r in live + history]
                     + [{"request_id": "req-pending", "state": "pending", "node_id": None, "grant_id": None, "label": None,
                         "allowed_targets": [], "expires_at": None}],
                     "live_truncated": False, "history_truncated": False}


@unittest.skipUnless(shutil.which("bun") and RUNTIME.exists(), "needs bun and the repo runtime")
class DiscoveryEndToEnd(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.mini = Fixture(self.dir, "mini", "fixture.echo,mini.builder")
        self.laptop = Fixture(self.dir, "laptop", "fixture.echo")
        self.home = self.dir / "client"
        self.directory = Directory()
        # A tailnet listing: the two Scout machines plus a printer.
        status = {"Peer": {
            "a": {"HostName": "fixture-mini", "DNSName": f"{self.mini.host}.", "TailscaleIPs": ["100.64.0.1"], "Online": True},
            "b": {"HostName": "laptop", "DNSName": f"{self.laptop.host}.", "TailscaleIPs": ["100.64.0.2"], "Online": True},
            "c": {"HostName": "printer", "DNSName": "printer.tailnet-test.invalid.", "TailscaleIPs": ["100.64.0.9"], "Online": False},
        }}
        (self.dir / "status.json").write_text(json.dumps(status))
        fake = self.dir / "tailscale"
        fake.write_text(f"#!/bin/sh\ncat '{self.dir / 'status.json'}'\n")
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
        self.env = {"SCOUT_TAILSCALE_HOME": str(self.home), "SCOUT_TAILSCALE_PROXY": "direct", "SCOUT_TAILSCALE_TAILSCALE": str(fake)}

    def tearDown(self):
        self.mini.stop()
        self.laptop.stop()

    def run_cli(self, *argv):
        out = io.StringIO()
        with mock.patch.dict(os.environ, self.env), mock.patch.object(machines_module, "_post_hosted", self.directory), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = cli.main(["--json", *argv])
        return code, json.loads(out.getvalue() or "{}")

    def pair_first_machine(self):
        """Pairs with mini the normal way: join, owner approves on mini, signed claim."""
        _, key = self.run_cli("key")
        self.public_key = key["publicKey"]
        self.mini_claim = self.mini.grant(self.public_key, "req-mini-1", "fixture.echo,mini.builder")
        self.directory.add(self.mini_claim, request_id="req-mini-1")
        hosted_polls = [(200, self.mini_claim)]

        def hosted(url, body):
            if url.endswith("/join"):
                return 200, {"mode": "direct", "client_key_id": key["keyId"], "device_code": "ab" * 32,
                             "user_code": "BCDF-GHJK", "interval": 5, "expires_in": 600}
            return hosted_polls.pop(0)

        with mock.patch.dict(os.environ, self.env):
            pair(Store(self.home), "arach", "muse", sleep=lambda _: None, post=hosted)

    def test_discovery_choice_and_authority(self):
        self.pair_first_machine()
        # The owner approves a second request on the laptop; the client learns it from the directory.
        laptop_claim = self.laptop.grant(self.public_key, "req-laptop-1", "fixture.echo")
        self.directory.add(laptop_claim, request_id="req-laptop-1")

        code, listing = self.run_cli("machines")
        self.assertEqual(code, 0, listing)
        found = {m["label"]: m for m in listing["machines"]}
        self.assertEqual(set(found), {"mini", "laptop"})
        self.assertEqual({found[n]["status"] for n in found}, {"available"})
        self.assertEqual(sorted(a["id"] for a in found["mini"]["agents"]), ["fixture.echo", "mini.builder"])
        self.assertEqual([a["id"] for a in found["laptop"]["agents"]], ["fixture.echo"])
        self.assertEqual(found["mini"]["tailnet"], {"hostName": "fixture-mini", "online": True})
        self.assertEqual(listing["directory"]["pending"], 1)
        # A tailnet device is not a Scout service, and absence says nothing either way.
        self.assertEqual(listing["tailnet"]["otherDevices"],
                         [{"hostName": "printer", "dnsName": "printer.tailnet-test.invalid", "online": False, "scout": "not verified"}])

        # Only mini's grant allows mini.builder: chosen without asking.
        code, built = self.run_cli("ask", "--to", "mini.builder", "--wait", "10", "build it")
        self.assertEqual((code, built["state"], built["machine"]), (0, "completed", self.mini.info["nodeId"]))
        self.assertEqual(built["output"], "mini.builder received 8 bytes: build it")

        # Both allow fixture.echo and both answer: the caller must choose.
        code, choice = self.run_cli("ask", "--to", "fixture.echo", "hello")
        self.assertEqual((code, choice["error"]), (2, "machine_choice_required"))
        self.assertEqual(sorted(c["label"] for c in choice["candidates"]), ["laptop", "mini"])

        # An explicit choice is used and remembered.
        code, first = self.run_cli("ask", "--to", "fixture.echo", "--machine", "laptop", "--request-id", "ask-laptop-01", "--wait", "10", "one")
        self.assertEqual((code, first["machine"]), (0, self.laptop.info["nodeId"]))
        code, second = self.run_cli("ask", "--to", "fixture.echo", "--wait", "10", "two")
        self.assertEqual((code, second["machine"]), (0, self.laptop.info["nodeId"]))

        # An ask on mini, then the preference moves to laptop: resume stays on mini.
        code, on_mini = self.run_cli("ask", "--to", "fixture.echo", "--machine", "mini", "--request-id", "ask-mini-0001", "--wait", "10", "stay")
        self.assertEqual(on_mini["machine"], self.mini.info["nodeId"])
        self.run_cli("use", "laptop")
        code, resumed = self.run_cli("ask", "--resume", "ask-mini-0001")
        self.assertEqual((code, resumed["machine"], resumed["duplicate"], resumed["invocationId"]),
                         (0, self.mini.info["nodeId"], True, on_mini["invocationId"]))

        # The remembered machine goes offline: fail there, never move the work.
        self.laptop.stop()
        code, down = self.run_cli("ask", "--to", "fixture.echo", "offline")
        self.assertEqual((code, down["error"]), (1, "transport"))
        # With no remembered machine, the only reachable one is used.
        self.run_cli("use", "--clear")
        code, fallback = self.run_cli("ask", "--to", "fixture.echo", "--wait", "10", "whoever answers")
        self.assertEqual((code, fallback["machine"]), (0, self.mini.info["nodeId"]))
        code, listing = self.run_cli("machines")
        self.assertEqual({m["label"]: m["status"] for m in listing["machines"]}, {"mini": "available", "laptop": "unreachable"})

    def test_reapproval_never_turns_resume_into_a_new_ask(self):
        self.pair_first_machine()
        code, sent = self.run_cli("ask", "--to", "fixture.echo", "--request-id", "ask-before-01", "--wait", "10", "original")
        self.assertEqual((code, sent["state"]), (0, "completed"))
        old_grant = self.mini_claim["bootstrap"]["grantId"]
        # The owner revokes on mini, then approves the same key on mini again.
        self.mini.revoke("req-mini-1")
        self.directory.set_state(old_grant, "revoked")
        again = self.mini.grant(self.public_key, "req-mini-2", "fixture.echo")
        self.directory.add(again, request_id="req-mini-2")
        self.assertNotEqual(again["bootstrap"]["grantId"], old_grant)

        code, listing = self.run_cli("machines")
        self.assertEqual(listing["directory"]["changes"], [{"machine": self.mini.info["nodeId"], "change": "reapproved"}])
        self.assertEqual(listing["machines"][0]["status"], "available")
        journal_before = json.loads((self.home / "asks.json").read_text())

        # Resending under the new grant would be a second invocation: refused, nothing sent.
        code, resumed = self.run_cli("ask", "--resume", "ask-before-01")
        self.assertEqual((code, resumed["error"]), (4, "original_grant_gone"))
        code, waited = self.run_cli("wait", "ask-before-01", "--timeout", "1")
        self.assertEqual((code, waited["error"]), (4, "original_grant_gone"))
        self.assertEqual(json.loads((self.home / "asks.json").read_text()), journal_before)
        # New work under the new grant is fine.
        code, fresh = self.run_cli("ask", "--to", "fixture.echo", "--wait", "10", "new work")
        self.assertEqual((code, fresh["state"]), (0, "completed"))

    def test_revoked_machine_is_reported_and_not_chosen(self):
        self.pair_first_machine()
        laptop_claim = self.laptop.grant(self.public_key, "req-laptop-1", "fixture.echo")
        self.directory.add(laptop_claim, request_id="req-laptop-1")
        self.run_cli("machines")
        self.laptop.revoke("req-laptop-1")
        self.directory.set_state(laptop_claim["bootstrap"]["grantId"], "revoked")
        code, listing = self.run_cli("machines")
        self.assertEqual({m["label"]: m["status"] for m in listing["machines"]}, {"mini": "available", "laptop": "revoked"})
        code, only = self.run_cli("ask", "--to", "fixture.echo", "--wait", "10", "hi")
        self.assertEqual((code, only["machine"]), (0, self.mini.info["nodeId"]))
        code, refused = self.run_cli("ask", "--to", "fixture.echo", "--machine", "laptop", "hi")
        self.assertEqual((code, refused["error"]), (1, "target_not_allowed"))


if __name__ == "__main__":
    unittest.main()
