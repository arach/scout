# Remote-target program registry

This documentation registry names fixed programs carried inside source strings
and executed on another machine. The sync-exec fence inspects host-language AST
occurrences, not operations inside those strings. This registry is beside
`sync-exec-allowlist`, not inside it. It grants no symbol or file allowance and
does not extend the fence's census.

Every new encoded-program sync exec must have:

1. A source comment that explains the fixed program, input boundary and lifetime.
2. A pinned-constant test that asserts the program against the issued argv.
3. A registry entry with the source, operation, reason, owner and test references.

Keep executable fixtures for target-dependent behavior. A registry entry records
review scope; it does not authorize execution or establish complete discovery.

## update-runtime-status

- **Owner:** CLI updater maintainers (E1 for the core split).
- **Source:** [`packages/cli/src/cli/commands/update.ts`](../packages/cli/src/cli/commands/update.ts),
  `REMOTE_RUNTIME_STATUS_JS` and `REMOTE_RUNTIME_STATUS_SHELL`.
- **Target:** POSIX shell selects an existing Node or Bun interpreter. That
  interpreter calls `node:child_process.spawnSync` with fixed argv
  `openscout-runtime service status --json`.
- **Reason:** Select the target's explicit instance, then its client pointer,
  then `prod`, with ECMAScript `.trim()` semantics. Shell `${VAR:-}` does not
  treat whitespace-only values as absent.
- **Boundary:** Program text contains no caller-provided command or instance.
  Selection uses the target's environment. Runtime owns instance normalization
  and isolation. The existing SSH process-group timeout bounds the wrapper and
  child. Missing interpreter or runtime remains unreadable; there is no doctor
  or private-product fallback.
- **Pinned argv and executable fixtures:**
  [`update.test.ts`](../packages/cli/src/cli/commands/update.test.ts) duplicates
  both constants, asserts the issued local/remote argv, and executes the target
  shell with real Node and Bun against a fake runtime. Cases cover explicit,
  pointer, default and Unicode-whitespace selection, caller-context isolation,
  and missing interpreter/runtime. These fixtures do not contact an SSH host.

Declaration SHA-256: `5902b8af34334f04a9d2e26a79a3cedb0ff6fcfcc5078475f4f86a0bc45691f5`

The digest covers the two complete TypeScript variable statements in the order
listed, joined with one LF. It excludes leading comments and uses the source
bytes without reformatting. When either declaration changes, review the program
and its pinned argv/fixtures before updating this digest.

## Deferred member: machine-update-remote staging

[`machine-update-remote.ts`](../packages/cli/src/cli/machine-update-remote.ts)'s
`REMOTE_STAGE_SCRIPT` carries a fixed Python program with `subprocess.run`.
CLI updater maintainers must add its reviewed entry and pinned-constant test
when that program next moves or changes. This note names the existing blind
spot; it is not a completed entry or a claim that its program is checked here.

## Check the named entry

```sh
bun run test:remote-target-programs
```

The root `test:unit:source` chain delegates to `test:unit:source:core`, which
runs this named check before the package suites. Hosted CI runs that core
partition in `checks`; `pairing-owners` runs the separate owners partition.
A failing registry check stops the core chain through `&&`; it does not require
a separate workflow step.

The negative check pins only the two named source declarations. It fails if
either changes without the registry digest, or if the entry disappears. It
parses the enclosing TypeScript declarations, never the encoded program text,
and never executes them. It does not discover new encoded programs. Source
review must enforce the three requirements for each new program.
