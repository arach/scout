---
title: Extensions
description: Install trusted CLI extensions, add completion, and read help without running extension code
order: 3
---

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
