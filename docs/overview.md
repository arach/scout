---
title: Overview
description: Scout's public architecture, ownership model, and repository boundary
order: 1
---

Scout is the local runtime that coordinates coding agents on a host. The core
includes the protocol, harness adapters, session observation and extraction,
routing and delivery, CLI, TUI, mesh, and host side of phone pairing. The
terminal is its interface.

## What Scout owns

The runtime is the canonical writer for Scout-owned coordination records:

- messages and conversations;
- invocations, flights, and delivery plans;
- questions and work items;
- agent cards, sessions, endpoints, and bindings;
- usage and coordination telemetry.

External harness transcripts remain observed source material. Scout can index,
extract, and display them without bulk-importing them as Scout messages.

## Routing model

- One target means a direct message.
- Group coordination uses a named channel.
- Broadcast is opt-in.
- `tell` is for updates without requested work.
- `ask` is for work, judgment, or a reply.
- Exact session continuation uses `session:<id>`.

Mesh provides reachability and coordination, not global consensus or
exactly-once delivery.

## Repository map

| Area | Path |
| --- | --- |
| CLI, JSON output, MCP, and package bundle | `packages/cli` |
| Runtime | `packages/runtime` |
| Shared protocol | `packages/protocol` |
| Harness adapters and session observation | `packages/agent-sessions` |
| Native services and TUI | `crates` |

The host-pairing package name is a **placeholder** until the pairing move is
merged. `scout pair` remains the terminal entry point.

## Product boundary

The public core runs without an app. The Mac, iOS, Android, and web apps are
separate clients built on the core. Hosted services are also separate. Neither
app source nor a web client ships in the public core.

Apps consume released public packages and APIs. They do not copy core source;
the core never imports private code. Other developers can build interfaces on
the same runtime without adopting an existing app or hosted service.

Scout assumes trusted local users and agents. It is not an enterprise,
compliance, or hardened untrusted multi-tenant boundary. See the
[public-source boundary](./public-source-boundary.md) for ownership and release
invariants.

## Next

- [Quickstart](./quickstart.md)
- [CLI guide](../packages/cli/README.md)
- [Runtime guide](../packages/runtime/README.md)
- [Protocol guide](../packages/protocol/README.md)
