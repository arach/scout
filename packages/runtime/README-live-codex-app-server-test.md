# Live Codex App-Server Test

Run the manual live JSON-RPC check against a published Codex app-server listener:

```bash
OPENSCOUT_LIVE_CODEX_APP_SERVER=1 \
OPENSCOUT_CODEX_APP_SERVER_URL=ws://127.0.0.1:8766 \
OPENSCOUT_CODEX_THREAD_ID=<thread-id> \
bun test src/codex-app-server-live.test.ts
```

Notes:

- This test talks to an already running app-server endpoint over WebSocket.
- It does not spawn its own Codex child process.
- It resumes the supplied thread id, starts one turn, waits for completion, and confirms the prompt token appears in the rollout file when the server exposes a local thread path.

The exact opt-in value is `1`. A configured URL and thread ID alone do not
authorize a turn. The `test:live:codex-app-server` package script sets the opt-in
for an explicit live run; the unit script always excludes live files.
