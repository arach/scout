# Scout

> Your personal agent cloud: a local control plane and mesh network.

## Critical Context

**IMPORTANT:** Read these rules before making any changes:

- Public Scout work belongs in the Scout checkout and pull requests target oscout/scout. Keep private OpenScout product code, assets, credentials, and internal material in the private workspace; inspect mixed changes before copying or publishing.
- Use Bun for JavaScript and TypeScript workflows.
- The broker is the canonical writer for Scout-owned coordination records.
- External harness transcripts are observed source material; never bulk-import them as Scout messages.
- One explicit target is a DM; group coordination requires an explicit channel; broadcast is opt-in.
- Use scout send for tells and scout ask for requested work or replies.
- Mesh means reachability and coordination, not exactly-once delivery or global consensus.
- Scout is for high-trust local developer pilots; do not claim enterprise or compliance readiness.
- Use gitmoji commit subjects and never add AI co-authoring footers.

## Quick Navigation

- Working with **packages/protocol/****? → Run bun run --cwd packages/protocol check.
- Working with **packages/runtime/****? → Run bun run --cwd packages/runtime check and the narrow affected tests.
- Working with **process spawning or shell execution**? → Run bun run sync-exec:fence before committing shell-execution changes.

## Overview

> Scout's public architecture, ownership model, and repository boundary

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
[public-source boundary](./docs/public-source-boundary.md) for ownership and release
invariants.

## Next

- [Quickstart](./docs/quickstart.md)
- [CLI guide](./packages/cli/README.md)
- [Runtime guide](./packages/runtime/README.md)
- [Protocol guide](./packages/protocol/README.md)

## Quickstart

> Install Scout, verify readiness, and route the first task

This path installs the public `scout` command, initializes its machine-local
state, and routes one real request through the runtime.

## Prerequisites

- Bun 1.3 or newer;
- Apple-silicon macOS, or Linux with a process manager for the foreground
  runtime;
- at least one supported coding-agent harness if you want Scout to launch or
  route work.

Install Bun from [bun.sh](https://bun.sh) if `bun --version` is unavailable.

## Installation

```bash
npm install -g @openscout/scout
scout --version
```

Installing the package does not silently start services. On Apple-silicon
macOS, initialize the local control plane explicitly:

```bash
scout setup
scout doctor
```

On Linux, `setup` initializes Scout but does not install a system service. Keep
the runtime running under your process manager, then run `doctor` from another
shell:

```bash
scout setup
openscout-runtime broker
```

```bash
scout doctor
```

## Orient

From a project directory:

```bash
scout whoami
scout who
scout runtimes
```

`whoami` shows the sender identity Scout inferred from the current project and
harness. `who` shows known targets. `runtimes` lists legal harness/model/effort
combinations for exact execution requests.

## Route the first task

Let Scout resolve or start a Codex session for the current project:

```bash
scout ask --project . --harness codex \
  "Inspect this repository and report the narrowest useful verification command."
```

Use `scout tell --to <target>` for a tell or update where no reply is expected.
Use `scout ask` when the target should investigate, act, judge, or report back.

## Next steps

- Read [Extensions](./docs/extensions.md) to install trusted CLI verbs and enable tab completion.

- Read the [CLI guide](./packages/cli/README.md) for routing, profiles,
  sessions, aliases, channels, and file-backed prompts.
- Read the [overview](./docs/overview.md) for the runtime ownership and public/private
  repository boundaries.
- Run `scout doctor --fix` when the native daemon exposes a conservative repair
  for a reported readiness issue.

---
Generated by [Dewey](https://github.com/arach/dewey) | Last updated: 2026-10-24
