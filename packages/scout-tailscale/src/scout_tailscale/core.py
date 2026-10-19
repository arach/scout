"""Shared core: local state, pairing through a profile owner, and the guest API.

State lives in one owner-only directory ($SCOUT_TAILSCALE_HOME, else
$XDG_CONFIG_HOME/scout-tailscale, else ~/.config/scout-tailscale):

    key.pem       Ed25519 private key (0600). Never leaves this machine.
    state.json    owner, pending request, and `machines`: per Scout node its
                  pinned identity (id, key id, endpoints, pin) and the grant
                  that node's owner approved. Grants are per node.
    asks.json     ask journal: every requestId is written, with the node,
                  node key and grant it is sent under, before it is sent, so
                  a retry after a lost response is the same ask on the same
                  authority, never a new one elsewhere.
"""

from __future__ import annotations

import contextlib
import fcntl
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from . import PROTOCOL, __version__
from .signing import (
    CardError,
    claim_proof,
    generate_key,
    key_id,
    load_private_key_pem,
    new_request_id,
    private_key_pem,
    public_key_b64,
    sign_request,
    verify_node_card,
)
from .transport import PinMismatch, PinnedEndpoint, TransportError

PROFILE_ORIGIN = "https://oscout.net"
TOKEN_URL = "https://mcp.oscout.net/v1/mcp/device/token"
HANDLE = re.compile(r"[a-z0-9][a-z0-9-]{0,38}")
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,64}")
TERMINAL_STATES = {"completed", "failed", "cancelled"}
MAX_WAIT_SECONDS = 20
STATE_VERSION = 2


class ScoutError(Exception):
    """A user-facing failure. `code` is stable for --json output."""

    def __init__(self, code: str, message: str, exit_code: int = 1, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.exit_code = exit_code
        self.details = details or {}


def state_dir() -> Path:
    explicit = os.environ.get("SCOUT_TAILSCALE_HOME")
    if explicit:
        return Path(explicit)
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(Path.home(), ".config")
    return Path(base) / "scout-tailscale"


def write_private(path: Path, data: bytes) -> None:
    """Atomic owner-only write: the file is never briefly readable by others."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def node_proxy(state: dict) -> str | None:
    """The proxy for private node traffic: $SCOUT_TAILSCALE_PROXY, else the one
    saved with `connect --proxy`, else a direct connection. `direct` forces none."""
    value = os.environ.get("SCOUT_TAILSCALE_PROXY") or state.get("proxy") or None
    return None if value in (None, "", "direct", "none") else value


_LOCKS: dict[str, list] = {}
_LOCKS_GUARD = threading.Lock()


class Store:
    def __init__(self, root: Path | None = None):
        self.root = root or state_dir()

    @contextlib.contextmanager
    def transaction(self):
        """Serializes read-modify-write of state.json and asks.json: a thread lock for
        this process (probes run concurrently) plus an flock for other processes.
        Re-entrant within a thread."""
        with _LOCKS_GUARD:
            slot = _LOCKS.setdefault(str(self.root.absolute()), [threading.RLock(), 0, None])
        with slot[0]:
            if slot[1] == 0:
                self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
                slot[2] = open(self.root / ".lock", "a+b")
                os.chmod(self.root / ".lock", 0o600)
                fcntl.flock(slot[2].fileno(), fcntl.LOCK_EX)
            slot[1] += 1
            try:
                yield
            finally:
                slot[1] -= 1
                if slot[1] == 0:
                    fcntl.flock(slot[2].fileno(), fcntl.LOCK_UN)
                    slot[2].close()
                    slot[2] = None

    def update_state(self, change: Callable[[dict], dict | None]) -> dict:
        """Applies `change` to the current state under the lock; it may mutate or return a new dict."""
        with self.transaction():
            state = self.state()
            result = change(state)
            state = state if result is None else result
            self.save_state(state)
            return state

    def update_asks(self, change: Callable[[dict], dict | None]) -> dict:
        with self.transaction():
            journal = self.asks()
            result = change(journal)
            journal = journal if result is None else result
            self.save_asks(journal)
            return journal

    @property
    def key_path(self) -> Path:
        return self.root / "key.pem"

    def _read(self, name: str) -> dict:
        try:
            value = json.loads((self.root / name).read_text("utf-8"))
            return value if isinstance(value, dict) else {}
        except FileNotFoundError:
            return {}
        except json.JSONDecodeError as error:
            raise ScoutError("state_corrupt", f"{self.root / name} is not valid JSON; move it aside and pair again") from error

    def _write(self, name: str, value: dict) -> None:
        write_private(self.root / name, (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8"))

    def state(self) -> dict:
        raw = self._read("state.json")
        if "node" not in raw:
            return raw
        # v1 on disk: bind its asks to the single node and grant they were
        # sent under, then write v2. Asks first, so an interruption repeats
        # the binding (it only fills missing fields) rather than losing it.
        with self.transaction():
            raw = self._read("state.json")
            if "node" not in raw:
                return raw
            origin = legacy_origin(raw)
            if origin:
                journal = self.asks()
                if any(not entry.get("node") for entry in journal.values()):
                    self.save_asks({rid: entry if entry.get("node") else {**entry, **origin} for rid, entry in journal.items()})
            migrated = migrate_state(raw)
            self.save_state(migrated)
            return migrated

    def save_state(self, value: dict) -> None:
        self._write("state.json", value)

    def asks(self) -> dict:
        return self._read("asks.json")

    def save_asks(self, value: dict) -> None:
        self._write("asks.json", value)

    def key(self, create: bool = False):
        try:
            return load_private_key_pem(self.key_path.read_bytes())
        except FileNotFoundError:
            if not create:
                return None
        key = generate_key()
        write_private(self.key_path, private_key_pem(key))
        return key

    def permission_problems(self) -> list[str]:
        problems = []
        for path in [self.root, self.key_path, self.root / "state.json", self.root / "asks.json"]:
            if path.exists() and path.stat().st_mode & 0o077:
                problems.append(f"{path} is readable by other users (chmod {'700' if path.is_dir() else '600'})")
        return problems

    def clear(self, keep_key: bool = False) -> None:
        for name in ["state.json", "asks.json"] + ([] if keep_key else ["key.pem"]):
            try:
                (self.root / name).unlink()
            except FileNotFoundError:
                pass


def migrate_state(state: dict) -> dict:
    """v1 held one `node` and `grant`; v2 keys machines by node id."""
    if "node" not in state:
        return state
    node, grant = state.get("node"), state.get("grant") or {}
    rest = {k: v for k, v in state.items() if k not in ("node", "grant", "pairedAt")}
    known = dict(rest.get("machines") or {})
    if isinstance(node, dict) and node.get("id"):
        known[node["id"]] = {"node": node, "grant": grant, "state": "active", "pairedAt": state.get("pairedAt")}
    return {**rest, "version": STATE_VERSION, "machines": known}


def legacy_origin(v1: dict) -> dict | None:
    """The authority every v1 ask was sent under: v1 knew exactly one node and grant."""
    node, grant = v1.get("node") or {}, v1.get("grant") or {}
    if node.get("id") and node.get("keyId") and grant.get("id"):
        return {"node": node["id"], "nodeKeyId": node["keyId"], "grantId": grant["id"]}
    return None


def machines(state: dict) -> dict:
    return state.get("machines") or {}


def machine_label(entry: dict) -> str:
    return entry["node"].get("label") or entry["node"]["id"]


def resolve_machine(state: dict, name: str) -> str:
    """A machine by node id or friendly name (case-insensitive)."""
    known = machines(state)
    if name in known:
        return name
    wanted = name.strip().lower()
    matches = sorted({mid for mid, entry in known.items() if mid.lower() == wanted or (entry["node"].get("label") or "").lower() == wanted})
    if len(matches) == 1:
        return matches[0]
    if matches:
        raise ScoutError("ambiguous_machine", f"{name!r} names more than one machine; use its node id: {', '.join(matches)}", 2)
    raise ScoutError("unknown_machine", f"no paired machine is called {name!r}; see `scout-tailscale machines`", 2)


def grant_expired(grant: dict, now: float | None = None) -> bool:
    raw = grant.get("expiresAt")
    if not isinstance(raw, str):
        return False
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp() <= (time.time() if now is None else now)
    except ValueError:
        return False


def add_machine(store: Store, accepted: dict, *, clock: Callable[[], float] = time.time, **extra) -> dict:
    """Records a newly approved grant for its node. Another node's grant is untouched;
    a node that presents a different node key is refused, never silently replaced."""
    node = accepted["node"]
    entry = {"node": node, "grant": accepted["grant"], "state": "active", "pairedAt": int(clock() * 1000)}

    def change(state: dict) -> dict:
        existing = machines(state).get(node["id"])
        if existing and existing["node"]["keyId"] != node["keyId"]:
            raise ScoutError("node_key_changed", f"{machine_label(existing)} now has a different node key; "
                             f"run `scout-tailscale disconnect --machine {node['id']}` first if the owner confirms it", 1)
        return {**{k: v for k, v in state.items() if k != "pending"}, **extra, "version": STATE_VERSION,
                "machines": {**machines(state), node["id"]: entry}}

    store.update_state(change)
    return entry


def parse_owner(owner: str) -> str:
    """`arach`, `oscout.net/arach` or `https://oscout.net/arach` → `arach`."""
    value = owner.strip()
    if "://" not in value and "/" not in value:
        handle = value.lower()
    else:
        parts = urllib.parse.urlsplit(value if "://" in value else "https://" + value)
        if parts.scheme != "https" or parts.netloc != "oscout.net" or parts.query or parts.fragment:
            raise ScoutError("invalid_owner", "--owner must be a profile such as https://oscout.net/arach", 2)
        handle = parts.path.strip("/").lower()
    if not HANDLE.fullmatch(handle):
        raise ScoutError("invalid_owner", "--owner must be a profile such as https://oscout.net/arach", 2)
    return handle


def _post_hosted(url: str, body: dict, timeout: float = 30.0) -> tuple[int, dict]:
    """Hosted pairing calls use ordinary CA-verified HTTPS (and the environment's proxy)."""
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST", headers={
        "content-type": "application/json", "user-agent": f"scout-tailscale/{__version__}",
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read(65536) or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read(65536) or b"{}")
        except json.JSONDecodeError:
            return error.code, {}
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as error:
        raise ScoutError("hosted_unreachable", f"could not reach {urllib.parse.urlsplit(url).netloc}: {getattr(error, 'reason', error)}") from error


def choose_endpoint(card: dict, preferred: str | None = None) -> str:
    endpoints = [e for e in card.get("endpoints", []) if isinstance(e, str) and e.startswith("https://")]
    if preferred:
        if preferred not in endpoints:
            raise ScoutError("unknown_endpoint", "that endpoint is not one the node's signed card lists", 2)
        return preferred
    remote = [e for e in endpoints if not _loopback(e)]
    if remote:
        return remote[0]
    if endpoints:
        return endpoints[0]  # same-host use; still pinned to the node's key
    raise ScoutError("no_endpoint", "the node advertises no https endpoint; ask the owner to enable its tailnet listener")


def _loopback(url: str) -> bool:
    return urllib.parse.urlsplit(url).hostname in ("127.0.0.1", "localhost", "::1")


def accept_bootstrap(claim: dict, now_ms: int | None = None, endpoint: str | None = None) -> dict:
    """Validates a direct claim's bootstrap into the node + grant state."""
    bootstrap = claim.get("bootstrap")
    if not isinstance(bootstrap, dict) or bootstrap.get("protocol") != PROTOCOL:
        raise ScoutError("invalid_bootstrap", "the pairing response did not contain a Scout bootstrap")
    node_key_id = bootstrap.get("nodeKeyId")
    if not isinstance(node_key_id, str) or not re.fullmatch(r"[0-9a-f]{64}", node_key_id):
        raise ScoutError("invalid_bootstrap", "the bootstrap names no node key")
    try:
        # A recovered claim can carry a card older than its 24h freshness; the
        # signature still binds it to the node key, and `doctor` refreshes it
        # over the pinned connection.
        card = verify_node_card(bootstrap.get("card"), node_key_id, now_ms, allow_expired=True)
    except CardError as error:
        raise ScoutError("invalid_bootstrap", f"the node card failed verification: {error}") from error
    if card.get("nodeId") != bootstrap.get("nodeId"):
        raise ScoutError("invalid_bootstrap", "the node card names a different node")
    return {
        "node": {
            "id": card["nodeId"],
            "keyId": node_key_id,
            "label": card.get("label"),
            "pin": card["tls"]["spkiFingerprint"],
            "endpoint": choose_endpoint(card, endpoint),
            "endpoints": [e for e in card.get("endpoints", []) if isinstance(e, str)],
            "cardExpiresAt": card.get("expiresAt"),
        },
        "grant": {
            "id": bootstrap.get("grantId"),
            "allowedTargets": claim.get("allowed_targets") or [],
            "expiresAt": claim.get("expires_at"),
        },
    }


def import_bootstrap(store: Store, claim: dict, expected_node_key_id: str, *, endpoint: str | None = None,
                     proxy: str | None = None, clock: Callable[[], float] = time.time) -> dict:
    """Pairs from a bootstrap delivered out of band (integration fixtures, manual
    enrollment). The node key id must come from a separate trusted channel: it
    is the only anchor, since the file itself is unauthenticated."""
    if store.key() is None:
        raise ScoutError("no_key", "no key yet; run `scout-tailscale key` and enroll that public key first", 2)
    if not re.fullmatch(r"[0-9a-f]{64}", expected_node_key_id or ""):
        raise ScoutError("usage", "--node-key must be the node's 64-hex key id", 2)
    bootstrap = claim.get("bootstrap") if isinstance(claim, dict) else None
    if not isinstance(bootstrap, dict) or bootstrap.get("nodeKeyId") != expected_node_key_id:
        raise ScoutError("invalid_bootstrap", "the bootstrap is for a different node key than --node-key")
    accepted = accept_bootstrap(claim, endpoint=endpoint)
    add_machine(store, accepted, clock=clock, **({"proxy": proxy} if proxy else {}))
    return accepted


@dataclass
class PairingProgress:
    user_code: str
    owner: str
    resumed: bool


def pair(store: Store, owner: str, name: str, *, wait: bool = True, proxy: str | None = None,
         on_code: Callable[[PairingProgress], None] = lambda _: None,
         sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.time,
         post: Callable[[str, dict], tuple[int, dict]] = _post_hosted) -> dict | None:
    """Requests access from a profile owner. Once paired, the same command asks for
    another machine: the owner picks it by approving in Scout on that Mac.
    Resumable: an unexpired request is reused, never duplicated."""
    handle = parse_owner(owner)
    state = store.state()
    if state.get("owner") and state["owner"] != handle and machines(state):
        raise ScoutError("other_owner", f"this state is paired with {state['owner']}; use a separate SCOUT_TAILSCALE_HOME for another owner", 2)
    key = store.key(create=True)
    pending = state.get("pending")
    if pending and pending.get("expiresAt", 0) > clock() and pending.get("keyId") == key_id(key):
        if pending.get("owner") != handle:
            raise ScoutError("pairing_in_progress", f"a request to {pending.get('owner')} is still waiting; finish it or disconnect", 2)
        resumed = True
    else:
        status, body = post(f"{PROFILE_ORIGIN}/{handle}/join", {"agent": name, "label": name, "public_key": public_key_b64(key)})
        if status == 404:
            raise ScoutError("owner_unavailable", f"{handle} is not accepting connection requests")
        if status == 429:
            raise ScoutError("slow_down", "too many requests from this address; try again in a few minutes")
        if (status != 200 or body.get("mode") != "direct" or body.get("client_key_id") != key_id(key)
                or not re.fullmatch(r"[0-9a-f]{64}", str(body.get("device_code", "")))
                or not re.fullmatch(r"[A-Z]{4}-[A-Z]{4}", str(body.get("user_code", "")))):
            # Never include raw response bodies: they can contain claim credentials.
            # Error identifiers are protocol tokens, not free-form server text.
            error = body.get("error")
            safe_error = error if isinstance(error, str) and error in (
                "invalid_request", "origin_forbidden", "device_login_unavailable",
                "service_unavailable", "method_not_allowed", "connection_unavailable",
                "access_denied", "invalid_grant", "expired_token", "slow_down",
            ) else "unexpected_response"
            raise ScoutError("join_failed", f"the owner's profile did not accept a direct request (HTTP {status}, {safe_error})",
                             details={"httpStatus": status, "error": safe_error})
        pending = {
            "owner": handle, "name": name, "keyId": key_id(key),
            "deviceCode": body["device_code"], "userCode": body["user_code"],
            "interval": max(5, min(int(body.get("interval", 5)), 60)),
            "expiresAt": clock() + min(int(body.get("expires_in", 600)), 600),
        }
        store.update_state(lambda current: {**current, "pending": pending})
        resumed = False
    on_code(PairingProgress(pending["userCode"], handle, resumed))
    if not wait:
        return None
    interval = pending["interval"]
    while clock() < pending["expiresAt"]:
        sleep(interval)
        status, body = post(TOKEN_URL, {"device_code": pending["deviceCode"], "proof": claim_proof(key, pending["deviceCode"])})
        if status == 200 and body.get("mode") == "direct":
            accepted = accept_bootstrap(body)
            add_machine(store, accepted, clock=clock, owner=handle, **({"proxy": proxy} if proxy else {}))
            return accepted
        error = body.get("error")
        if error == "authorization_pending":
            continue
        if error == "slow_down":
            interval = min(interval + 5, 60)
            continue
        if error in ("access_denied", "expired_token", "invalid_grant"):
            store.update_state(lambda current: {k: v for k, v in current.items() if k != "pending"})
            raise ScoutError(error, {
                "access_denied": "the owner declined or revoked this request",
                "expired_token": "the request expired before approval; run connect again",
                "invalid_grant": "the request is no longer claimable; run connect again",
            }[error])
        raise ScoutError("claim_failed", "could not check approval; run the same connect command to resume")
    raise ScoutError("expired_token", "the request expired before approval; run connect again")


class GuestError(ScoutError):
    def __init__(self, status: int, body: dict):
        code = str(body.get("error") or f"http_{status}")
        detail = body.get("detail") or body.get("error_description") or ""
        exit_code = 4 if status == 401 else 1
        super().__init__(code, f"the node refused the request ({status} {code}){': ' + detail if detail else ''}", exit_code)
        self.status = status
        self.body = body


def remote_endpoints(node: dict) -> list[str]:
    """The node's signed https endpoints: the one last known to work, then the
    other tailnet addresses, then loopback (only ever this same host)."""
    listed = [e for e in node.get("endpoints") or [] if isinstance(e, str) and e.startswith("https://") and e != node["endpoint"]]
    return [node["endpoint"]] + sorted(listed, key=_loopback)


class GuestClient:
    """Signed requests to ONE paired machine's /v1/guest API over the pinned transport."""

    def __init__(self, store: Store, endpoint_factory: Callable[..., Any] = PinnedEndpoint, machine: str | None = None):
        state = store.state()
        known = machines(state)
        key = store.key()
        if not known or key is None:
            raise ScoutError("not_paired", "not paired; run `scout-tailscale connect --owner <profile>`", 4)
        if machine is None:
            if len(known) != 1:
                raise ScoutError("machine_choice_required", "more than one machine is paired; pass --machine (see `scout-tailscale machines`)", 2)
            machine = next(iter(known))
        else:
            machine = resolve_machine(state, machine)
        self.store = store
        self.machine_id = machine
        self.entry = known[machine]
        self.node = self.entry["node"]
        self.grant = self.entry.get("grant") or {}
        self.key = key
        self.proxy = node_proxy(state)
        self._factory = endpoint_factory
        self.endpoint = endpoint_factory(self.node["endpoint"], self.node["pin"], proxy=self.proxy)

    @property
    def label(self) -> str:
        return machine_label(self.entry)

    def _send(self, endpoint, method: str, path: str, data: bytes, timeout: float | None):
        headers = sign_request(self.key, method, path, data, self.node["keyId"])
        return endpoint.request(method, path, data, headers, timeout=timeout)

    def _exchange(self, method: str, path: str, data: bytes, timeout: float | None):
        """Tries the node's own signed endpoints in order. Every one is pinned to the
        same key; a pin mismatch is terminal, never a reason to try elsewhere."""
        try:
            return self._send(self.endpoint, method, path, data, timeout)
        except PinMismatch:
            raise
        except TransportError as first:
            for url in remote_endpoints(self.node)[1:]:
                endpoint = self._factory(url, self.node["pin"], proxy=self.proxy)
                try:
                    result = self._send(endpoint, method, path, data, timeout)
                except PinMismatch:
                    raise
                except TransportError:
                    continue
                self.endpoint = endpoint
                self._remember_endpoint(url)
                return result
            raise first

    def _remember_endpoint(self, url: str) -> None:
        def change(state: dict) -> None:
            entry = machines(state).get(self.machine_id)
            if entry and entry["node"]["keyId"] == self.node["keyId"]:
                entry["node"]["endpoint"] = url
        self.store.update_state(change)

    def request(self, method: str, path: str, body: dict | None = None, timeout: float | None = None) -> dict:
        data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8") if body is not None else b""
        status, _, raw = self._exchange(method, path, data, timeout)
        try:
            parsed = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        if status >= 400:
            raise GuestError(status, parsed)
        return parsed

    def node_card(self) -> dict:
        status, _, raw = self.endpoint.request("GET", "/v1/node")
        if status != 200:
            raise ScoutError("node_card_unavailable", f"the node did not serve its card (HTTP {status})")
        try:
            response = json.loads(raw)
            # Current brokers wrap the signed card in node metadata. Older
            # fixtures served the card directly; verify either shape identically.
            card = response.get("card") if isinstance(response, dict) and "card" in response else response
            return verify_node_card(card, self.node["keyId"])
        except (CardError, json.JSONDecodeError) as error:
            raise ScoutError("node_card_invalid", f"the node's card failed verification: {error}") from error

    def whoami(self) -> dict:
        return self.request("GET", "/v1/guest/whoami")

    def agents(self, query: str = "") -> list[dict]:
        path = "/v1/guest/agents" + (f"?query={urllib.parse.quote(query)}" if query else "")
        return self.request("GET", path).get("agents", [])

    def attach_session(self, native_session_id: str) -> dict:
        result = self.request("POST", "/v1/guest/sessions/attach", {"nativeSessionId": native_session_id})
        session_id = result.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            raise ScoutError("invalid_session_receipt", "Scout did not return a session address")
        with self.store.transaction():
            sessions = self.store._read("sessions.json")
            sessions[session_id] = self._origin()
            self.store._write("sessions.json", sessions)
        return result

    def session_action(self, action: str, session_id: str, **fields) -> dict:
        if action not in ("get", "poll", "ack", "reply"):
            raise ScoutError("usage", "unknown session action", 2)
        entry = self.store._read("sessions.json").get(session_id)
        if not entry or entry != self._origin():
            raise ScoutError("session_origin_changed", "session must use its original machine identity and grant", 4)
        return self.request("POST", f"/v1/guest/sessions/{action}", {**fields, "sessionId": session_id})

    def _origin(self) -> dict:
        return {"node": self.machine_id, "nodeKeyId": self.node["keyId"], "grantId": self.grant.get("id")}

    def check_origin(self, request_id: str, entry: dict) -> None:
        """An ask belongs to the node, node key and grant it was first sent under.
        The broker derives the invocation from (grant, requestId): resending under
        a different grant would start a second ask, so it is refused instead."""
        if not (entry.get("node") and entry.get("nodeKeyId") and entry.get("grantId")):
            raise ScoutError("unbound_ask", f"ask {request_id} was journaled without the machine and grant it was sent under, "
                             "so resending could start a second ask; check its outcome with the owner, or send a new ask", 4)
        if entry["node"] != self.machine_id:
            raise ScoutError("wrong_machine", f"ask {request_id} was sent to {entry['node']}, not {self.label}", 2)
        if entry["nodeKeyId"] != self.node["keyId"]:
            raise ScoutError("original_node_gone", f"{self.label} has a different node identity than when ask {request_id} was sent; "
                             "it cannot be recovered through this pairing", 4)
        if entry["grantId"] != self.grant.get("id"):
            raise ScoutError("original_grant_gone", f"the grant ask {request_id} was sent under is gone ({self.label} was re-approved); "
                             "resending would start a new ask. Send a new ask if the work is still needed.", 4)

    def ask(self, target: str, task: str, request_id: str | None = None) -> dict:
        """Journals the requestId and its authority before sending, so any retry is the same ask."""
        if request_id is None:
            request_id = new_request_id()
        elif not REQUEST_ID.fullmatch(request_id):
            raise ScoutError("invalid_request_id", "request ids are 8-64 letters, digits, dashes or underscores", 2)

        def journal_it(journal: dict) -> None:
            existing = journal.get(request_id)
            if existing and (existing.get("target") != target or existing.get("task") != task):
                raise ScoutError("request_conflict", "that request id was already used for a different ask", 2)
            if existing:
                self.check_origin(request_id, existing)
            journal[request_id] = {**(existing or {}), **self._origin(), "target": target, "task": task,
                                   "createdAt": (existing or {}).get("createdAt") or int(time.time() * 1000), "state": "sending"}

        self.store.update_asks(journal_it)
        result = self.request("POST", "/v1/guest/asks", {"requestId": request_id, "target": target, "task": task})
        self._record(request_id, result.get("state", "queued"))
        return {**result, "machine": self.machine_id}

    def _record(self, request_id: str, state: str | None) -> None:
        def change(journal: dict) -> None:
            if request_id in journal:
                journal[request_id]["state"] = state
        self.store.update_asks(change)

    def resume(self, request_id: str) -> dict:
        entry = self.store.asks().get(request_id)
        if not entry:
            raise ScoutError("unknown_request", "no journaled ask has that request id", 2)
        return self.ask(entry["target"], entry["task"], request_id)

    def get_ask(self, request_id: str, wait: int = 0) -> dict:
        entry = self.store.asks().get(request_id)
        if entry:
            self.check_origin(request_id, entry)
        wait = max(0, min(int(wait), MAX_WAIT_SECONDS))
        path = f"/v1/guest/asks/{urllib.parse.quote(request_id, safe='')}" + (f"?wait={wait}" if wait else "")
        return self.request("GET", path, timeout=wait + 30)

    def wait(self, request_id: str, timeout: float, clock: Callable[[], float] = time.monotonic) -> dict:
        deadline = clock() + max(0.0, timeout)
        while True:
            remaining = deadline - clock()
            result = self.get_ask(request_id, wait=int(min(MAX_WAIT_SECONDS, max(0, remaining))))
            if result.get("state") in TERMINAL_STATES or clock() >= deadline:
                self._record(request_id, result.get("state"))
                return {**result, "machine": self.machine_id}


def client_for_ask(store: Store, request_id: str, endpoint_factory: Callable[..., Any] = PinnedEndpoint) -> GuestClient:
    """The client for the machine a journaled ask was sent to; never another one."""
    entry = store.asks().get(request_id)
    if not entry:
        raise ScoutError("unknown_request", "no journaled ask has that request id", 2)
    node = entry.get("node")
    if not node:
        raise ScoutError("unbound_ask", f"ask {request_id} was journaled without the machine it was sent to; "
                         "it cannot be resumed safely. Check its outcome with the owner, or send a new ask", 4)
    if node not in machines(store.state()):
        raise ScoutError("original_node_gone", f"ask {request_id} was sent to {node}, which is no longer paired here", 4)
    return GuestClient(store, endpoint_factory, machine=node)


__all__ = ["add_machine", "client_for_ask", "import_bootstrap", "machines", "resolve_machine", "GuestClient", "GuestError", "ScoutError", "Store", "TransportError", "pair", "parse_owner"]
