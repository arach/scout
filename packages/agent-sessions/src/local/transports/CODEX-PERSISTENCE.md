# Codex diagnostic persistence failures

Codex stdout/stderr wire logs are observational. A healthy log applies input
backpressure at its high-water mark and releases it at the low-water mark.
A failed append releases that pause immediately; JSON-RPC responses and turn
notifications continue independently of persistence.

The logger drops the failed batch and queued/subsequent payloads while degraded.
It retains counters per sink, not an unbounded transcript, and retries after
one second even if no more input arrives. On recovery it writes a newline and a
`[scout.codex-wire-log-gap/v1] ` marker followed by JSON. The JSON contains a
stable gap `id`, `entries`, UTF-8 `bytes`, `firstAt`, `lastAt`, an error code and
`partialWritePossible`. Counts include the entire uncertain failed append:
these are at-risk observations, not exact missing-byte counts. A partial append
can leave a truncated message before the newline. Do not replay that fragment.
The reserved marker line is diagnostic metadata, not a harness JSON-RPC message.

If a marker append itself fails after writing, its next attempt has the same
ID and body. Input lost while that frozen marker is pending forms another
counted window, so one outage can produce multiple aggregate markers. Readers
can deduplicate complete markers by ID; incomplete marker lines are not valid JSON. No exactly-once append guarantee is made. Normal
log rotation still bounds the active file and its archive, so markers are not
an indefinite audit history. Background retries stop when the session is
disconnected and resume on reconnection.

Thread ID, state, prompt and session-catalog publication use same-directory
staging and rename. A partial write leaves the previous published file intact;
this is atomic publication, not a power-loss durability guarantee. In-memory
control continues on persistence errors, with bounded/coalesced metadata retries.
A thread becomes locally durable only after its ID file is successfully
published and there is existing rollout or server-confirmation evidence.
Retries preserve that distinction. The files do not form a cross-file transaction.
Explicit reset/catalog-close operations retain their existing error behavior;
this recovery does not repair already damaged historical files or restart a
runtime whose input was paused by an older build.
