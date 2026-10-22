# Setup and doctor help before readiness checks

`scout setup --help` and `scout doctor --help` use the Node-safe launcher
preflight. Human help does not load the CLI's mixed readiness reports, maintain
services, discover apps, or inspect broker health. The same preflight handles
`-h`, `help doctor`, `relay doctor --help` and global instance flags.

Doctor help now identifies both implementations. Bun retains its concise
checks, detail report, v1 NDJSON and explicit native repair modes. The Node
headless entry reports one JSON object, has no detail mode and does not run
native repairs. Help must not advertise Bun-only behavior as Node behavior.
The portable launcher/Bun help includes both sections; the direct Node entry
uses the shorter Node-specific section.

Bun's structured JSON help remains with the command registry. Node's headless
entry has no structured-help API: doctor help with `--json` returns human help,
as its setup help already does. A doctor invocation without help still executes
its existing checks and preserves its existing output and repair policy.

This fixes a normal-install Node bug: `scout doctor --help` previously reached
the diagnostic option parser and failed with `unexpected arguments for doctor:
--help`. Missing desktop/web source was not the cause of that parser failure.
Bun's core-only doctor help previously failed while importing private readiness
modules before it could render its help.

This change does not complete setup or doctor on a core-only install. Their
normal reports still need the core custody and optional-readiness split. It
changes no runtime contract, source ownership classification, native update,
stop, uninstall, app acquisition or service repair operation.
