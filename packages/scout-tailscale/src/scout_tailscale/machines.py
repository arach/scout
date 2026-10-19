"""Machine discovery and choice.

Three sources, never confused with one another:

  directory  The owner's hosted directory lists the machines that approved
             THIS key, with the node-signed bootstrap each Mac projected.
             Every card is verified against its node key, as at pairing.
  probe      A pinned, signed whoami + agents. Only this makes a machine
             "available": the node itself accepted this key's grant.
  tailnet    `tailscale status --json`, when present, is a hint only: it
             says a device is on the tailnet, not that Scout runs there or
             that this key may use it.

Discovery never grants access or widens a grant. Existing asks stay on the
machine, node key and grant they were sent under.
"""

from __future__ import annotations

import json
import os
import secrets
import shlex
import shutil
import subprocess
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from .core import (
    PROFILE_ORIGIN,
    GuestClient,
    GuestError,
    ScoutError,
    Store,
    _post_hosted,
    accept_bootstrap,
    grant_expired,
    machine_label,
    machines,
    resolve_machine,
)
from .signing import directory_proof, key_id, public_key_b64
from .transport import PinMismatch, PinnedEndpoint, TransportError

DIRECTORY_PROTOCOL = "scout-directory/1"
ENDED_STATES = ("revoking", "revoked", "expired", "denied")


def sync_directory(store: Store, *, post: Callable[[str, dict], tuple[int, dict]] | None = None,
                   clock: Callable[[], float] = time.time) -> dict:
    """Merges the owner's directory into local state. Machines the directory does
    not mention are kept as they are: history can be truncated, and each node,
    not this listing, is the authority for its own grant."""
    state = store.state()
    owner, key = state.get("owner"), store.key()
    if not owner or key is None:
        return {"ok": False, "error": "no_owner", "detail": "paired from a bootstrap file; there is no owner directory to read"}
    ts, nonce = int(clock() * 1000), secrets.token_urlsafe(12)
    try:
        status, body = (post or _post_hosted)(f"{PROFILE_ORIGIN}/{owner}/directory", {
            "public_key": public_key_b64(key), "ts": ts, "nonce": nonce, "proof": directory_proof(key, owner, ts, nonce)})
    except ScoutError as error:
        return {"ok": False, "error": error.code, "detail": str(error)}
    if status != 200 or body.get("protocol") != DIRECTORY_PROTOCOL or body.get("client_key_id") != key_id(key):
        return {"ok": False, "error": body.get("error") or f"http_{status}", "detail": body.get("detail") or "the directory did not answer"}
    with store.transaction():
        return _merge_directory(store, body, clock)


def _merge_directory(store: Store, body: dict, clock: Callable[[], float]) -> dict:
    """Rows arrive newest first (the directory's contract). For each node only its
    newest active grant is current; an older active row never replaces it."""
    known = machines(store.state())
    changes, pending = [], 0
    current_seen: set[str] = set()
    for row in body.get("machines") or []:
        if not isinstance(row, dict):
            continue
        row_state, node_id, grant_id = row.get("state"), row.get("node_id"), row.get("grant_id")
        if row_state == "pending":
            pending += 1
            continue
        entry = known.get(node_id) if isinstance(node_id, str) else None
        if row_state == "active" and isinstance(row.get("bootstrap"), dict):
            try:
                accepted = accept_bootstrap({"bootstrap": row["bootstrap"], "allowed_targets": row.get("allowed_targets"),
                                             "expires_at": row.get("expires_at")})
            except ScoutError as error:
                changes.append({"machine": node_id, "change": "invalid_bootstrap", "detail": str(error)})
                continue
            node = accepted["node"]
            if node["id"] in current_seen:
                continue  # an older grant for a node whose newest one was already taken
            current_seen.add(node["id"])
            if entry and entry["node"]["keyId"] != node["keyId"]:
                # Never adopt a different node identity from a listing.
                changes.append({"machine": node["id"], "change": "node_key_changed"})
                continue
            if entry and entry.get("grant", {}).get("id") == accepted["grant"]["id"]:
                # Same grant: keep the pinned identity and the endpoint that worked.
                if entry.get("state") != "active":
                    continue  # this key already saw it end; a stale listing cannot revive it
                known[node["id"]] = {**entry, "grant": {**entry["grant"], **accepted["grant"]}}
                continue
            known[node["id"]] = {"node": node, "grant": accepted["grant"], "state": "active",
                                 "pairedAt": int(clock() * 1000), "via": "directory"}
            changes.append({"machine": node["id"], "change": "reapproved" if entry else "added"})
        elif entry and row_state in ENDED_STATES and entry.get("grant", {}).get("id") == grant_id:
            if entry.get("state") != row_state:
                known[node_id] = {**entry, "state": row_state}
                changes.append({"machine": node_id, "change": row_state})
    store.update_state(lambda state: {**state, "machines": known})
    return {"ok": True, "pending": pending, "changes": changes,
            "truncated": bool(body.get("live_truncated") or body.get("history_truncated"))}


def tailnet_peers(run: Callable[..., Any] = subprocess.run) -> dict:
    """Tailnet devices from the local Tailscale CLI, as hints. `$SCOUT_TAILSCALE_TAILSCALE`
    overrides the command (e.g. `tailscale --socket=/tmp/tailscaled.sock`)."""
    command = os.environ.get("SCOUT_TAILSCALE_TAILSCALE")
    argv = shlex.split(command) if command else (["tailscale"] if shutil.which("tailscale") else None)
    if not argv:
        return {"available": False, "detail": "the tailscale CLI is not installed here"}
    try:
        result = run([*argv, "status", "--json"], capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"available": False, "detail": f"tailscale status failed: {error}"}
    if result.returncode != 0:
        return {"available": False, "detail": (result.stderr or "tailscale status failed").strip().splitlines()[0][:200]}
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"available": False, "detail": "tailscale status did not return JSON"}
    peers = []
    for peer in (data.get("Peer") or {}).values():
        if isinstance(peer, dict):
            peers.append({"hostName": peer.get("HostName") or "", "dnsName": (peer.get("DNSName") or "").rstrip(".").lower(),
                          "ips": [ip for ip in peer.get("TailscaleIPs") or [] if isinstance(ip, str)],
                          "online": bool(peer.get("Online")), "os": peer.get("OS") or ""})
    return {"available": True, "peers": peers}


def match_peer(entry: dict, peers: list[dict]) -> dict | None:
    """The tailnet device a machine's signed endpoints point at, if any."""
    hosts = {(urllib.parse.urlsplit(e).hostname or "").lower() for e in entry["node"].get("endpoints") or [entry["node"]["endpoint"]]}
    for peer in peers:
        if peer["dnsName"] in hosts or hosts.intersection(peer["ips"]):
            return peer
    return None


def usable(entry: dict, target: str | None = None) -> bool:
    """Locally eligible: an active, unexpired grant (that lists `target`, when given)."""
    grant = entry.get("grant") or {}
    return (entry.get("state") == "active" and not grant_expired(grant)
            and (target is None or target in (grant.get("allowedTargets") or [])))


def probe(store: Store, machine_id: str, endpoint_factory: Callable[..., Any] = PinnedEndpoint) -> dict:
    """What the node itself says about this key right now."""
    entry = machines(store.state())[machine_id]
    if entry.get("state") != "active":
        return {"status": entry.get("state") or "unknown"}
    if grant_expired(entry.get("grant") or {}):
        return {"status": "expired"}
    try:
        client = GuestClient(store, endpoint_factory, machine=machine_id)
        whoami = client.whoami()
        return {"status": "available", "agents": client.agents(), "allowedTargets": whoami["grant"]["allowedTargets"]}
    except PinMismatch as error:
        return {"status": "pin_mismatch", "detail": str(error)}
    except GuestError as error:
        return {"status": "grant_inactive" if error.status == 401 else "error", "detail": str(error)}
    except (ScoutError, TransportError) as error:
        return {"status": "unreachable", "detail": str(error)}


def probe_all(store: Store, ids: list[str], endpoint_factory: Callable[..., Any] = PinnedEndpoint) -> dict[str, dict]:
    if not ids:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(ids))) as pool:
        return dict(zip(ids, pool.map(lambda mid: probe(store, mid, endpoint_factory), ids)))


def choose_machine(store: Store, target: str, explicit: str | None = None,
                   endpoint_factory: Callable[..., Any] = PinnedEndpoint) -> tuple[str, str]:
    """Where a FRESH ask goes. Returns (machine id, reason).

    An explicit or remembered machine is used as given: if it is unreachable the
    ask fails there, it does not move. Otherwise the only machine whose grant
    allows `target` is used; among several, the only one that answers a probe;
    else the caller must choose."""
    state = store.state()
    known = machines(state)
    if not known:
        raise ScoutError("not_paired", "not paired; run `scout-tailscale connect --owner <profile>`", 4)
    if explicit:
        machine = resolve_machine(state, explicit)
        if not usable(known[machine], target):
            raise ScoutError("target_not_allowed", f"{machine_label(known[machine])} has no active grant that allows {target}")
        if state.get("preferred") != machine:
            store.update_state(lambda current: {**current, "preferred": machine})
        return machine, "explicit"
    candidates = sorted(mid for mid, entry in known.items() if usable(entry, target))
    if not candidates:
        raise ScoutError("no_machine_for_target", f"no approved machine lets this key ask {target}; see `scout-tailscale machines`")
    preferred = state.get("preferred")
    if preferred in candidates:
        return preferred, "remembered"
    if len(candidates) == 1:
        return candidates[0], "only_approved"
    probes = probe_all(store, candidates, endpoint_factory)
    reachable = [mid for mid in candidates if probes[mid]["status"] == "available"]
    if len(reachable) == 1:
        return reachable[0], "only_reachable"
    choices = [{"id": mid, "label": machine_label(known[mid]), "status": probes[mid]["status"]} for mid in candidates]
    listing = ", ".join(f"{c['label']} ({c['status']})" for c in choices)
    if not reachable:
        raise ScoutError("no_reachable_machine",
                         f"none of the machines approved for {target} is reachable right now: {listing}. "
                         "Try again later, or pass --machine <name> to use one as soon as it answers.", 1, {"candidates": choices})
    raise ScoutError("machine_choice_required",
                     f"{target} is available on more than one machine: {listing}. "
                     "Pass --machine <name> (remembered) or run `scout-tailscale use <name>`.", 2, {"candidates": choices})
