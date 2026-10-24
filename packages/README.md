# Core packages

These packages implement Scout's host core. Apps consume the core; the core
never imports app source. The web and native interfaces live with OpenScout apps.

| Path | Purpose |
| --- | --- |
| [protocol](./protocol) | Contracts, identities, routing metadata, and durable record types |
| [runtime](./runtime) | Broker, persistence, service custody, mesh, and delivery |
| [cli](./cli) | Public command and bundled distribution |
| [pairing](./pairing) | Encrypted phone bridge, controller, host ingress, and phone RPC projections |
| [agent-sessions](./agent-sessions) | Harness adapters and session extraction |
| [session-trace](./session-trace) | Headless live-session trace model |

From the repository root:

```sh
bun run --cwd packages/protocol check
bun run --cwd packages/runtime check
bun run --cwd packages/pairing check
bun run --cwd packages/cli build
bun run check:core
```

See the [repository overview](../README.md) and
[source boundary](../docs/public-source-boundary.md) for ownership and release status.
