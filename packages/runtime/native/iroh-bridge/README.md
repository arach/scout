# openscout-iroh-bridge

Rust sidecar for OpenScout Mesh.

This crate owns the first Iroh boundary for issue #48:

- persist one Iroh identity per Scout node
- expose the public endpoint id as JSON
- bind an Iroh endpoint with ALPN `openscout/mesh/1`
- print the current Iroh `EndpointAddr` for Cloudflare rendezvous publication

It does not own Scout broker state. Authenticated forwarding carries the existing
broker `/v1/mesh/*` JSON bundles so the TypeScript broker handles coordination
writes.

## Commands

```bash
cargo run --manifest-path packages/runtime/native/iroh-bridge/Cargo.toml -- \
  identity --identity-path ~/.openscout/mesh/iroh.key

cargo run --manifest-path packages/runtime/native/iroh-bridge/Cargo.toml -- \
  serve --identity-path ~/.openscout/mesh/iroh.key \
  --broker-url http://127.0.0.1:65501

cargo run --manifest-path packages/runtime/native/iroh-bridge/Cargo.toml -- \
  forward --identity-path ~/.openscout/mesh/iroh.key \
  --endpoint-addr-json '{"id":"remote-endpoint","addrs":[]}' \
  --route messages < signed-mesh-envelope.json
```

When `OPENSCOUT_IROH_BRIDGE_BIN` points at the compiled bridge, the TypeScript
broker can start `serve` automatically, read the printed endpoint metadata, and
publish that Iroh entrypoint on the local node.

## Authenticated forwarding (mesh/1)

The TypeScript sender signs the exact JSON body with its existing **Scout node
identity**, independently of the Iroh transport key. `forward` reads
`{"body":"<exact JSON bytes>","headers":{...four x-openscout peer proof headers...}}`
from stdin, not a bare mesh bundle. The signature binds POST, the inner
`/v1/mesh/*` path, body digest, timestamp, nonce, and `iroh:<destination endpoint
id>`. The Iroh connection authenticates that destination endpoint.

The receiver passes only those four proof headers and the unchanged body to
`/v1/iroh/v1/mesh/*`. This dedicated broker mount always verifies as **remote**,
even over loopback and in verify-warn mode. Its destination comes from the
broker's configured local Iroh endpoint, never a request header. Only enrolled,
active control-tier Scout peer keys may use these four mesh write routes.
Guests/scoped credentials do not become machine peers. Unconfigured receivers,
unsigned/legacy frames, invalid proofs, replay and revoked peers fail closed.
The local operator's ordinary routes are unchanged.

Both bridge and broker must be upgraded together. ALPN `openscout/mesh/1`
prevents sending new authenticated frames to old bridges that silently discard
proofs; the dedicated mount fails closed on old brokers. Stop any already
running mesh/0 sidecars before upgrading: old binaries cannot preserve caller
provenance. Invalid managed sidecar metadata terminates the child. Protected
scoped-access mode still does not start a managed Iroh bridge. HTTP/Tailscale
remains available as its existing separately authenticated transport.

Verification:

```bash
cargo test --locked --manifest-path packages/runtime/native/iroh-bridge/Cargo.toml
bun test packages/runtime/src/iroh-ingress.test.ts packages/runtime/src/iroh-bridge.test.ts
```
