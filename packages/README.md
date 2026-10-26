# Core packages

These packages implement Scout's host core. Apps consume the core; the core
never imports app source. The web and native interfaces live with the Scout apps.

| Path | Purpose |
| --- | --- |
| [protocol](./protocol) | Contracts, identities, routing metadata, and durable record types |
| [runtime](./runtime) | Broker, persistence, service custody, mesh, and delivery |
| [cli](./cli) | Public command and bundled distribution |
| [pairing](./pairing) | Encrypted phone bridge, controller, host ingress, and phone RPC projections |
| [agent-sessions](./agent-sessions) | Harness adapters and session extraction |
| [session-trace](./session-trace) | Headless live-session trace model |
Packages are distribution and dependency boundaries, not only libraries. A
package may expose an executable or bundled server. The rule is that
core package code must not import from app source; shared behavior moves down into
`packages/runtime`, `packages/protocol`, `packages/cli`, or another package-owned
boundary before a client consumes it. The Mac, iOS, Android, and web apps are
separate clients, not packages in this repository. The core ships no web app.
Host phone pairing lives in `pairing` (`@openscout/pairing`), an internal
workspace package bundled into `@openscout/scout`, not a separately published
npm dependency. Its closed export map supports Bun source and compiled
ESM/declaration loading.

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
