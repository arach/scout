"""Pinned TLS to one Scout node, directly or through an HTTP CONNECT proxy.

The node's certificate is self-issued, so CA validation says nothing about
it. What identifies the node is the SPKI fingerprint in its signed card. The
TLS handshake completes, the leaf's SPKI SHA-256 is compared to the pin, and
only on a match is any HTTP written. There is no unpinned fallback: a proxy
that terminates TLS (as some sandbox runtimes do) produces a pin mismatch and
the request is never sent.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import ipaddress
import re
import socket
import ssl
import urllib.parse
import urllib.request

from cryptography import x509
from cryptography.hazmat.primitives import serialization

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class TransportError(Exception):
    """A connection problem. Messages never include proxy credentials."""


class PinMismatch(TransportError):
    def __init__(self, observed: str):
        super().__init__(
            "the node's TLS key does not match the pinned key "
            f"(saw {observed[:16]}…). Something between this machine and the node is "
            "presenting its own certificate, or the node re-keyed. Nothing was sent."
        )
        self.observed = observed


def redact_url(value: str | None) -> str | None:
    """Strips userinfo from a URL so proxy credentials never reach output or logs."""
    if not value:
        return value
    return re.sub(r"(?<=://)[^/@]*@", "***@", value)


def spki_sha256_from_cert(der_cert: bytes) -> str:
    cert = x509.load_der_x509_certificate(der_cert)
    spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(spki).hexdigest()


def proxy_for(url: str, environ: dict[str, str] | None = None) -> str | None:
    """The proxy the environment names for this https URL, honoring NO_PROXY."""
    parts = urllib.parse.urlsplit(url)
    if environ is None:
        proxies = urllib.request.getproxies_environment()
        bypass = urllib.request.proxy_bypass_environment(parts.hostname or "")
    else:
        lowered = {k.lower(): v for k, v in environ.items() if v}
        proxies = {k[:-6]: v for k, v in lowered.items() if k.endswith("_proxy")}
        no_proxy = [entry.strip().lower() for entry in lowered.get("no_proxy", "").split(",") if entry.strip()]
        host = (parts.hostname or "").lower()
        bypass = "*" in no_proxy or any(host == e.lstrip(".") or host.endswith("." + e.lstrip(".")) for e in no_proxy)
    if bypass:
        return None
    return proxies.get("https") or proxies.get("all")


def _read_connect_response(sock: socket.socket) -> int:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.recv(4096)
        if not chunk:
            raise TransportError("the proxy closed the connection during CONNECT")
        data += chunk
        if len(data) > 16384:
            raise TransportError("the proxy sent an oversized CONNECT response")
    status_line = data.split(b"\r\n", 1)[0].decode("latin-1")
    match = re.match(r"HTTP/\d(?:\.\d)?\s+(\d{3})", status_line)
    if not match:
        raise TransportError("the proxy sent an invalid CONNECT response")
    return int(match.group(1))


def open_tunnel(host: str, port: int, proxy: str | None, timeout: float) -> socket.socket:
    """A raw TCP stream to host:port, through an HTTP CONNECT proxy when given."""
    if not proxy:
        return socket.create_connection((host, port), timeout=timeout)
    parts = urllib.parse.urlsplit(proxy if "://" in proxy else "http://" + proxy)
    if parts.scheme != "http":
        raise TransportError(f"unsupported proxy scheme {parts.scheme!r}; use an http:// CONNECT proxy")
    sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=timeout)
    try:
        authority = f"[{host}]:{port}" if ":" in host else f"{host}:{port}"
        lines = [f"CONNECT {authority} HTTP/1.1", f"Host: {authority}"]
        if parts.username is not None:
            credentials = f"{urllib.parse.unquote(parts.username)}:{urllib.parse.unquote(parts.password or '')}"
            lines.append("Proxy-Authorization: Basic " + base64.b64encode(credentials.encode()).decode())
        sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
        status = _read_connect_response(sock)
        if status != 200:
            raise TransportError(f"the proxy refused the tunnel to {authority} (HTTP {status})")
        return sock
    except BaseException:
        sock.close()
        raise


def pinned_context() -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    # The pin below replaces CA validation; it is checked before any byte of HTTP.
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


def open_pinned(host: str, port: int, pin: str, proxy: str | None = None, timeout: float = 30.0) -> ssl.SSLSocket:
    raw = open_tunnel(host, port, proxy, timeout)
    try:
        try:
            ipaddress.ip_address(host)
            server_name = None
        except ValueError:
            server_name = host
        tls = pinned_context().wrap_socket(raw, server_hostname=server_name)
    except ssl.SSLError as error:
        raw.close()
        raise TransportError(f"TLS handshake with the node failed: {error.reason or error}") from error
    except BaseException:
        raw.close()
        raise
    der = tls.getpeercert(binary_form=True)
    observed = spki_sha256_from_cert(der) if der else ""
    if not hmac.compare_digest(observed, pin.lower()):
        tls.close()
        raise PinMismatch(observed or "no certificate")
    return tls


class PinnedHTTPSConnection(http.client.HTTPConnection):
    """http.client over a socket that has already passed the pin check."""

    def __init__(self, host: str, port: int, pin: str, proxy: str | None, timeout: float):
        super().__init__(host, port, timeout=timeout)
        self._pin = pin
        self._proxy = proxy

    def connect(self) -> None:
        self.sock = open_pinned(self.host, self.port, self._pin, self._proxy, self.timeout)


class PinnedEndpoint:
    """One node endpoint. `proxy` is explicit: ambient HTTPS_PROXY is often the
    public egress path, not the route to a private tailnet, so it is never
    picked up here implicitly."""

    def __init__(self, url: str, pin: str, timeout: float = 30.0, proxy: str | None = None):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme != "https" or not parts.hostname:
            raise TransportError("node endpoints must be https:// URLs")
        self.url = url
        self.host = parts.hostname
        self.port = parts.port or 443
        self.pin = pin
        self.timeout = timeout
        self.proxy = proxy

    def request(self, method: str, path: str, body: bytes = b"", headers: dict[str, str] | None = None,
                timeout: float | None = None) -> tuple[int, dict[str, str], bytes]:
        connection = PinnedHTTPSConnection(self.host, self.port, self.pin, self.proxy, timeout or self.timeout)
        try:
            request_headers = {"accept": "application/json", "user-agent": "scout-tailscale", **(headers or {})}
            if body:
                request_headers.setdefault("content-type", "application/json")
            try:
                connection.request(method, path, body=body or None, headers=request_headers)
                response = connection.getresponse()
                data = response.read(MAX_RESPONSE_BYTES + 1)
            except (OSError, http.client.HTTPException) as error:
                raise TransportError(f"could not reach the node at {self.host}:{self.port}: {error}") from error
            if len(data) > MAX_RESPONSE_BYTES:
                raise TransportError("the node sent an oversized response")
            return response.status, {k.lower(): v for k, v in response.getheaders()}, data
        finally:
            connection.close()
