---
title: Overview
description: Scout's public architecture, ownership model, and repository boundary
order: 1
---

Scout is a local-first control plane for coding agents. It gives operators and
agents one runtime-backed model for identity, routing, durable work, session
observation, and mesh reachability across harnesses such as Codex and Claude
Code.

Together, the local control plane and mesh network form a personal agent cloud
across the machines the operator owns.

## What Scout owns

The runtime is the canonical writer for Scout-owned coordination records:

- messages and conversations;
- invocations, flights, and delivery plans;
- questions and work items;
- agent cards, sessions, endpoints, and bindings;
- usage and lightweight coordination telemetry.

External harness transcripts remain observed source material. Scout may index or
project them for operator visibility, but does not bulk-import them as canonical
Scout conversation history.

## Routing model

Routing is explicit and independent of the calling surface:

- one target means a direct message;
- group coordination uses a named channel;
- broadcast is opt-in;
- `tell` is for updates that expect no reply;
- `ask` is for requested work, judgment, or a reply;
- exact session continuation uses `session:<id>`.

## Repository map

| Area | Path |
| --- | --- |
| CLI, JSON output, MCP, and package bundle | `packages/cli` |
| Broker and runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Harness adapters and session observation | `packages/agent-sessions` |
| Host phone pairing | `packages/pairing` |
| Native services and TUI | `crates` |

Host pairing lives in `packages/pairing` (`@openscout/pairing`), an internal
workspace package bundled into the CLI. `scout pair` is its terminal entry
point. It is not a separately published npm package.

## Product boundary

Scout contains the public core: protocol, runtime, harness adapters, session
extraction, CLI, TUI, and host-side phone pairing. The terminal is its interface.
It contains no web app or native product app.

Scout apps own the web, macOS, iOS, and Android interfaces at every account
level. Hosted services remain with the apps. The dependency runs one way:
apps consume exact released core artifacts; the core does not import apps.

The host pairing package owns the encrypted bridge and existing phone RPC
projections. Its existing bridge listener hosts the pairing HTTP routes, and
the controller owns LAN discovery. Apps can reuse those mounts. Terminal QR
and approval-gated LAN pairing need no web client. Web commands use
an app-supplied server entry and an explicitly installed matching client; they
explain the missing app instead of serving a bundled fallback.

Scout is for high-trust local developer environments. It is not enterprise-ready,
compliance-ready, or a hardened untrusted multi-tenant system. See the
[public-source boundary](./public-source-boundary.md) for source ownership and
release invariants.

## Next

- [Quickstart](./quickstart.md)
- [CLI guide](../packages/cli/README.md)
- [Runtime guide](../packages/runtime/README.md)
- [Protocol guide](../packages/protocol/README.md)
