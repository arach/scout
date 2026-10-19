"""Local TLS server and CONNECT / MITM proxies for transport tests."""

from __future__ import annotations

import datetime
import hashlib
import select
import socket
import ssl
import tempfile
import threading
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.x509.oid import NameOID


def make_cert(kind: str = "ec") -> tuple[Path, Path, str]:
    """Self-issued cert files and the SPKI SHA-256 pin of its key."""
    key = ed25519.Ed25519PrivateKey.generate() if kind == "ed25519" else ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "scout-node")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
            .sign(key, None if kind == "ed25519" else hashes.SHA256()))
    directory = Path(tempfile.mkdtemp())
    cert_path, key_path = directory / "cert.pem", directory / "key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    spki = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return cert_path, key_path, hashlib.sha256(spki).hexdigest()


class TLSServer:
    """Answers every HTTP request with a fixed JSON body; records what it received."""

    def __init__(self, kind: str = "ec", body: bytes = b'{"ok":true}'):
        self.cert, self.key, self.pin = make_cert(kind)
        self.body = body
        self.received: list[bytes] = []
        self.handshakes = 0
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(self.cert, self.key)
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        try:
            tls = self.context.wrap_socket(conn, server_side=True)
            self.handshakes += 1
            data = b""
            tls.settimeout(2)
            while b"\r\n\r\n" not in data:
                chunk = tls.recv(65536)
                if not chunk:
                    break
                data += chunk
            if data:
                self.received.append(data)
                tls.sendall(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ndate: Mon, 28 Sep 2026 00:00:00 GMT\r\n"
                            + f"content-length: {len(self.body)}\r\nconnection: close\r\n\r\n".encode() + self.body)
            tls.close()
        except (OSError, ssl.SSLError):
            conn.close()

    def close(self):
        self.sock.close()


def _pipe(a: socket.socket, b: socket.socket):
    sockets = [a, b]
    try:
        while True:
            readable, _, _ = select.select(sockets, [], [], 5)
            if not readable:
                return
            for source in readable:
                data = source.recv(65536)
                if not data:
                    return
                (b if source is a else a).sendall(data)
    except OSError:
        return
    finally:
        a.close()
        b.close()


class ConnectProxy:
    """An HTTP CONNECT proxy. With `mitm`, it terminates TLS with its own cert, like a TLS-inspecting runtime proxy."""

    def __init__(self, require_auth: str | None = None, mitm: bool = False):
        self.require_auth = require_auth
        self.mitm = mitm
        self.requests: list[str] = []
        self.mitm_plaintext: list[bytes] = []
        if mitm:
            cert, key, _ = make_cert()
            self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            self.context.load_cert_chain(cert, key)
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    def _handle(self, conn):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = conn.recv(4096)
            if not chunk:
                conn.close()
                return
            data += chunk
        head = data.decode("latin-1")
        self.requests.append(head)
        line = head.split("\r\n", 1)[0]
        if self.require_auth and f"Proxy-Authorization: Basic {self.require_auth}" not in head:
            conn.sendall(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            conn.close()
            return
        host, port = line.split()[1].rsplit(":", 1)
        conn.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
        if self.mitm:
            try:
                tls = self.context.wrap_socket(conn, server_side=True)
                tls.settimeout(2)
                self.mitm_plaintext.append(tls.recv(65536))
                tls.close()
            except (OSError, ssl.SSLError):
                conn.close()
            return
        upstream = socket.create_connection((host.strip("[]"), int(port)))
        _pipe(conn, upstream)

    def url(self, userinfo: str = "") -> str:
        return f"http://{userinfo + '@' if userinfo else ''}127.0.0.1:{self.port}"

    def close(self):
        self.sock.close()
