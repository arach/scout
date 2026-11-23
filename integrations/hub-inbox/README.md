# Scout Hub inbox

Scout Hub brings agent sessions that run in a vendor's cloud, such as Claude Code on the web, into your Scout runtime. A reporter in the sandbox seals new transcript bytes to your runtime's public key and posts them here. Your runtime collects them, opens them, and appends them to local copies that Scout reads like any other session.

This inbox is a Cloudflare Worker over one R2 bucket. It holds sealed bytes and cannot read them. It deletes each chunk when your runtime collects it, and deletes anything left after seven days. One deployment serves one runtime.

The inbox also takes webhooks from Claude Managed Agents. Anthropic can deliver only to a public HTTPS address, which your Mac is not. A webhook names an event type and a session ID and nothing else. The inbox checks its signature and keeps it as a short note. When your runtime collects the note, it pulls that session from Anthropic's API right away. Notes are not sealed: the inbox can read the event type and the session ID, but never the session's content.

## API

| Request | Token | Does |
| --- | --- | --- |
| `POST /v1/inbox/chunks` | write | Adds one sealed chunk (the body). |
| `GET /v1/inbox/pending?after=&limit=` | read | Lists chunks, oldest first. |
| `GET /v1/inbox/chunks/:key` | read | Returns one chunk. |
| `DELETE /v1/inbox/chunks/:key` | read | Deletes one chunk after it is collected. |
| `GET /v1/inbox/health` | read | Returns `{ ok, pending, webhooks }`. |
| `POST /v1/inbox/webhooks/anthropic` | signature | Takes a Managed Agents webhook. Off until `ANTHROPIC_WEBHOOK_SIGNING_KEY` is set. |
| `GET /v1/inbox/nudges` | read | Lists webhook notes, oldest first. |
| `DELETE /v1/inbox/nudges/:key` | read | Deletes one note after the runtime acts on it. |

The write token can only add chunks. It goes into repos, inside `.claude/scout/hub.json`. The read token stays on your machine.

## Set up

1. Make the runtime's key and tokens:

   ```sh
   scout hub init --inbox https://scout-hub-inbox.<your-subdomain>.workers.dev
   ```

2. Deploy the inbox from this folder, using the tokens that `init` printed:

   ```sh
   bunx wrangler@4 r2 bucket create scout-hub-inbox
   bunx wrangler@4 deploy
   printf %s '<read token>'  | bunx wrangler@4 secret put READ_TOKEN
   printf %s '<write token>' | bunx wrangler@4 secret put WRITE_TOKEN
   ```

3. Connect a repo, then review, commit and push what it writes:

   ```sh
   scout hub connect claude-code ~/dev/my-repo
   ```

4. Start a Claude Code cloud session on that repo. `scout hub status` shows what is waiting and what has been mirrored.

5. Optional, for Claude Managed Agents (`scout hub connect managed-agents`). In Anthropic's Console, open Manage → Webhooks. Add `https://<your inbox>/v1/inbox/webhooks/anthropic` and subscribe it to the `session.*` events. Then put the signing secret, which the Console shows only once, on the inbox:

   ```sh
   printf %s '<whsec_… secret>' | bunx wrangler@4 secret put ANTHROPIC_WEBHOOK_SIGNING_KEY
   ```

   Without webhooks, the runtime polls Anthropic every 15 seconds. With them, it pulls when a note arrives and polls every 2 minutes as a backstop. Anthropic drops a webhook after three failed attempts, and the poll catches what was lost.

## Run it locally

```sh
READ_TOKEN=r WRITE_TOKEN=w bun src/serve-local.ts 8787
# with webhooks: ANTHROPIC_WEBHOOK_SIGNING_KEY=whsec_… READ_TOKEN=r WRITE_TOKEN=w bun src/serve-local.ts 8787
bun test src
```

`src/end-to-end.test.ts` runs the reporter under Node the way a hook does, sends to this Worker, and checks that the collector rebuilds the transcript byte for byte.

## What it does not do yet

- A chunk is sealed, not signed. The runtime's public key and the write token are in the repo, so anyone who can read the repo can add chunks. The runtime accepts a chunk only if its path matches Claude's own layout, and it only appends.
- There is one inbox per runtime and no per-repo tokens.
- The runtime picks up webhook notes when it collects, every 15 seconds. That cuts calls to Anthropic, but it is not a push to your Mac.
