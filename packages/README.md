# Packages

This directory contains OpenScout's shared TypeScript packages. The apps use
these packages to speak one broker/runtime/protocol model instead of each host
surface inventing its own state shape.

Packages are distribution and dependency boundaries, not only libraries. A
package may expose an executable or bundled server. The rule is that
core package code must not import from app source; shared behavior moves down into
`packages/runtime`, `packages/protocol`, `packages/cli`, or another package-owned
boundary before a client consumes it. The Mac, iOS, Android, and web apps are
separate clients, not packages in this repository. The core ships no web app.
The host side of phone pairing belongs to the core; its package name is a
**placeholder** until the pairing move is merged.

## Directory Map

| Path | Purpose | Start here |
| --- | --- | --- |
| [`protocol`](./protocol) | Shared contracts, identity grammar, route metadata, and durable record types | [`protocol/README.md`](./protocol/README.md) |
| [`runtime`](./runtime) | Local broker, SQLite store, service management, discovery, mesh, and delivery planning | [`runtime/README.md`](./runtime/README.md) |
| [`cli`](./cli) | Public `@openscout/scout` package and installed `scout` command | [`cli/README.md`](./cli/README.md) |
| [`agent-sessions`](./agent-sessions) | Harness session adapters, event snapshots, and browser-safe trace boundary | [`agent-sessions/README.md`](./agent-sessions/README.md) |
| [`session-trace`](./session-trace) | Framework-agnostic live session trace model | [`session-trace/README.md`](./session-trace/README.md) |
| [`session-trace-react`](./session-trace-react) | React presentation layer for live session traces | [`session-trace-react/README.md`](./session-trace-react/README.md) |

## Common Checks

From the repo root:

```bash
bun run --cwd packages/protocol check
bun run --cwd packages/runtime check
bun run --cwd packages/cli check
```

Use narrower package checks when working in a specific area.

## Read Next

- [`../README.md`](../README.md) for the repo overview
- [`../docs/public-source-boundary.md`](../docs/public-source-boundary.md) for core and client ownership
- [`../docs/architecture.md`](../docs/architecture.md) for the package boundaries
- [`../docs/architecture.md`](../docs/architecture.md#the-data-model) before changing persistence
