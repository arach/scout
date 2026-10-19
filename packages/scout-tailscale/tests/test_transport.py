import base64
import time
import unittest
import unittest.mock

from fixtures import ConnectProxy, TLSServer

from scout_tailscale.transport import PinMismatch, PinnedEndpoint, TransportError, proxy_for, redact_url


def settle(predicate, timeout=2.0):
    deadline = time.time() + timeout
    while time.time() < deadline and not predicate():
        time.sleep(0.02)


class PinnedTransport(unittest.TestCase):
    def setUp(self):
        self.server = TLSServer()
        self.url = f"https://localhost:{self.server.port}"
        self.addCleanup(self.server.close)

    def test_matching_pin_sends_request(self):
        status, headers, body = PinnedEndpoint(self.url, self.server.pin).request("GET", "/v1/node")
        self.assertEqual((status, body), (200, b'{"ok":true}'))
        self.assertIn("date", headers)
        self.assertTrue(self.server.received[0].startswith(b"GET /v1/node HTTP/1.1"))

    def test_wrong_pin_sends_nothing(self):
        with self.assertRaises(PinMismatch) as caught:
            PinnedEndpoint(self.url, "0" * 64).request("POST", "/v1/guest/asks", b'{"task":"secret"}')
        self.assertEqual(caught.exception.observed, self.server.pin)
        settle(lambda: self.server.handshakes >= 1)
        time.sleep(0.1)
        self.assertEqual(self.server.received, [])

    def test_ed25519_node_certificates_pin(self):
        server = TLSServer(kind="ed25519")
        self.addCleanup(server.close)
        status, _, _ = PinnedEndpoint(f"https://localhost:{server.port}", server.pin).request("GET", "/v1/node")
        self.assertEqual(status, 200)

    def test_unpinned_or_plain_http_endpoints_are_refused(self):
        with self.assertRaises(TransportError):
            PinnedEndpoint(f"http://localhost:{self.server.port}", self.server.pin)


class ProxiedTransport(unittest.TestCase):
    def setUp(self):
        self.server = TLSServer()
        self.url = f"https://localhost:{self.server.port}"
        self.addCleanup(self.server.close)

    def test_connect_proxy_with_credentials_keeps_pin_end_to_end(self):
        proxy = ConnectProxy(require_auth=base64.b64encode(b"user:p@ss").decode())
        self.addCleanup(proxy.close)
        endpoint = PinnedEndpoint(self.url, self.server.pin, proxy=proxy.url("user:p%40ss"))
        status, _, _ = endpoint.request("GET", "/v1/guest/whoami", headers={"x-openscout-peer": "k"})
        self.assertEqual(status, 200)
        self.assertTrue(proxy.requests[0].startswith(f"CONNECT localhost:{self.server.port} HTTP/1.1"))
        # The proxy saw only the tunnel request, never the signed HTTP request.
        self.assertNotIn("x-openscout-peer", proxy.requests[0])

    def test_rejected_proxy_auth_does_not_leak_credentials(self):
        proxy = ConnectProxy(require_auth="expected")
        self.addCleanup(proxy.close)
        endpoint = PinnedEndpoint(self.url, self.server.pin, proxy=proxy.url("user:hunter2"))
        with self.assertRaises(TransportError) as caught:
            endpoint.request("GET", "/v1/node")
        self.assertIn("407", str(caught.exception))
        self.assertNotIn("hunter2", str(caught.exception))

    def test_tls_intercepting_proxy_is_a_pin_mismatch_and_sees_no_http(self):
        proxy = ConnectProxy(mitm=True)
        self.addCleanup(proxy.close)
        endpoint = PinnedEndpoint(self.url, self.server.pin, proxy=proxy.url())
        with self.assertRaises(PinMismatch):
            endpoint.request("POST", "/v1/guest/asks", b'{"task":"secret"}', {"x-openscout-signature": "sig"})
        settle(lambda: proxy.mitm_plaintext)
        self.assertEqual([data for data in proxy.mitm_plaintext if data], [])
        self.assertEqual(self.server.received, [])

    def test_ambient_proxy_is_never_used_for_node_traffic(self):
        proxy = ConnectProxy()
        self.addCleanup(proxy.close)
        with unittest.mock.patch.dict("os.environ", {"HTTPS_PROXY": proxy.url(), "https_proxy": proxy.url()}):
            status, _, _ = PinnedEndpoint(self.url, self.server.pin).request("GET", "/v1/node")
        self.assertEqual(status, 200)
        self.assertEqual(proxy.requests, [])

    def test_no_proxy_bypasses_and_urls_are_redacted(self):
        self.assertIsNone(proxy_for("https://mini.tail.ts.net:43111", {"HTTPS_PROXY": "http://p:1", "NO_PROXY": ".ts.net"}))
        self.assertEqual(proxy_for("https://mini.tail.ts.net:43111", {"https_proxy": "http://p:1"}), "http://p:1")
        self.assertEqual(redact_url("http://user:secret@proxy:3128"), "http://***@proxy:3128")
        self.assertEqual(redact_url("http://proxy:3128"), "http://proxy:3128")


if __name__ == "__main__":
    unittest.main()
