# Scout

> Your personal agent cloud: a local control plane and mesh network.

## Critical Context

**IMPORTANT:** Read these rules before making any changes:

- This repository is the Scout core: runtime, protocol, harness adapters, session extraction, CLI, TUI, MCP server, native services, and the host side of phone pairing. The Mac, iOS, Android, and web apps and the hosted services are separate; never add app or UI source here. See docs/public-source-boundary.md.
- Use Bun 1.4.4 or newer for JavaScript and TypeScript workflows.
- The runtime is the canonical writer for Scout-owned coordination records; clients submit commands through its APIs.
- External harness transcripts are observed source material; never bulk-import them as Scout messages.
- One explicit target is a DM; group coordination requires an explicit channel; broadcast is opt-in.
- Use scout tell for updates and scout ask for requested work or replies.
- Mesh means reachability and coordination, not exactly-once delivery or global consensus.
- Scout assumes trusted local users and agents; do not claim enterprise or compliance readiness.
- Use gitmoji commit subjects and never add AI co-authoring footers.

## Quick Navigation

- Working with **packages/protocol/****? → Run bun run --cwd packages/protocol check.
- Working with **packages/runtime/****? → Run bun run --cwd packages/runtime check and the narrow affected tests.
- Working with **packages/pairing/****? → Run bun run --cwd packages/pairing check.
- Working with **process spawning or shell execution**? → Run bun run sync-exec:fence before committing shell-execution changes.

## Overview

> Scout's public architecture, ownership model, and repository boundary

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

## Quickstart

> Install Scout, verify readiness, and route the first task

This path installs the public `scout` command, initializes its machine-local
state, and routes one real request through the runtime.

## Prerequisites

- Bun 1.4.4 or newer;
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

- Read [Extensions](./extensions.md) to install trusted CLI verbs and enable tab completion.

- Read the [CLI guide](../packages/cli/README.md) for routing, profiles,
  sessions, aliases, channels, and file-backed prompts.
- Read the [overview](./overview.md) for the runtime ownership and public/private
  repository boundaries.
- Run `scout doctor --fix` when the native daemon exposes a conservative repair
  for a reported readiness issue.

## Extensions

> Install trusted CLI extensions, add completion, and read help without running extension code

Scout extensions add CLI verbs without changing the runtime. Install a trusted,
prebuilt local artifact, then run `scout <verb>`. Built-in verbs take precedence.
An extension cannot replace a built-in command. In particular, installing `mesh`
does not switch the built-in `scout mesh` command to the extension.

## Install, update and remove

```bash
scout extensions install sample ./sample-artifact
scout extensions
scout help sample
scout extensions update sample ./sample-artifact-v2
scout extensions remove sample
```

The installer copies regular files and directories. It does not download
packages, build source, execute hooks or search PATH. An artifact can contain at
most 32 MiB, 1,024 entries and 16 directory levels. Symlinks, devices and pipes
are refused. The manifest is limited to 16 KiB.

Update validates a complete new generation before atomically changing the active
link. A failed update leaves the active generation intact. The update result
includes `previousArtifact`. To roll back, use that directory as the source for
another update. Scout retains at most eight generations. Remove and reinstall
to clear the retained generations.

Remove keeps a disabled marker so an older legacy-home copy cannot take over.
Install enables the verb again. The installer does not replace an unmanaged
folder or link. Move that installation aside explicitly before migrating it.
If an interrupted installer leaves a `.locks/<verb>` directory, verify that no
installer owns it before removing the lock.

These commands change installation files only. They do not start, stop or
restart services. A supervisor can reconcile an updated artifact separately.

## Artifact contract

A directory named for the verb contains `extension.json` and a command. For
example, `sample-artifact/` can contain:

```text
extension.json
bin/scout-sample
README.md
```

```json
{
  "api": 1,
  "version": "1.0.0",
  "summary": "Inspect a sample service",
  "command": "bin/scout-sample",
  "docs": "README.md",
  "completion": ["status", "doctor", "--verbose"]
}
```

The command receives the remaining arguments unchanged. `version` must be a
semantic version for managed installation. The installer makes the main command
executable. Ship a prebuilt command for the target machine. No runtime state or
credentials belong in the artifact. The artifact digest covers the manifest
and main command. Change the manifest version when you change another asset.

`docs`, `completion` and `complete` are optional API 1 additions. An API 1
manifest without them still loads. These additions do not change argv or the
environment contract, so they do not require an API version change. Older
loaders ignore these fields and do not provide the new help or completion.

## Reserved commands and unavailable errors

The command registry can reserve a verb for an extension. A reserved verb
never becomes an implicit ask or a `scout-<verb>` executable from PATH. Its
registration remains reserved after removal. `scout pair` is a core command,
not an app extension. A command that connects to an app does not make that app
part of the core. See the [source boundary](./public-source-boundary.md).

If a reserved extension is unavailable, Scout exits with **69**
(`EX_UNAVAILABLE`). With `--json`, Scout writes exactly one JSON object and a
newline to **stderr**, with no stdout output. Any bare `--json` token in the
arguments selects JSON refusal rendering, including after `--`. The unavailable
extension never runs, so Scout interprets that token itself:

```json
{"schema":"scout.cli.command-unavailable/v1","error":"command_unavailable","command":"sample","reason":"missing"}
```

The schema ID, error name, command name, reason and exit code form the machine
contract. Plain mode uses the same exit code and includes the reason with
installation or repair guidance. Do not parse the remaining prose.

| Reason | Meaning |
| --- | --- |
| `missing` | No installation exists in the selected extension roots. |
| `tombstoned` | The selected installation has `disabled: true`. |
| `refused` | Trust, containment, permissions or optional metadata checks refuse the artifact. |
| `incompatible` | The executable artifact declares an unsupported extension API. |
| `corrupt` | The installation has a damaged generation, missing or malformed manifest, missing command, or invalid instance binding. |
| `wrong_instance` | The artifact declares a different instance from the selected CLI instance. |

Scout resolves a reserved extension before automatic broker maintenance. Each
unavailable state, including unavailable help, refuses without an implicit ask,
extension execution, broker maintenance, restart or app start. A valid extension
retains normal dispatch and maintenance policy. Built-ins still take priority.
An unregistered verb retains extension lookup followed by implicit-ask parsing.

### Optional instance binding

An API 1 manifest can declare `"instance": "prod"` or another canonical Scout
instance name. If present, it must match the selected CLI instance. The installer
checks it before publishing a generation; the loader checks it again before
execution or documentation lookup. Unbound API 1 artifacts remain portable.
This field is a local selection guard, not authentication or broker identity.
Older loaders ignore it; use a CLI with this contract when binding is required.
The field does not add environment variables to the extension runner contract.

Scout never searches another instance's home to diagnose an absent artifact.
An artifact present only in another isolated home therefore produces `missing`,
not `wrong_instance`. A damaged primary installation or tombstone blocks legacy
fallback, including a dangling managed-generation pointer. These checks do not
provide a signed artifact inventory or detect every post-install byte change.

## Trust and runtime access

Install only code you trust as your own user. Extensions are not sandboxed.
Scout reads the selected Scout home's `extensions` directory first, then the
legacy home when applicable. `OPENSCOUT_EXTENSIONS_HOME` selects one explicit
extension directory. Scout never discovers executables from PATH.

The loader checks ownership, writable path components, executable permissions
and artifact containment. A refused or removed primary installation blocks
legacy fallback. Optional help and completion assets receive the same trust
checks. Paths must be relative to the artifact and must not contain `.` or `..`
components. Escaping symlinks are refused.

Scout passes `SCOUT_EXTENSION_API`, `SCOUT_EXTENSION_NAME`, `SCOUT_CLI_VERSION`,
`SCOUT_OUTPUT` and `OPENSCOUT_BROKER_URL`. It preserves the selected home
overrides and removes other `SCOUT_*` and `OPENSCOUT_*` variables. It puts its
runtime directory first on PATH. Other user environment variables remain
available. This filter prevents accidental Scout-secret inheritance; it is not
a general secret scrubber or a security sandbox.

Custody decides origin. An operation signed with the machine or node key goes
through the runtime's HTTP API. Operations signed with user-owned keys,
unsigned operations and public-tier requests can originate in the client. SSH
uses the user's SSH policy. Extensions must not read runtime-owned keys or
turn the runtime into a general proxy.

## Tab completion

Generate a script for your shell. Completion reads the live command registry and
installed manifests on each request, so extension installation and updates do
not require regenerating the script. It covers verbs, nested subcommands and
flags. Flag metadata records whether a value follows the flag. Built-in
completion does not discover agent identities, credentials, paths or remote
resources. Flags are catalogued per verb; a command can restrict which flags
apply to a particular subcommand. Use its detailed help to check those rules.

For zsh, run after `compinit`, or put these lines in `.zshrc`:

```zsh
autoload -Uz compinit
compinit
source <(scout completion zsh)
```

For bash 3.2 or newer, put this line in `.bashrc`:

```bash
source <(scout completion bash)
```

For fish, save the generated script in the completion directory:

```fish
mkdir -p ~/.config/fish/completions
scout completion fish > ~/.config/fish/completions/scout.fish
```

### Static words

`completion` is an array of at most 256 words. Each word can contain 1–128
ASCII letters, digits, or these characters: `_ . / : @ % + = , -`.
Spaces, control characters and shell source are not accepted. Scout filters
words by the current prefix. The static list applies to each argument position.

### Executable completion

For context-sensitive completion, use `complete` instead of `completion`:

```json
{
  "api": 1,
  "version": "1.0.0",
  "command": "bin/scout-sample",
  "docs": "README.md",
  "complete": "bin/complete-sample"
}
```

The completion entry must be an executable file inside the artifact. Scout runs
it directly, without a shell. It receives the words after the extension verb as
argv, up to the cursor. The final argument is the current token, which can be
empty. Quotes are already removed by the calling shell. For example, typing
`scout sample status --v` sends `status` and `--v`.

The hook uses the same filtered environment as the main command and runs from
the installed artifact directory. `SCOUT_OUTPUT` is `plain`.
`OPENSCOUT_BROKER_URL` is the explicitly inherited URL, or empty if none was
provided. Completion does not resolve local settings or contact the runtime.

Write one candidate per stdout line. The static-word character and count limits
also apply to hook output. Scout bounds stdout to 16 KiB and the hook to 500 ms.
It ignores stderr and returns no candidates on timeout, nonzero exit or malformed
output. On macOS and Linux, it kills the completion process group on completion
or timeout. A hook must not daemonize or perform mutations. Input is limited to
64 words of at most 2,048 characters each. Installing an extension authorizes
its hook to run during tab completion; use static words when code is unnecessary.
Shell scripts consume candidates as data, never as executable shell source.

## Help for people and agents

`docs` names a Markdown file inside the artifact, limited to 64 KiB.
`scout help sample` prints that installed copy without running the main command
or completion hook. If no file is declared, Scout prints the summary and a
pointer to `scout sample --help`.

```bash
scout help sample --json
scout help search --json
scout help mesh approvals --json
scout help --json
```

JSON help uses `schemaVersion: 1`. Verb help includes the same `markdown` shown
to a person. Built-in help also includes structured flags with `takesValue` and
a nested `subcommands` tree. Extension help includes its version and static
words or an executable-completion indicator, never the executable's contents.
Root JSON help lists the registry and available installed extensions.

`scout help <verb>` is the read-only command reference. Existing
`scout <verb> --help` remains the command's detailed usage and examples. Help
and completion do not run startup maintenance or start services. A refused
extension returns an explicit help error and is omitted from completion.

---
Generated by [Dewey](https://github.com/arach/dewey) | Last updated: 2026-10-26