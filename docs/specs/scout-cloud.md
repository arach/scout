# Scout Cloud

Status: draft, decisions settled 2026-11-26. Nothing in this spec is built.
Layer: Platform (hosted). Wire types, runtime and CLI: `openscout-app/scout`.
Control plane: private platform repo.

Scout Cloud starts Linux and GPU machines that Scout owns. Each machine runs the
real `openscout-runtime` broker, joins the operator's mesh as a peer, sleeps
when idle and wakes when work arrives. Work starts with the same command as on
a second Mac:

```bash
scout ask --on builder --harness codex "Run the full Linux test suite."
```

Scout Hub (`docs/specs/scout-hub.md`, branch `spec/scout-hub`) owns the hosted
relay, the MCP gateway and remote routing. A cloud machine is a Hub source and
a Hub route target. Hub routing requirement 3 wakes a sleeping cloud machine.
This spec does not define a second relay or gateway.

## Scope

In scope:

- a hosted control plane at `cloud.oscout.net` with `/v1/cloud/machines`;
- one provider driver, Fly Machines, behind a `CloudProviderDriver` interface;
- a golden Ubuntu 24.04 image with the runtime and harnesses installed;
- enrollment of each machine as a mesh peer through signed node cards;
- sealed harness and git credentials;
- auto-sleep, wake on ask and manual stop or removal;
- spend caps and billing guardrails;
- the `scout cloud` CLI, and cloud-aware `scout ask --on`.

Out of scope:

- a relay or MCP gateway (owned by Hub);
- production app hosting, public ingress or custom domains;
- a hosted IDE;
- proxying or marking up model tokens;
- background two-way file sync (code moves through Git);
- cloud macOS machines;
- bring-your-own cloud accounts (phase 3);
- enterprise compliance claims or hostile multi-tenancy inside one machine.

## Current system

These facts are verified at `536ff537`. They must remain true unless a
requirement below changes them.

- **No provisioning.** Nothing in `openscout-app/scout` creates, boots,
  suspends, wakes or bills a cloud machine. `SCOUT_COMMANDS`
  (`packages/cli/src/cli/registry.ts`) has no `cloud` command.
- **Machine inventory is passive.** `MachineEvidence`
  (`packages/protocol/src/machines.ts`) has five kinds: `scout`, `tailnet`,
  `lan`, `host` and `ssh`. It observes machines and never controls them.
- **Remote dispatch.** `scout ask --on <host>` resolves the host through
  `resolveMeshHost` against `trusted_peers`. If the peer is offline, the ask
  fails before effect. A remote ask needs an explicit `--project` that exists on
  the peer. `broker-daemon.ts` refuses `workspace: "new_worktree"` for a session
  on another machine. `MESH_SESSION_START_PATH` is `/v1/mesh/sessions/start`
  (`packages/runtime/src/broker-session-wake.ts`).
- **Grant channels.** `TrustedPeerGrantChannel` (`packages/protocol/src/mesh.ts`)
  is `"sas" | "github" | "ssh"`. Enrollment lives in
  `packages/runtime/src/mesh-trust-enrollment.ts`.
- **Flight state.** `FlightState` (`packages/protocol/src/invocations.ts`)
  already includes `"waking"`. Today `broker.ts` sets it only for local agents
  when `invocation.ensureAwake` is true. No code sets it for a remote machine.
- **Account sign-in.** `scout auth login` runs an RFC 8628 device flow against
  `https://console.openscout.app` and stores an `osdist_*` key
  (`packages/runtime/src/dist-access.ts`). The key is used for `/v1/dist/*`
  today.
- **Harness credentials.** `CREDENTIAL_DOMAINS` and `HARNESS_AUTH_MODELS`
  (`packages/agent-sessions/src/auth/domains.ts`) mark each credential with
  `portable` and `secret`.
- **Sealing.** `packages/runtime/src/hub/seal.ts` implements X25519 +
  HKDF-SHA256 + AES-256-GCM envelopes.
- **Redaction.** `packages/runtime/src/secret-redaction-bootstrap.ts` scrubs
  secret values from runtime output.
- **Linux supervision.** The `systemd-user` service adapter
  (`packages/runtime/src/runtime-adapters.ts`) supervises the broker on Linux.
  `scoutd` is macOS only.

## Terms

- **Cloud machine**: a Scout-owned Linux VM running `openscout-runtime`, with
  id `cmach-<ulid>`.
- **Operator node**: the machine that ran `scout cloud up` and owns the grant.
- **Control plane**: the hosted service at `cloud.oscout.net`.
- **Driver**: one `CloudProviderDriver` implementation (Fly in the MVP).
- **Power state**: `provisioning`, `running`, `stopping`, `sleeping`, `error`
  or `terminated`.
- **Sleep**: a clean provider `stop` that keeps the volume. Compute billing
  stops.
- **Wake**: a provider start from sleep, followed by the machine's Hub link
  opening.
- **Spend cap**: the hard monthly ceiling on cloud compute for one account.

## Wire types

In `packages/protocol/src/machines.ts`, add a sixth evidence kind:

```ts
export interface CloudMachineEvidence extends MachineEvidenceBase {
  kind: "cloud";
  cloudMachineId: string;          // "cmach-<ulid>"
  name: string;
  nodeId?: ScoutId;
  keyId?: string;
  size: CloudMachineSize;
  region: string;
  powerState: "provisioning" | "running" | "stopping" | "sleeping" | "error";
  wakeable: boolean;
  idleTimeoutSeconds: number | null; // null = keep alive
  repoRoots: string[];             // e.g. ["/work/scout"]
  activeHourlyCents: number;
  sleepingHourlyCents: number;
}

export type CloudMachineSize = "cpu-2" | "cpu-4" | "cpu-8" | "cpu-16";
```

`groupMachineEvidence` must join `CloudMachineEvidence` with
`ScoutMachineEvidence` on `nodeId`, so that one cloud machine shows as one
record.

In `packages/protocol/src/mesh.ts`, extend the grant channel:

```ts
export type TrustedPeerGrantChannel = "sas" | "github" | "ssh" | "cloud";
```

Flights: reuse `FlightState = "waking"`. Add `waitingFor: "cloud_wake"` to the
flight when a remote cloud wake is in progress.

Control plane API (`cloud.oscout.net`, authenticated with the operator's
account key):

```ts
// POST /v1/cloud/machines
interface CreateCloudMachine {
  name: string;
  size: CloudMachineSize;
  region?: string;
  idleTimeoutSeconds?: number | null;
  ttlSeconds?: number;
  repo?: string;                   // "owner/name"
  harnesses: string[];
  initiatorCard: SignedNodeCard;
  nonce: string;                   // 32 random bytes, base64url
}
interface CloudMachineCreated {
  machine: CloudMachineEvidence;
  vmCard: SignedNodeCard;          // signed inside the VM
  nonceSignature: string;          // Ed25519 over nonce, by the VM key
  sealingPublicKey: string;        // X25519, from the VM
}

// GET    /v1/cloud/machines                -> { machines: CloudMachineEvidence[] }
// POST   /v1/cloud/machines/:id/wake       -> { machine }
// POST   /v1/cloud/machines/:id/stop       -> { machine }   body: { force?: boolean }
// DELETE /v1/cloud/machines/:id            -> { terminated: true }
// POST   /v1/cloud/machines/:id/secrets    body: { envelope: SealedEnvelope }
// GET    /v1/cloud/machines/:id/logs       -> text/event-stream (guest bootstrap and broker logs)
// GET    /v1/cloud/account                 -> { spendCents, capCents, creditCents }
```

The local broker exposes the same paths under its own `/v1/cloud/*` routes. The
CLI must call the local broker, never the control plane directly (see "Modes of
interconnection").

## Modes of interconnection

| Mode | Who uses it | Path |
| --- | --- | --- |
| `scout cloud` CLI | people, scripts, agents with a shell | local broker `/v1/cloud/*`, which calls the control plane |
| Cloud API | the local broker, the apps | `cloud.oscout.net/v1/cloud/*` |
| MCP | agents | `hosts_list` and `ask` only; no lifecycle tools in the MVP |
| Hub | remote callers, phone, subscriptions | Hub routes to the machine and wakes it (Hub routing requirement 3) |
| Mesh | the operator node and its peers | direct Iroh `openscout/mesh/1` when both sides are online |

Rules:

1. The local broker is the only writer of local records. It must update
   `trusted_peers`, `NodeDefinition` and the cached `CloudMachineEvidence` in
   the same commit as each lifecycle call.
2. Lifecycle (`up`, `stop`, `rm`, `secrets`) must not be exposed as MCP tools in
   the MVP. Reason: an agent must not create billable machines on its own.
3. `ask` and `hosts_list` must show cloud machines with their power state.
4. If the operator node is online, a local `scout ask --on <cloud machine>`
   wakes the machine through its own broker and the control plane. If the
   operator node is offline, Hub wakes the machine.

## Requirements

### Provisioning

1. `scout cloud up` must create a machine from a version-pinned golden image:
   Ubuntu 24.04, Bun, Node 24, Git, `gh`, Python 3.12 with `uv`, Rust stable,
   `tmux`, `ripgrep`, Chromium and `Xvfb`, `@openscout/scout`, Claude Code,
   Codex and OpenCode.
2. The image build must fail if any harness auth file exists under the guest
   home before the snapshot.
3. The guest must run `openscout-runtime broker` under the `systemd-user`
   adapter with `loginctl enable-linger` and `OPENSCOUT_ADVERTISE_SCOPE=mesh`.
4. Bare `scout cloud up` inside a git checkout must default to name `cloud`,
   size `cpu-4`, idle timeout 30 minutes and `--repo` from the `origin` remote.
5. The control plane must use one `CloudProviderDriver` interface with
   `provision`, `wake`, `suspend`, `destroy` and `inspect`. The MVP ships only
   the Fly driver.

### Enrollment and trust

1. The VM must generate its Ed25519 node key on its own volume. The key must
   never leave the VM.
2. The control plane must pass only the initiator's public `SignedNodeCard` and
   the nonce to the VM.
3. The VM must verify the initiator card and install a `control` grant for the
   operator node with `grantedVia: "cloud"`.
4. The CLI must verify the VM card and the nonce signature before it writes the
   `TrustedPeerRecord`. If either check fails, the CLI must destroy the machine
   and write nothing.
5. The operator node must grant the VM `observe` plus reply and operator-ask
   authority by default. The VM must not start sessions on the operator node.
   `scout cloud up --trust control` grants `control` instead.
6. The VM must hold only an `osvm_*` machine token. It can report heartbeat and
   idle state for its own `cloudMachineId`. It must not create, list or change
   other machines or the spend cap.

### Secrets

1. The CLI must offer only credentials marked `portable: true` in
   `CREDENTIAL_DOMAINS`. It must show variable names, never values.
2. If Claude Code has only a non-portable login, the CLI must say so and name
   `claude setup-token` or `ANTHROPIC_API_KEY` as the fix.
3. The CLI must seal the selected values to the VM's X25519 key with the
   `seal.ts` envelope and the label `"openscout.cloud.secrets.v1"`. The control
   plane must see only ciphertext.
4. The guest must open the envelope into a mode-`0700` tmpfs at
   `/run/user/1000/scout/secrets`. Secrets must not be written to the volume.
5. Where a harness has a credential helper (`apiKeyHelper`, `GIT_ASKPASS`), the
   guest must configure the helper to read from tmpfs.
6. On wake, the operator node must re-send the sealed envelope. If the operator
   node is offline, the machine wakes without secrets and the flight reports
   `waitingFor: "secrets"` until the operator node returns. A sealed-at-rest
   envelope that removes this wait is phase 2.

### Wake and sleep

1. If a machine has zero running or waiting flights and zero active harness
   turns for its idle timeout, the control plane must sleep it with a clean
   provider stop.
2. `--keep-alive` must disable auto-sleep for that machine.
3. If `resolveMeshHost` matches a cloud node that is not reachable and has
   `wakeable: true`, the broker must accept the ask, set the flight to
   `waking`, call wake and wait up to 45 s for the peer to answer on
   `MESH_SESSION_START_PATH`. Then the flight moves to `running`. The broker
   must not fail the ask with `unreachable`.
4. If the wake does not finish within 45 s, the flight must fail with
   `wake_timeout` and the driver's last state.
5. When `--project` is omitted and the target is a cloud machine, the broker
   must pick the `repoRoots` entry that matches the caller's repo, or the only
   entry if there is one. Otherwise it must fail and list the entries.
6. `MESH_SESSION_START_PATH` must accept `workspace: "new_worktree"` and an
   optional `gitCloneUrl` for cloud peers. Each such ask gets its own worktree
   under `/work/<repo>/.scout-worktrees/<slug>`.
7. `scout cloud stop` must refuse while a flight is running, unless `--force` is
   passed.
8. `scout cloud rm` must delete the VM and its volume and revoke the
   `TrustedPeerRecord` on the operator node.

### Spend caps

1. The first `scout cloud up` on an account without a cap must print one setup
   link, `https://console.openscout.app/cloud`, and stop. A cap is mandatory.
2. The control plane must warn the operator at 80% and at 100% of the cap.
3. At 100%, the control plane must stop all running machines cleanly, keep
   their volumes, and refuse `up` and `wake` with `spend_cap_reached` until the
   cap is raised.
4. The paid plan includes a monthly credit. Usage beyond the credit draws from a
   prepaid wallet, bounded by the cap.
5. `--ttl <duration>` must destroy the machine when the duration ends.

### Limits

- New accounts: at most 4 machines and no GPU sizes until the first billing
  cycle clears.
- Outbound TCP port 25 is blocked.
- Sustained full CPU or network use with no harness process running must
  suspend the machine and notify the operator.

## CLI

New file `packages/cli/src/cli/commands/cloud.ts`, registered in `registry.ts`.

```bash
scout cloud up [name] [--size cpu-2|cpu-4|cpu-8|cpu-16] [--repo <owner/name>]
               [--harness <list>] [--idle <duration>|--keep-alive] [--ttl <duration>]
               [--region <code>] [--trust control]
scout cloud ls
scout cloud stop <name> [--force]
scout cloud rm <name>
scout cloud secrets <name> [--add <VAR>] [--remove <VAR>]
scout cloud logs <name> [--follow]
```

`scout cloud up` must print the machine size, mesh peer, workspace path, active
and sleeping hourly cost, monthly spend against the cap, and the exact
`scout ask --on <name>` command to start work.

`scout ask --on cloud` with no machine named `cloud` must offer once, on an
interactive terminal, to create one with the defaults. Any other unknown name
must fail with `No machine named "<name>"` and must not create a machine.

## Failure behavior

| Condition | Required behavior |
| --- | --- |
| Card or nonce check fails during `up` | Destroy the machine; write no peer record; exit nonzero. |
| No spend cap set | Print the setup link; create nothing. |
| Spend cap reached | Stop running machines; keep volumes; refuse `up` and `wake` with `spend_cap_reached`. |
| Wake exceeds 45 s | Flight fails with `wake_timeout` and the driver state. |
| Woken without secrets (operator node offline) | Flight shows `waitingFor: "secrets"`; resumes when the envelope arrives. |
| `--project` omitted and no single match | Fail before effect; list `repoRoots`. |
| `stop` while a flight runs | Refuse unless `--force`. |
| Unknown `--on` name other than `cloud` | Fail fast; create nothing. |
| Control plane unreachable | Lifecycle commands fail with the HTTP error; existing running machines keep working over the mesh. |

## Files to change

Protocol: `packages/protocol/src/machines.ts` (`CloudMachineEvidence`,
`groupMachineEvidence`), `mesh.ts` (`"cloud"` grant channel),
`invocations.ts` (`waitingFor` values).

Runtime: `packages/runtime/src/broker-cloud-service.ts` (new),
`broker-session-wake.ts` (remote `waking`, `new_worktree`, `gitCloneUrl`),
`broker-daemon.ts` (remove the cross-machine `new_worktree` refusal for cloud
peers, wire `broker-cloud-service`), `mesh-trust-enrollment.ts` (cloud card
exchange).

Agent sessions: `packages/agent-sessions/src/auth/types.ts` (a
`CredentialResolver` for portable values).

CLI: `packages/cli/src/cli/commands/cloud.ts` (new), `cli/registry.ts`,
`commands/ask.ts` (cloud workspace inference, the `cloud` offer).

Guest: `scout-cloud-guest` bootstrap (new, in the image pipeline).

The control plane, the Fly driver, the image pipeline, billing and the idle
reaper live in the private platform repo. The public core must not import from
it. Manual Linux peers (`scout mesh enroll ssh://...`) stay free and unchanged.

## MVP slices

Build in this order. Each slice must pass its checks before the next starts.

1. **Protocol and image.** `CloudMachineEvidence`, the `"cloud"` grant channel,
   `new_worktree` and `gitCloneUrl` on `MESH_SESSION_START_PATH`. Golden image
   on Fly for `cpu-2` to `cpu-16`.
   - Unit tests: `groupMachineEvidence` merges cloud and scout evidence into one
     record.
   - The image build fails when a harness auth file is planted in the guest
     home.
2. **Control plane, enrollment and secrets.** `/v1/cloud/machines` with the Fly
   driver, usage ledger and capped billing. `broker-cloud-service.ts` and
   `scout cloud up|ls|stop|rm|secrets|logs`.
   - **Cold provision**: with `$10` credit and `OPENAI_API_KEY` set locally,
     `scout cloud up builder --repo openscout-app/scout --harness codex`
     returns `ready` in under 15 s. `builder` appears in `scout hosts` and in
     `scout mesh peers` with `grantedVia: "cloud"`. `cloud.oscout.net` stores
     no plaintext secret.
   - A tampered VM card makes `up` destroy the machine and write no peer record.
3. **Dispatch, wake and sleep.** Remote `waking`, workspace inference, the
   30-minute idle reaper and the 80% and 100% cap behavior.
   - **Task dispatch and worktree isolation**: two concurrent
     `scout ask --on builder --harness codex ...` commands create isolated
     sessions, stream status to `scout check --machine builder`, and return
     completed flight receipts.
   - **Auto-sleep and wake on ask**: after 30 minutes with zero active flights,
     `scout cloud ls` shows `builder` as `sleeping` at `$0.00/hr` compute. A new
     `scout ask --on builder ...` puts the flight in `waking`, resumes `builder`
     within 10 s and completes without manual action.
   - **Spend cap enforcement**: at 100% of the cap, the control plane stops
     running machines, keeps their volumes, and refuses `up` and `wake` with a
     budget message until the cap is raised.
4. **Hub routing.** Register cloud machines as Hub sources and route targets.
   Depends on Hub slice 4.
   - With every Mac offline, an ask from a remote MCP client to `builder` wakes
     it through Hub and completes.

Later phases: GPU sizes (`gpu-l4`, `gpu-a100`); a Hetzner driver for heavy and
keep-alive machines; Crew worker pools bound to ephemeral cloud machines; a
sealed-at-rest secret envelope for wakes without the operator node; Linux
`scout browser` views; bring-your-own cloud accounts; team pools; machine
forking.

## Decisions

Settled by Art on 2026-11-26.

1. **CLI verb.** A top-level `scout cloud` command. `scout machines` stays
   read-only.
2. **First ask.** `scout ask --on cloud` offers once to create a machine. Any
   other unknown name fails fast, so that a typo never bills a machine.
3. **Trust.** Asymmetric by default. The cloud machine can reply and ask the
   operator. It cannot start sessions on the operator node unless `--trust
   control` is passed.
4. **Secrets across sleep.** The operator node re-sends the sealed envelope on
   wake in the MVP. A sealed-at-rest envelope follows in phase 2.
5. **Billing.** A monthly credit in the paid plan, then a prepaid wallet with a
   mandatory hard monthly spend cap.
6. **Substrate.** A Scout-managed fleet on Fly Machines for the MVP. Hetzner
   follows in phase 2. Bring-your-own cloud follows in phase 3.

## Not verified

- Fly wake time of about 2 s, and the 10 s wake and 15 s cold-provision targets.
  These come from the drafting model, not from measurement.
- Hetzner compute cost of about 4x less than Fly, and its 20 s to 45 s start
  times.
- GPU availability on Fly by region.
- Per-size prices (for example `cpu-4` at `$0.08/hr`) and sleeping storage at
  `$0.15/GB-month`.
- The three-week MVP estimate.
- Whether the `osdist_*` device grant can be widened to cover `/v1/cloud/*`.
  Confirm this in `packages/cli/src/cli/commands/auth.ts` and the console before
  slice 2.
