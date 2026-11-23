# Scout Hub

Verified: 2026-11-23

Scout Hub brings agent sessions that run in a vendor's cloud into this runtime.
Scout then lists, tails and searches them like local sessions. Two connections
exist:

| Connection | Vendor surface | How sessions arrive | Needs an inbox |
|---|---|---|---|
| `claude-code` | Claude Code in the cloud (Claude Code on the web, cloud sessions of a repo) | A reporter in the cloud sandbox seals transcript bytes and posts them to the inbox. The runtime collects them. | Yes |
| `managed-agents` | Claude Managed Agents | The runtime pulls sessions and their events from Anthropic's API with an API key. | No. An inbox adds webhooks. |

Use this spec to set Hub up for the operator, check its state, fix it, and
explain what it can and cannot do.

## Model

| Term | Meaning |
|---|---|
| hub folder | `$OPENSCOUT_HUB_HOME`, default `<openscout home>/hub`. Holds config, the runtime key pair, state and mirrors. Files are readable only by the operator. |
| inbox | One Cloudflare Worker over one R2 bucket (`integrations/hub-inbox`). It stores sealed chunks and webhook notes. It cannot read chunks. One inbox serves one runtime. |
| read token | Lets the runtime list, read and delete chunks and notes. It stays in the hub folder. |
| write token | Lets a reporter add sealed chunks and nothing else. It is committed into connected repos, in `.claude/scout/hub.json`. |
| runtime key | The X25519 key pair in `identity.json`. Reporters seal to its public key. Only this runtime can open chunks. |
| reporter | `.claude/scout/report.mjs` in a connected repo. Claude Code hooks run it only when `CLAUDE_CODE_REMOTE=true`, so local sessions of that repo do nothing. |
| collector | Runtime loop, every 15 s. It fetches chunks, opens them, appends them to the Claude mirror, deletes them from the inbox, then takes webhook notes. |
| puller | Runtime loop for Managed Agents. It lists recent sessions and appends new events to the Managed Agents mirror. |
| mirror | Local copies Scout reads: `hub/claude/projects/<label>/…` (Claude's own layout) and `hub/managed-agents/<label>/<session>.jsonl` with a `.session.json` sidecar (title, status, agent). |
| webhook note | A verified Anthropic webhook, stored as event type + session id only. The runtime acts on it and deletes it. |
| label | A name for a connection: the repo folder name for `claude-code`, a workspace name for `managed-agents`. Scout groups mirrored sessions by it. |

## Set up

Check state before changing anything:

```sh
scout hub status --json
```

The output reports the inbox (reachable, pending chunks, whether webhooks are on), the last collect, mirrored sessions and the Managed Agents connection. It never contains tokens or keys.

### Claude Managed Agents (no inbox needed)

Prerequisite: an Anthropic API key for the workspace, in an environment variable. The operator must provide it. Do not ask for the key in chat.

1. Connect:

   ```sh
   scout hub connect managed-agents --label <workspace-name>
   ```

   The command reads `$ANTHROPIC_API_KEY`. Use `--api-key-env <VAR>` for another variable and `--since-days <n>` to change the lookback (default 7). It lists sessions once to check the key, mirrors what it finds, and stores the key in the hub folder.
2. Verify: `scout hub status` shows the label and a last pull with no error. The sessions appear in Scout under their agent's name.

If the key is rejected, `connect` fails. Its error says whether anything was saved.

### Claude Code in the cloud (inbox needed)

1. Create the runtime key and tokens:

   ```sh
   scout hub init --inbox https://scout-hub-inbox.<subdomain>.workers.dev
   ```

   Without `--read-token` and `--write-token`, `init` makes new tokens and prints the `wrangler secret put` commands for them. Pass both tokens or neither.
2. Deploy the inbox. Follow `integrations/hub-inbox/README.md` (bucket, deploy, `READ_TOKEN`, `WRITE_TOKEN`). Deploying needs the operator's Cloudflare account. Ask before you deploy.
3. Connect a repo:

   ```sh
   scout hub connect claude-code <repo>
   ```

   This writes `.claude/scout/report.mjs`, `.claude/scout/hub.json` and hooks in `.claude/settings.json` (`PostToolUse`, `SubagentStop`, `Stop`, `SessionEnd`). Other hooks and settings stay as they are.
4. The operator reviews, commits and pushes those files. Cloud sessions start from the pushed repo, so nothing reports before the push.
5. Verify: start a cloud session on the repo, then run `scout hub status`. The session appears under the repo's label.

### Webhooks for Managed Agents (optional, needs an inbox)

Without webhooks, the puller polls Anthropic every 15 s. With webhooks, it pulls a session when its note arrives and polls every 2 min as a backstop.

1. In Anthropic's Console, the operator opens Manage → Webhooks, adds `<inbox>/v1/inbox/webhooks/anthropic`, and subscribes it to `session.*` events. Console shows the signing secret once.
2. Put the secret on the inbox: `printf %s '<secret>' | bunx wrangler@4 secret put ANTHROPIC_WEBHOOK_SIGNING_KEY`.
3. Verify: `scout hub status --json` shows `inbox.webhooks.anthropic: true`. After the next session event, `scout hub status` shows "Webhooks: last one <time>".

`scout hub status` prints the exact address to paste. The web app's Settings → Scout Hub page shows it too.

## Manage

| Goal | Command |
|---|---|
| See everything | `scout hub status` (`--json` for agents) |
| Read recent activity | `scout hub activity --limit 50`. Add `--json` for record ids. |
| Re-pull one Managed Agents session | `scout hub pull <session-id>`. This reads its event cursor without scanning other sessions. |
| Test the inbox end to end | `scout hub test --json`. Inspect the result and elapsed milliseconds for each step. |
| Collect and pull now, instead of waiting for the loops | `scout hub collect` |
| Stop a repo from reporting | `scout hub disconnect claude-code <repo>`, then the operator commits the removal. Already mirrored sessions stay. |
| Forget the Managed Agents key | `scout hub disconnect managed-agents`. Mirrored sessions stay. |
| Change lookback or label | Run `connect managed-agents` again with the new flags. |
| Turn a loop off on one runtime | `OPENSCOUT_HUB_COLLECTOR=0` or `OPENSCOUT_HUB_MANAGED_AGENTS=0` in the broker's environment |
| Do any of these from code or a UI | Use the broker API below. |

## HTTP API

The broker serves the same operations as the CLI. Use the CLI from a shell. Use the API from code or a UI. Both call the same functions in `packages/runtime/src/hub/actions.ts`, so they apply the same checks.

| Route | Body | Returns |
|---|---|---|
| `GET /v1/hub/status` | none | Config, last collect and pull, mirrored sessions, webhook address and current `issues`. Reads local state only. |
| `GET /v1/hub/activity?before=<id>&limit=<n>` | none | `{ items, nextBefore }`. Newest first. Default 50, maximum 200. Pass `nextBefore` as the exclusive cursor until it is null. |
| `POST /v1/hub/managed-agents/sessions/:id/pull` | `{}` | `{ sessionId, listed, changed, appended, … }` for one session. |
| `POST /v1/hub/test` | `{}` | `{ ok, steps, webhooksEnabled? }`. Each step has a name, result and elapsed `ms`. A completed diagnostic can return HTTP 200 with `ok: false`. |
| `POST /v1/hub/collect` | `{}` | `{ claudeCode, managedAgents }`: one summary each, `null` for a connection that is not set up. A failure is in the summary's `error`. |
| `POST /v1/hub/managed-agents/connect` | `{ apiKey, label?, lookbackDays? }` | `{ label, lookbackDays, listed, appended, … }` |
| `POST /v1/hub/managed-agents/disconnect` | `{}` | `{ removed }` |
| `POST /v1/hub/claude-code/connect` | `{ repoRoot, label? }` (absolute path) | `{ repoRoot, label, changed, reporterSha256, … }` |
| `POST /v1/hub/claude-code/disconnect` | `{ repoRoot }` | `{ repoRoot, changed }` |

Access:
- Every route is machine-local. A remote or forwarded request gets 403.
- Every `POST` route needs a signed operator request: the `x-openscout-local-admin` headers, an HMAC made with the operator attribution key. Without it the broker answers 403 `operator_attribution_required`. The web app's server signs its broker calls when the runtime handed it the key. A plain `curl` does not sign, so it gets 403.
- The status and activity reads need no signature. Neither returns a token or key.
- Results never contain a token or key. The API key goes in the request body, never in the URL.

Errors are `{ error, detail }`:

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_body`, `api_key_required`, `invalid_label`, `invalid_lookback`, `invalid_repo_root`, `connect_failed` | The request is wrong. `detail` says how. |
| 400 | `invalid_cursor`, `invalid_limit`, `invalid_session_id` | Use a returned cursor, a positive whole-number limit or a valid session id. |
| 403 | `operator_attribution_required`, `forbidden` | Sign actions on the local runtime. Do not forward Hub requests. |
| 409 | `hub_busy` | Another process owns the collect or pull. Retry after it finishes. |
| 409 | `managed_agents_not_connected` | Connect the workspace before a single-session pull. |
| 409 | `hub_not_initialized` | The connection needs `scout hub init` first. |
| 502 | `managed_agents_unreadable` | Anthropic refused the key or could not be reached. `detail` says whether anything was saved. |

To drop mirrored sessions, delete the label's folder under the mirror. Ask the operator first: the vendor might no longer hold the data.

## Troubleshoot

Start with `scout hub status`. It checks the inbox and prints current issues first.
Each issue has an `id`, `severity`, `title`, `detail`, `since` and `fix`.
The runtime computes issues from observations. There is nothing to acknowledge.

Use `scout hub activity` to see what changed before the issue.
The private `activity.jsonl` file holds the newest 1,000 records.
Each record has an increasing `id`, an `at` timestamp, a `kind` and a `summary`.
Idle polls and collects do not add records.

| Symptom | Cause | Fix |
|---|---|---|
| Status: inbox not reachable | Wrong URL, Worker not deployed, or offline | Check the URL in `scout hub status`; deploy the Worker. |
| Last collect error `401` | The read token on the inbox and in the hub folder differ | Re-run `init` with the tokens the inbox has, or put new ones on the inbox. |
| Files "waiting for earlier bytes" | A later chunk arrived before an earlier one. The collector appends in order only. | Wait. The reporter resends a chunk the inbox refused, on its next flush. A file that waits for hours means a chunk was lost after the inbox accepted it; the reporter does not resend accepted bytes. |
| A cloud session never appears | Repo files not pushed, session started before the push, or `CLAUDE_CODE_REMOTE` not set in that sandbox | Check the pushed repo has `.claude/scout/`; start a new cloud session. |
| Managed Agents last pull: key rejected (401) | Key revoked or wrong workspace | `connect managed-agents` again with a valid key. |
| Webhooks on but no last webhook | Console subscription missing, wrong address, or secret mismatch (the inbox answers 400 to bad signatures) | Check the Console delivery log and the address from `scout hub status`. Polling still covers the gap. |
| Webhook refusals | The inbox counted a refusal in the last 24 hours. For example, `bad_signature` can mean a signing secret mismatch. | Follow the fix for that reason in status. Check activity for new refusals. |
| Webhooks look broken | A full poll found a session change after webhooks were enabled. No note for that session arrived within two minutes of the poll. | Check the address, subscription and signing secret. A matching note clears the warning. The observation expires after 24 hours. |
| Inbox test fails | One step failed. Steps that depend on it show `skipped`. | Check the write token for a failed post. Check the read token for a failed list, fetch or delete. Check the runtime key for a failed open. |
| Rejected chunks in the last collect | A chunk's path did not match Claude's layout | Expected for junk writes. See the write-token limit below. |

## What Hub can and cannot do

Can:
- Mirror Claude Code cloud transcripts byte for byte, including subagent files.
- Mirror Managed Agents events in server order, with title, status and agent.
- Show both in Scout's session lists, tail and search. Managed Agents sessions report status `busy` while running and `idle` when idle.
- Pull the session named by a Managed Agents webhook without listing the workspace.
- Re-pull a session by id even outside the configured lookback.
- Verify that the inbox accepts, lists, returns and deletes a test chunk that opens on this runtime. Test chunks never go into mirrors.

Cannot, today:
- Send anything to a cloud session. Hub is read-only. To steer a cloud session, use the vendor's own surface.
- Push to the Mac. Webhook notes wait for the next collect.
- Verify who wrote a chunk. Chunks are sealed, not signed. Anyone who can read a connected repo has the write token and the public key, so they can add chunks. The collector accepts only paths in Claude's layout and only appends.
- Separate tokens per repo. One inbox and one write token serve every connected repo.
- Replay a rejected body. The inbox keeps counts by route and reason, not refused request bodies or headers.
- Prove that Anthropic can deliver a webhook with the inbox test. The optional webhook step checks whether the inbox has a signing secret.
- Mirror vendors other than Anthropic.
- Show Hub on console.openscout.app. The status route is local-only. (Design in progress.)

## Invariants

- The inbox never holds plaintext transcript bytes. Webhook notes hold event type and session id only; organization and workspace ids are dropped.
- Keys and tokens live only in the hub folder (mode 0600) and on the Worker as secrets. `status`, `status --json` and `GET /v1/hub/status` never return them.
- Mirrors are append-only. The collector and puller never rewrite or reorder lines.
- A retried webhook produces one note (keyed on the event id).
- Local sessions of a connected repo never report.

## Forbidden

- Printing, logging or committing the read token, the runtime private key, the API key or the webhook signing secret.
- Passing an API key as a command-line argument or in a URL. Use an environment variable and `--api-key-env`, or the API's request body.
- Running `hub` commands against the operator's real hub folder from a test or a dev checkout. The CLI does not follow the dev instance; set `OPENSCOUT_HUB_HOME` to a folder under `~/.openscout/instances/` first and check where files land.
- Deploying the inbox, changing Worker secrets, or committing reporter files to a repo without the operator's approval.
- Editing mirror files by hand.

## Code map

| Path | Role |
|---|---|
| `packages/cli/src/cli/commands/hub.ts` | `scout hub` commands |
| `packages/runtime/src/hub/state.ts` | hub folder, config, key pair, mirror roots |
| `packages/runtime/src/hub/connect.ts` | writes and removes reporter files and hooks |
| `packages/runtime/src/hub/reporter-source.ts` | the reporter that runs in the sandbox |
| `packages/runtime/src/hub/collector.ts` | collect loop, inbox client, webhook notes |
| `packages/runtime/src/hub/mirror.ts` | path checks and ordered appends |
| `packages/runtime/src/hub/managed-agents.ts` | Managed Agents config, puller, nudges |
| `packages/runtime/src/hub/status.ts` | `readHubStatus` behind `GET /v1/hub/status` |
| `packages/runtime/src/hub/actions.ts` | Hub actions shared by the CLI and HTTP API |
| `packages/runtime/src/hub/activity.ts` | local activity retention and cursor paging |
| `packages/runtime/src/hub/inbox-health.ts` | last successful inbox observation and rejection deltas |
| `packages/runtime/src/hub/round-trip.ts` | timed probe of one sealed test chunk |
| `integrations/hub-inbox/src/rejections.ts` | hourly rejection counters and the 24-hour health window |
| `packages/runtime/src/broker-http-router.ts` | the `/v1/hub/*` routes and their access checks |
| `packages/runtime/src/tail/managed-agents-source.ts` | Managed Agents sessions in tail and discovery |
| `packages/runtime/src/claude-projects.ts` | adds the Claude mirror to Claude's project roots |
| `integrations/hub-inbox/` | the inbox Worker, local server and tests |

## Verification

```sh
bun run check
bun test packages/runtime/src/hub packages/runtime/src/tail packages/runtime/src/broker-attribution-http.test.ts
bun test packages/runtime/src/broker-daemon-route-inventory.test.ts packages/runtime/src/mesh-route-matrix.test.ts
(cd integrations/hub-inbox && bun test src)
```

`packages/runtime/src/hub/hub-http.test.ts` starts a broker and checks that unsigned requests get 403 on every action, and that no response contains the key.

`integrations/hub-inbox/src/end-to-end.test.ts` runs the reporter as a hook does, sends to the Worker, and checks that the collector rebuilds the transcript byte for byte and that a webhook reaches the runtime once.

For a manual test, point `OPENSCOUT_HUB_HOME` at a new scratch folder.
Run the inbox from `integrations/hub-inbox/src/serve-local.ts`.
Initialize the scratch folder with that URL and matching test tokens.
Run `scout hub test --json` and `scout hub activity --limit 1` with the same hub folder.
Check for five passed steps, one test record and no new mirror.
