# Scout Cloud

Status: Draft specification (`0.5.4` baseline)

Scout Cloud starts Linux and GPU machines in the cloud, installs the Scout runtime on them, enrolls them into your mesh, and wakes them when you send work. Once a cloud machine exists, starting work on it uses the same command as starting work on a second Mac:

```bash
scout ask --on builder --harness codex "Run the full Linux test suite and open a draft PR with the fix."
```

## Verified baseline in core today

Nothing in `openscout-app/scout` provisions, boots, suspends, wakes, or bills cloud machines today. A code audit at `0.5.4` confirms the exact seams that already exist and where they stop:

- **Command registry (`packages/cli/src/cli/registry.ts`)**: `SCOUT_COMMANDS` registers local lifecycle verbs (`setup`, `up`, `down`, `ps`, `install`), mesh verbs (`mesh`, `hosts`, `machines`, `pair`), Platform verbs (`hub`, `browser`, `computer`, `auth`), and routing verbs (`ask`, `reply`, `wait`, `flight`). No `cloud` command or remote VM lifecycle verb exists.
- **Machine inventory (`packages/protocol/src/machines.ts`, `packages/cli/src/cli/commands/machines.ts`)**: `MachineRecord` (`mach-*`) assembles passive sightings from five evidence channels: `scout`, `tailnet`, `lan`, `host`, and `ssh`. It observes machines that already exist and never creates or controls one.
- **Remote host dispatch (`packages/cli/src/cli/options.ts`, `packages/cli/src/cli/commands/hosts.ts`, `packages/runtime/src/broker-daemon.ts`, `packages/runtime/src/broker-session-wake.ts`)**: `scout ask --on <host>` resolves `<host>` through `resolveMeshHost` against already-registered `NodeDefinition` records in `trusted_peers` (`TrustedPeerRecord` in `packages/protocol/src/mesh.ts`). If the peer is offline, `resolveMeshHost` returns `unreachable` and fails before effect. Today `--on <host>` also requires an explicit `--project <path on host>` that already exists on that peer, and `broker-daemon.ts` refuses `workspace: "new_worktree"` across machines.
- **Scout Hub (`packages/cli/src/cli/commands/hub.ts`, `packages/runtime/src/hub/`)**: `@openscout/runtime/hub` brings transcripts in from sessions that already run inside a third-party vendor sandbox. For `claude-code`, a repo-committed hook seals transcript chunks with X25519 and AES-256-GCM (`seal.ts`) and posts them with a write-only token (`shw_*`) to an untrusted inbox; `HubCollectorService` (`collector.ts`) pulls and mirrors `.jsonl` files locally. For `managed-agents`, `ManagedAgentsPuller` (`managed-agents.ts`) polls Anthropic's API with `$ANTHROPIC_API_KEY`. Similarly, `packages/runtime/src/devin-cloud-cli-transport.ts` attaches to existing Devin cloud sessions. None of these start a machine, run a Scout broker, or join the mesh.
- **Scout Computer (`packages/cli/src/cli/commands/browser.ts`, `packages/cli/src/cli/commands/computer.ts`)**: `browser` routes actions through `@openscout/runtime` (`scout-companion`, `scout-native`, `scout-safari`, `browser-use`). `BrowserSurfaceMode` already includes `"remote"` in its union type, though no cloud browser host is wired yet. `computer` drives macOS Accessibility and window surfaces locally.
- **Account sign-in and harness auth (`packages/cli/src/cli/commands/auth.ts`, `packages/runtime/src/dist-access.ts`, `packages/agent-sessions/src/auth/types.ts`, `packages/agent-sessions/src/auth/domains.ts`)**: `scout auth login` already runs an RFC 8628 device flow against `https://console.openscout.app` and stores an `osdist_*` key in macOS Keychain, Linux Secret Service, or a `0600` file. `CREDENTIAL_DOMAINS` and `HARNESS_AUTH_MODELS` already classify every harness credential with `portable: boolean` and `secret: boolean` specifically to distinguish machine-local OAuth caches from tokens that can seed a cloud machine.

### Where Scout Cloud sits in the three-layer model

Scout groups products into three layers:

1. **Apps**: Mac, iOS, Android, Web, and TUI surfaces.
2. **Platform**: Harness plugins, observed sessions, session search, mesh networking, Scout Hub, Scout Computer, and **Scout Cloud**.
3. **Core**: The open-source protocol, local runtime, harness session adapters, CLI, MCP server, and `scoutd` in `openscout-app/scout`.

Scout Cloud joins **Platform**. Unlike Scout Hub (which observes sessions inside a vendor's locked sandbox), Scout Cloud starts and owns the virtual machine, runs the real `@openscout/runtime` broker inside it, and enrolls it as a first-class mesh peer.

| Capability | Second local Mac (`mesh`) | Scout Hub (`scout hub`) | Scout Cloud (`scout cloud`) |
| --- | --- | --- | --- |
| Who owns the machine | User hardware | Vendor sandbox (Anthropic, Cognition) | Scout Cloud (or user BYOC account) |
| Runs `@openscout/runtime` broker | Yes | No (write-only chunk reporter or API pull) | Yes |
| Addressable via `scout ask --on` | Yes | No | Yes |
| Wakes on demand and auto-sleeps | No (depends on Mac sleep state) | Vendor-managed | Yes (`FlightState = "waking"`) |
| Root Linux packages, Docker, GPUs | macOS / user-configured | Locked vendor container | Full Linux VM + optional GPU |

---

## 1. The promise and who it is for

### The promise

Give Scout elastic Linux and GPU machines that feel like another local machine in your mesh, without SSH key choreography, Tailscale ACL edits, Terraform, or runaway cloud bills. You start work with `scout ask --on <cloud-host>`. Scout wakes the machine if it is sleeping, runs the agent with only the portable credentials you approved, streams coordination state back to your Mac and paired phone, and puts the machine back to sleep when the work finishes.

### Who it is for and why local-only breaks down

Scout Cloud serves individual developers, technical founders, and small high-trust engineering teams whose agent usage has outgrown a single laptop, as well as local orchestrator agents (`role: orchestrator`) that delegate lanes across a crew:

1. **Long autonomous runs**: Multi-hour refactors, `/goal` loops, release-train convergence, and overnight test-fix cycles fail when you close your MacBook lid or walk between networks. A cloud machine finishes the flight while your laptop is asleep in your bag and posts decision cards or completion alerts to your phone.
2. **Parallel fan-out (worker pools)**: In Scout's crew topology, one Architect or Lane Owner fans work out to a pool of *N* workers. Running 10 concurrent worktrees and Rust or TypeScript builds on one laptop saturates CPU, memory, and disk I/O and fights your editor and browser. Fanning tasks across `builder-1` through `builder-8` isolates every build loop.
3. **Always-on standing agents**: Slack, Linear, and GitHub triage agents (`scout integration`), scheduled release trains, and standing reviewers need 24/7 reachability without requiring a dedicated Mac mini on home power and residential internet.
4. **Heavy builds and clean environments**: Large Rust workspaces, container image builds, browser matrix runs, and full monorepo test gates run on 8 to 32 vCPU NVMe builders without spinning laptop fans or polluting local state.
5. **Linux-native targets and GPUs**: Reproducing Linux-only CI failures, running systemd or container workloads, driving virtual-display Chrome (`scout browser`), and running CUDA jobs (model evals, embeddings, local open-weight inference, media pipelines) require Linux kernels or NVIDIA GPUs that a MacBook does not have.

---

## 2. The user's path and cost model

The day-to-day interface stays `scout ask --on <host>`. Machine lifecycle lives under one compact verb, `scout cloud`, with six subcommands: `up`, `ls`, `stop`, `rm`, `secrets`, and `logs` (plus `ssh` as an escape hatch for interactive inspection).

### Step 1: Sign in and set a spend cap (once)

The user signs in with the existing terminal flow:

```bash
scout auth login
```

`scout auth login` opens `console.openscout.app/device` and saves the account credential in the OS credential store. On first `scout cloud up`, if the account has no active Platform plan or cloud credit balance, Scout prints one billing setup link (`https://console.openscout.app/cloud`) where the user enables cloud compute with a **mandatory monthly spend ceiling** (default `$50/month`).

### Step 2: Start a cloud machine

```bash
scout cloud up builder --size cpu-8 --repo arach/scout --harness claude,codex
```

If the user runs bare `scout cloud up` inside a git checkout, Scout defaults the name to `cloud`, the size to `cpu-4` (4 vCPU, 8 GB RAM, 40 GB NVMe), the idle timeout to `30m`, and `--repo` to the current checkout's `origin` remote.

During `scout cloud up` (target: under 12 seconds from a warm base snapshot):

1. Scout inspects local readiness for the requested harnesses through `HARNESS_AUTH_MODELS` (`packages/agent-sessions/src/auth/domains.ts`).
   - If portable credentials exist (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), Scout lists their variable names (never values) and confirms sealing them to `builder`.
   - If Claude Code only has a non-portable `~/.claude/.credentials.json` login, Scout explains how to mint a portable subscription token (`claude setup-token`) or pass an API key.
2. The Scout Cloud control plane boots the Linux microVM from the Scout golden image.
3. Inside the VM, the guest bootstrap generates the VM's Ed25519 node identity keypair, starts `openscout-runtime broker` under systemd, and returns its signed node card.
4. The local CLI verifies the signed card, installs the peer grant, seals the approved harness and git credentials directly to the VM's public key, and clones `arach/scout` into `/work/scout`.
5. Scout prints the receipt and cost meter:

```text
builder is ready (ubuntu-24.04 · cpu-8: 8 vCPU, 16 GB RAM, 40 GB disk · iad)
  Mesh peer: builder (osc1:8f2a-41c9) · control tier · Iroh direct
  Workspace: /work/scout (arach/scout) · harnesses: claude, codex
  Cost: $0.16/hr while active · $0.008/hr while sleeping · auto-sleep after 30m idle
  Monthly cloud spend: $0.00 / $50.00 cap

Start work:
  scout ask --on builder --harness codex "Run the test suite"
```

### Step 3: Run work with `scout ask --on`

From any local terminal, the Mac app, or an orchestrator session:

```bash
scout ask --on builder --harness codex "Fix the flaky socket test on Linux and push branch fix/linux-socket."
```

When `--on <host>` targets a cloud machine and `--project` is omitted, Scout resolves the workspace automatically: if the caller is in a git repo matching one of the cloud machine's `/work/<repo>` checkouts, Scout uses that path; if the cloud machine holds a single checkout, Scout uses that checkout. Explicit `--project /work/other` still works unchanged.

Everything after acceptance uses existing Scout coordination:

- `scout wait <flight>`, `scout check --machine builder`, `scout watch`, and `scout hosts` show live progress.
- Permission gates and human questions (`scout ask --operator`) route back to the operator's Mac or paired iPhone.
- Screenshots and artifacts published with `scout show` flow back to the project canvas.

### Step 4: Auto-sleep, wake-on-ask, stop, and destroy

- **Auto-sleep**: When `builder` has zero running or waiting flights and zero active harness turns for 30 minutes (`--idle 30m`, or `--keep-alive` to disable for standing 24/7 agents), the VM suspends. Compute billing stops immediately. `/work` and session transcripts on disk remain intact.
- **Wake-on-ask**: Sending `scout ask --on builder ...` to a sleeping machine does not fail with `unreachable`. The flight enters `waking` (`FlightState = "waking"` in `packages/protocol/src/invocations.ts`), Scout Cloud resumes the VM in 2 to 8 seconds, the mesh connection re-establishes, and the task dispatches automatically:
  ```text
  On builder · ask queued · harness codex (requested) · task inv-9a41...
  Dispatch waking: resuming cloud machine builder (sleeping 4h 12m).
  Follow: scout wait inv-9a41... --timeout 600
  ```
- **Manual stop (suspend)**: `scout cloud stop builder` suspends compute immediately and keeps the persistent volume and mesh identity. If a flight is `running`, `stop` refuses unless `--force` is passed.
- **Destroy**: `scout cloud rm builder` deletes the VM and its volume, revokes its `TrustedPeerRecord` in the local runtime and control plane, and ends all compute and storage charges.

### Cost structure and billing guardrails

Scout Cloud separates **infrastructure compute** from **LLM tokens**:

- **LLM tokens**: Billed directly by the user's existing provider credentials (`CLAUDE_CODE_OAUTH_TOKEN` against their Claude subscription, or `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` at vendor API rates), observed via Scout `usage` records and `scout providers`. Scout Cloud adds zero token markup.
- **Active compute (per-second billing while `running` or `waking`, 60-second minimum)**:
  - `cpu-2` (2 vCPU, 4 GB RAM): `$0.04/hr` (suited for standing Slack/GitHub triage agents)
  - `cpu-4` (4 vCPU, 8 GB RAM): `$0.08/hr` (default single-agent worker)
  - `cpu-8` (8 vCPU, 16 GB RAM): `$0.16/hr` (TypeScript/Rust monorepo worker)
  - `cpu-16` (16 vCPU, 32 GB RAM): `$0.32/hr` (heavy Rust/Docker/browser matrix builder)
  - `gpu-l4` (8 vCPU, 32 GB RAM, NVIDIA L4 24 GB VRAM): `$0.95/hr`
  - `gpu-a100` (16 vCPU, 64 GB RAM, A100 80 GB VRAM): `$2.60/hr`
- **Sleeping storage (billed per hour while `sleeping`)**: `$0.15/GB-month` (`~$6.00/month` or `$0.008/hr` for a 40 GB NVMe workspace). Destroyed machines (`scout cloud rm`) cost `$0`.
- **Included credits and hard caps**: Scout Platform plans include monthly cloud credit (for example `$15/month`, ~185 active hours of `cpu-4`). Additional usage draws from prepaid top-ups or metered billing bounded by a **hard monthly ceiling** and optional per-machine `--ttl <duration>` (for example `--ttl 4h` for burst workers). Reaching the spend cap suspends running cloud machines cleanly after sending a warning at 80% and 100%, rather than terminating disks or accruing surprise debt.

---

## 3. Architecture mapped onto the real modules

```text
  Operator Mac (or Peer)                             Hosted Platform (private)
┌──────────────────────────────────────┐          ┌──────────────────────────────────┐
│ packages/cli                         │  HTTPS   │ console.openscout.app /          │
│  ├─ commands/cloud.ts (new)          │─────────▶│ cloud.oscout.net                 │
│  ├─ commands/ask.ts (--on <host>)    │ osdist_* │  ├─ /v1/cloud/machines (CRUD)    │
│  └─ commands/auth.ts (RFC 8628)      │          │  ├─ Billing ledger & spend caps  │
│                                      │          │  ├─ Auto-sleep / wake scheduler  │
│ packages/runtime                     │          │  └─ CloudProviderDriver (Fly/..) │
│  ├─ broker-cloud-service.ts (new)    │          └────────────────┬─────────────────┘
│  ├─ broker-session-wake.ts           │                           │ Provider API
│  ├─ broker-mesh-forwarding-service   │                           ▼
│  └─ hub/seal.ts (X25519 + AES-GCM)   │          ┌──────────────────────────────────┐
│                                      │   Iroh   │ Cloud Linux / GPU MicroVM        │
│ packages/agent-sessions              │◀════════▶│  ├─ scout-cloud-guest bootstrap  │
│  └─ auth/{types,domains}.ts          │ mesh/1 + │  ├─ openscout-runtime broker     │
└──────────────────────────────────────┘ sealed   │  ├─ /run/user/1000/scout/secrets │
                                         secrets  │  └─ claude / codex / opencode /… │
                                                  └──────────────────────────────────┘
```

### Runtime installation and golden image

Each Scout Cloud VM boots from a version-pinned Ubuntu 24.04 LTS golden image (x86_64, plus CUDA 12 image for `gpu-*` sizes):

1. **Pre-baked toolchain**: Bun `>= 1.4.4`, Node 24, Git, GitHub CLI (`gh`), Python 3.12 + `uv`, Rust stable toolchain, `tmux`, `ripgrep`, and Chromium + `Xvfb` (so `scout browser` works on Linux through the `scout-native` CDP adapter).
2. **Pre-installed Scout and harnesses**: `@openscout/scout` installed globally under `/home/scout/.bun`, plus `@anthropic-ai/claude-code`, `@openai/codex`, `opencode`, `kimi`, and `pi`.
3. **Linux service supervision**: Per `install.md`, `crates/scoutd` is macOS-only today. On the cloud Linux image, the existing `linux-systemd-user` service adapter (`OPENSCOUT_SERVICE_ADAPTER=systemd-user` with `loginctl enable-linger scout`) supervises `openscout-runtime broker` via `~/.config/systemd/user/scout.service` with `OPENSCOUT_ADVERTISE_SCOPE=mesh`.
4. **Clean credential precedence**: As documented in `packages/agent-sessions/src/auth/domains.ts`, file-cached logins such as `~/.local/share/opencode/auth.json` and `~/.grok/auth.json` outrank environment variables. The golden image build script must assert that zero harness auth files exist in `/home/scout` before snapshotting.

### Cryptographic enrollment and peer trust

Scout Cloud reuses the signed node card and `TrustedPeerRecord` trust cone (`packages/runtime/src/mesh-trust-enrollment.ts`, `packages/protocol/src/mesh.ts`) without requiring interactive 6-word SAS confirmation or SSH access:

1. **Protocol addition (`packages/protocol/src/mesh.ts`)**: Extend `TrustedPeerGrantChannel` from `"sas" | "github" | "ssh"` to `"sas" | "github" | "ssh" | "cloud"`.
2. **Key generation stays inside the VM**: On first boot, `scout-cloud-guest` initializes `openscout-runtime`, which generates the VM's Ed25519 node identity keypair and self-signed TLS certificate on the VM's persistent volume. The VM's private key never transits `cloud.oscout.net`.
3. **Card exchange**:
   - In `POST /v1/cloud/machines`, the initiator CLI sends its own verified `SignedNodeCard` (`readMeshNodeTrust`) and a provisioning nonce.
   - `cloud.oscout.net` injects only that public `SignedNodeCard` and nonce into the VM's boot metadata.
   - On boot, the VM verifies the initiator's `SignedNodeCard` (`verifySignedNodeCard`) and installs a `control` grant for the operator's node (`installMeshGrantFromCard` with `grantedVia: "cloud"`).
   - The VM signs its own `SignedNodeCard` (including its `tls.spkiFingerprint` and X25519 secret-sealing public key) plus an Ed25519 signature over the provisioning nonce, and reports that public bundle to the control plane.
   - The initiator CLI verifies `verifySignedNodeCard(vmCard)` and the nonce signature, then writes the local `TrustedPeerRecord` into the local broker's `trusted_peers` store.
4. **Default asymmetric trust posture**: The cloud VM grants the operator's Mac `tier: "control"` so `scout ask --on <cloud-host>` can start sessions and worktrees there. By default, the operator's Mac grants the cloud VM `tier: "observe"` plus reply and operator-ask authority on conversations owned by the Mac, preventing a compromised cloud checkout from spawning unsolicited local shell sessions on the Mac unless `--trust control` is explicitly granted.

### Account authentication (`scout auth`)

- **Operator CLI to Scout Cloud API**: Reuses `packages/cli/src/cli/commands/auth.ts` and `packages/runtime/src/dist-access.ts`. `resolveDistKey` resolves `SCOUT_DIST_KEY` or the OS-stored credential (`OPENSCOUT_DIST_KEY` in macOS Keychain, `openscout-dist` in Linux Secret Service, or `<supportDirectory>/web/dist-key`). On `console.openscout.app`, the RFC 8628 device grant scopes tokens for both web bundle downloads (`/v1/dist/*`) and cloud lifecycle (`/v1/cloud/*`).
- **Cloud VM to Scout Cloud API**: The VM never receives the operator's `osdist_*` key. Instead, it receives a narrow machine bearer (`osvm_*`) valid only for its own `cloudMachineId` heartbeat, idle state report, and scoped mesh rendezvous presence (`OPENSCOUT_MESH_RENDEZVOUS_TOKEN` in `packages/runtime/src/mesh-rendezvous.ts`).

### Harness and git credentials (`@openscout/agent-sessions/auth`)

1. **Resolution on the operator's machine**: `scout cloud up` and `scout cloud secrets` use `CREDENTIAL_DOMAINS` and `HARNESS_AUTH_MODELS` (`packages/agent-sessions/src/auth/domains.ts`) plus a local `CredentialResolver` (`packages/agent-sessions/src/auth/types.ts`) reading process env and the operator's keychain (`secret` CLI / macOS Keychain). Only credentials marked `portable: true` (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `OPENCODE_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `CURSOR_API_KEY`) are eligible.
2. **End-to-end sealing**: Reusing the X25519 + HKDF-SHA256 + AES-256-GCM envelope from `packages/runtime/src/hub/seal.ts` (domain-separated with label `"openscout.cloud.secrets.v1"`), the CLI seals the selected `{ key, value }` map and optional scoped GitHub token to the VM's attested X25519 public key. Even when relayed through `POST /v1/cloud/machines/:id/secrets` during bootstrap, `cloud.oscout.net` sees only ciphertext.
3. **Injection and scrubbing inside the VM**: `scout-cloud-guest` opens the envelope into a mode-`0700` RAM-backed tmpfs directory (`/run/user/1000/scout/secrets`), never onto the persistent block device. Where a harness supports a credential helper (`apiKeyHelper` for Claude Code, `GIT_ASKPASS` for Git), Scout configures the helper to read from tmpfs on demand rather than exporting static `.env` files. `packages/runtime/src/secret-redaction-bootstrap.ts` automatically scrubs all `secret: true` keys from broker logs, `scout tail`, and diagnostics.

### Where the record lives and how it syncs

Scout Cloud preserves the core data-ownership rules in `AGENTS.md` and `docs/architecture.md`:

1. **Hosted control plane (`cloud.oscout.net`) owns infrastructure state**: VM ID (`cmach-*`), provider instance handle, region, size, persistent volume ID, power state (`provisioning`, `running`, `stopping`, `sleeping`, `error`, `terminated`), idle policy, and billing ledger.
2. **Protocol (`packages/protocol/src/machines.ts`) adds `CloudMachineEvidence`**:
   ```ts
   export interface CloudMachineEvidence extends MachineEvidenceBase {
     kind: "cloud";
     cloudMachineId: string;
     name: string;
     nodeId?: ScoutId;
     keyId?: string;
     size: string;
     region: string;
     powerState: "provisioning" | "running" | "stopping" | "sleeping" | "error";
     wakeable: boolean;
     idleTimeoutSeconds: number | null;
     repoRoots: string[];
     activeHourlyCents: number;
     sleepingHourlyCents: number;
   }
   ```
   `groupMachineEvidence` joins `CloudMachineEvidence` with `ScoutMachineEvidence` on `nodeId`, so `scout machines` and `scout hosts` show one merged machine record rather than duplicating a cloud peer.
3. **Local runtime (`packages/runtime/src/broker-cloud-service.ts`, new) owns local projection and wake coordination**:
   - The local runtime remains the sole writer of local Scout records. The CLI submits cloud mutations through the local broker (`POST /v1/cloud/machines`, `POST /v1/cloud/machines/:ref/stop`, `DELETE /v1/cloud/machines/:ref`), which coordinates the hosted API call and atomically updates `trusted_peers`, `NodeDefinition`, and the cached `CloudMachineEvidence` snapshot.
   - Sync is pull-on-demand plus event-driven: refreshed on `scout cloud`, `scout hosts`, `scout machines scan`, and whenever `resolveMeshHost` encounters a cloud node. No background polling loop hits `cloud.oscout.net` when the user has zero cloud machines.
4. **Wake-on-ask and remote worktrees (`packages/runtime/src/broker-session-wake.ts`, `broker-daemon.ts`)**:
   - In `resolveMeshHost`, if the matched trusted `NodeDefinition` is not currently reachable over Iroh/HTTPS, the broker checks `broker-cloud-service` for `wakeable: true` and `powerState === "sleeping"` (or `"stopping"`).
   - Instead of throwing `RetryablePreEffectFailure`, the broker accepts the invocation, sets `FlightRecord.state` to `"waking"`, calls `broker-cloud-service.wake(cloudMachineId)`, awaits peer readiness on `MESH_SESSION_START_PATH` (default wake budget 45s), and transitions the flight to `"running"`.
   - `MESH_SESSION_START_PATH` adds optional `workspace: "new_worktree"` and `gitCloneUrl` fields so parallel fan-out tasks on the same cloud host get isolated Scout worktrees under `/work/<repo>/.scout-worktrees/<slug>`, matching local worktree isolation.

### Relationship to Scout Hub, Iroh mesh, and the hosted gateway

- **Scout Hub vs Scout Cloud**: Hub is for *third-party cloud sandboxes Scout does not control* (Claude Code web, Managed Agents); it uses an untrusted sealed chunk inbox to mirror observed `.jsonl` transcripts into `<OPENSCOUT_HOME>/hub/`. Scout Cloud VMs do **not** use Hub's chunk inbox because they run a real `openscout-runtime` broker: coordination records sync over `BrokerMeshForwardingService` (`packages/runtime/src/broker-mesh-forwarding-service.ts`), and remote session search/tail queries the peer broker directly.
- **Mesh Rendezvous and Iroh (`mesh.oscout.net`, `openscout/mesh/1`)**: Cloud VMs announce signed presence (`OpenScoutMeshPresence`) to `https://mesh.oscout.net` (`packages/runtime/src/mesh-rendezvous.ts`) and dial peers over `OPENSCOUT_IROH_MESH_ALPN` (`packages/protocol/src/mesh.ts`). Because Iroh negotiates NAT-traversed QUIC with relay fallback and end-to-end Ed25519 peer authentication, **neither the user's Mac nor the cloud VM requires Tailscale, VPNs, or public inbound firewall rules**.
- **Hosted MCP Gateway (`mcp.oscout.net`, `scout mesh bridge`)**: Standing (`--keep-alive`) cloud machines can run `scout mesh bridge` using a mode-`0600` token file (`packages/cli/src/cli/commands/mesh-bridge.ts:154`). That lets remote MCP clients (Claude, ChatGPT, phone pairing over `wss://mesh.oscout.net/v1/relay`) reach your standing agents even when every personal Mac is powered off.

---

## 4. Managed fleet vs bring-your-own cloud account

### Managed fleet vs BYOC

| Dimension | Scout Managed Fleet (Scout owns infra, bills user) | BYOC (User connects AWS, GCP, Fly, or Hetzner API key) |
| --- | --- | --- |
| Time to first `scout ask --on` | ~10 seconds after `scout auth login` | 10 to 30 minutes (API keys, IAM permissions, quotas, regions) |
| Golden image & warm wake | Instant: pre-staged snapshots per region | Slow on first boot: must upload/build image in user account |
| Support surface | Uniform kernel, disk, network, and suspend behavior | Endless customer VPC, IAM, org-policy, and quota failures |
| Economics & business model | Direct Platform margin + sticky subscription credit | Must charge per-seat orchestration fee for user's own VMs |
| Abuse & billing liability | Scout owns fraud, egress, and crypto-mining prevention | User's cloud account bears compute risk |
| Data residency / cloud credits | Fixed Scout regions | Uses customer's existing AWS/GCP credits and VPCs |

**Free escape hatch already in Core**: Developers who want to bring a raw Linux server without managed lifecycle can already boot any VM, run `bun add -g @openscout/scout`, and run `scout mesh enroll ssh://user@host` at zero cost. BYOC in Scout Cloud only adds value when Scout automates provisioning, secret sealing, auto-sleep, and wake-on-ask inside the customer's cloud account.

### Substrate evaluation for Managed Fleet (and future BYOC drivers)

| Provider | Cold boot / Suspend-wake | Isolation & Linux fidelity | GPUs | Unit cost & ops notes |
| --- | --- | --- | --- | --- |
| **Fly.io (Fly Machines)** | ~1s start, ~1-3s wake from `suspend`/`stop` | Firecracker microVM + dedicated NVMe volume; full root Linux | L4, A100-40G, A100-80G (select regions) | Clean REST API, per-second billing, cheap stopped volumes (`$0.15/GB-mo`). Volumes pin to one physical host (requires periodic snapshot backup). |
| **Hetzner Cloud** | 15-25s cold boot; no instant suspend without billing (snapshot+delete takes ~45-90s) | Full KVM VM; native Docker and nested tooling work out of the box | Limited dedicated GPU SKUs | **3-5x cheaper CPU/RAM/NVMe** than hyperscalers. Best economics for heavy `cpu-16`/`cpu-32` builders and 24/7 standing boxes. |
| **Modal** | ~1-2s container start + memory snapshots | gVisor container sandbox, not a standard systemd KVM VM | Best-in-class L4, A10G, A100, H100 pool | Optimized for burst Python/GPU functions; awkward fit for persistent stateful devboxes and Docker-in-VM. |
| **E2B** | ~150ms Firecracker snapshot resume | Firecracker microVM | CPU-focused | Built for short ephemeral code-interpreter sandboxes; adds a third-party AI-sandbox margin on top of raw compute and fights multi-day persistent workstations. |
| **Daytona** | Fast container/VM workspace start | Devcontainer / sandbox orchestration | Limited | Overlaps directly with Scout's own runtime and workspace layer while adding external vendor lock-in and margin. |
| **AWS EC2 / GCP GCE** | 30-90s cold boot; EC2 Hibernate wake is 15-30s | Nitro / KVM; full fidelity | Full catalog (L4, A10G, A100, H100) | High engineering setup (VPC, AMI pipeline, NAT egress fees) and 3x CPU price vs Fly/Hetzner; valuable later as an enterprise BYOC target. |

### Recommendation

1. **Ship Scout Managed Fleet first** behind an internal `CloudProviderDriver` interface (`provision`, `wake`, `suspend`, `destroy`, `inspect`) in the private hosted service. Defer BYOC until Phase 3, where users with cloud credits or VPC requirements can connect Hetzner or AWS credentials (`scout cloud provider add hetzner|aws`).
2. **Use Fly Machines API as the MVP substrate** (`cpu-2` through `cpu-16` plus `gpu-l4`). Fly gives us Firecracker hardware isolation, dedicated volumes, 2-second wake-on-ask, and a single REST API with zero Kubernetes overhead so MVP ships in weeks.
3. **Add Hetzner Cloud as the second driver in Phase 2** for always-on standing boxes (`--keep-alive`) and heavy build machines (`cpu-16`, `cpu-32`) where 20-second start times do not matter and Hetzner's 4x lower compute cost dramatically improves gross margin, plus **Modal or GCP** if demand for H100 burst workers exceeds Fly's GPU inventory.

---

## 5. Security and trust

Scout's local posture assumes high-trust personal machines and explicitly avoids enterprise compliance claims (`AGENTS.md`). Running a **shared hosted fleet** adds one non-negotiable requirement on our side while keeping the user's own mesh model intact:

1. **Strict cross-customer hypervisor isolation**: Every Scout Cloud machine runs inside its own hardware-virtualized microVM (Firecracker on Fly, KVM on Hetzner) with its own kernel and block volume. Two customers never share a container runtime, OS kernel, filesystem, or mesh relay namespace.
2. **Host-blind (zero-knowledge) control plane**:
   - `cloud.oscout.net` orchestrates VM lifecycle and billing; it never holds the VM's Ed25519 node private key, never terminates Iroh `openscout/mesh/1` peer traffic, never stores harness API keys in plaintext, and never receives Scout conversation or journal records.
   - Local `trusted_peers` admission requires a valid `SignedNodeCard` verified on the operator's machine against the provisioning nonce from an explicit operator-initiated `scout cloud up`. A compromised control plane cannot push an unrequested peer into an operator's Mac.
3. **Asymmetric mesh authority by default**: A cloud VM running autonomous agents on third-party repositories or PR branches cannot spawn sessions on the operator's Mac unless the operator explicitly upgrades the local grant (`scout mesh grant <key-id> control`). It can only reply to flights dispatched to it, publish `scout show` / `scout post` artifacts on those tasks, and send `--operator` decision/permission requests.
4. **Scoped VM credentials and memory-only secrets**:
   - The VM holds only a per-machine `osvm_*` token; an agent inside the VM cannot provision more VMs, alter spend limits, or list sibling VMs.
   - Portable harness secrets live in mode-`0600` tmpfs (`/run/user/1000/scout/secrets`) and are scrubbed from outbound logs and tails via `secret-redaction-bootstrap.ts`.
   - **Suspend/hibernation nuance**: Firecracker `suspend` snapshots guest RAM to host storage on encrypted NVMe; `stop` shuts down guest RAM cleanly. By default, `auto-sleep` uses clean `stop` (waking in ~2-4s on Fly Machines without writing tmpfs secrets to a RAM snapshot) and re-hydrates secrets from a client-sealed envelope or operator re-push on wake.
5. **Managed-fleet abuse controls**:
   - Cloud provisioning requires a verified payment method (or redeemed Platform plan) and enforces account-level concurrency limits (for example, max 4 VMs and no GPUs on brand-new accounts until first billing cycle clears).
   - Outbound TCP port 25 (SMTP) is blocked at the network edge; sustained 100% unprompted network/CPU patterns without active harness processes trigger automated suspension to block crypto-mining and DDoS abuse.

---

## 6. Open source vs paid boundary

Scout Cloud follows every invariant in [docs/public-source-boundary.md](../public-source-boundary.md): one canonical source per component, zero private imports in `openscout-app/scout`, and full standalone usability of the open-source core.

| Component | Repository | License / Tier | Rationale |
| --- | --- | --- | --- |
| `CloudMachineEvidence`, `"cloud"` grant channel, `waking` & remote `--worktree` wire types | `openscout-app/scout` (`packages/protocol`) | Apache 2.0 (Free) | Shared protocol grammar across CLI, runtime, and third-party clients. |
| `broker-cloud-service.ts`, wake-on-ask in `broker-session-wake.ts`, X25519 secret sealing, `CredentialResolver` | `openscout-app/scout` (`packages/runtime`, `packages/agent-sessions`) | Apache 2.0 (Free) | Local runtime remains the single canonical writer of local Scout records; transparent security primitives (auditable client-side sealing). |
| `scout cloud` CLI verbs and `scout ask --on` workspace inference | `openscout-app/scout` (`packages/cli`) | Apache 2.0 (Free) | Ships in `@openscout/scout` so every terminal install and agent harness has the client out of the box. |
| Manual self-hosted Linux peers (`scout mesh enroll ssh://...`) | `openscout-app/scout` | Apache 2.0 (Free) | Existing DIY multi-machine mesh stays free and complete without a Scout account. |
| Scout Cloud Control Plane (`/v1/cloud/*`, `CloudProviderDriver` for Fly/Hetzner, warm pool, auto-sleep reaper, billing, abuse engine) | Private (`arach/openscout`) | Paid Platform | Hosted infrastructure, fleet orchestration, and metered billing. |
| Golden VM image pipeline & warm snapshot distribution | Private (`arach/openscout`) | Paid Platform | Operational fleet build and vulnerability patching pipeline. |
| Managed Relay & MCP Gateway (`mesh.oscout.net`, `mcp.oscout.net`, mobile push) | Private (`arach/openscout`) | Paid Platform (free baseline tier for pairing) | Hosted connectivity for 24/7 standing cloud agents and offline-Mac mobile control. |
| Mac, iOS, Android, and Web Cloud UI (1-click Cloud toggle, live burn badge, remote browser viewer) | Private (`arach/openscout`) | Paid Apps / Platform | App surfaces sit above Core APIs (`docs/public-source-boundary.md`). |
| Team pools & managed BYOC connectors (Phase 3) | Private (`arach/openscout`) | Paid Team / Pro tier | Multi-seat cloud budgets and automated lifecycle in customer AWS/Hetzner accounts. |

---

## 7. Phased roadmap and non-goals

### MVP (ships in 3 weeks)

Goal: `scout auth login`, `scout cloud up`, `scout ask --on <cloud-host>`, auto-sleep, wake-on-ask, and hard spend caps on Fly Machines.

- **Week 1: Core protocol seams and golden Linux image**
  - Add `"cloud"` to `TrustedPeerGrantChannel` (`packages/protocol/src/mesh.ts`) and `CloudMachineEvidence` to `packages/protocol/src/machines.ts`.
  - Add `workspace: "new_worktree"` and optional `gitCloneUrl` handling to `MESH_SESSION_START_PATH` (`packages/runtime/src/broker-session-wake.ts`).
  - Build the Ubuntu 24.04 golden image on Fly Machines (`cpu-2`, `cpu-4`, `cpu-8`, `cpu-16`) with `systemd` user broker, Iroh entrypoint, Claude Code, Codex, OpenCode, and `scout-cloud-guest`.
- **Week 2: Hosted control plane, cryptographic enrollment, and sealed secrets**
  - Implement `/v1/cloud/machines` (`POST`, `GET`, `POST .../wake`, `POST .../stop`, `DELETE`, `POST .../secrets`) in the private hosted service backed by the `FlyCloudProviderDriver`, usage ledger, and Stripe prepaid/capped billing.
  - Implement `broker-cloud-service.ts` in `packages/runtime` and `packages/cli/src/cli/commands/cloud.ts` (`up`, `ls`, `stop`, `rm`, `secrets`, `logs`), including `CREDENTIAL_DOMAINS` portable key resolution and X25519 envelope sealing.
- **Week 3: Wake-on-ask, auto-sleep reaper, and acceptance verification**
  - Wire `FlightState = "waking"` in `broker-session-wake.ts` when `--on <host>` targets a sleeping cloud node, plus repo-root inference when `--project` is omitted.
  - Ship the 30-minute idle reaper (zero active flights + zero active harness turns -> clean Fly Machine stop) and 80%/100% spend-cap enforcement.

#### MVP acceptance criteria

1. **Cold provision**: Given a signed-in user with `$10` credit and `OPENAI_API_KEY` set locally, running `scout cloud up builder --repo openscout-app/scout --harness codex` returns `ready` in under 15 seconds, records `builder` in `scout hosts` and `scout mesh peers` (`grantedVia: "cloud"`), and stores zero plaintext secrets on `cloud.oscout.net`.
2. **Task dispatch and worktree isolation**: Running two concurrent `scout ask --on builder --harness codex ...` commands from a laptop creates isolated sessions on `builder`, streams status to `scout check --machine builder`, and returns completed flight receipts.
3. **Auto-sleep and wake-on-ask**: After 30 minutes with zero active flights, `scout cloud ls` reports `builder` in state `sleeping` with `$0.00/hr` compute burn. A subsequent `scout ask --on builder ...` places the flight in `waking`, resumes `builder` within 10 seconds, and completes the flight without manual intervention.
4. **Spend cap enforcement**: When an account hits 100% of its configured monthly spend ceiling, the control plane stops running cloud machines cleanly, preserves their persistent volumes, and refuses new `up` or `wake` calls with an actionable budget message until the cap is raised.

### Phase 2 (Weeks 4–8): Pools, GPUs, standing agents, and Apps UI

- **GPU and heavy-CPU SKUs**: Enable `gpu-l4` and `gpu-a100` on Fly/Modal and add the `HetznerCloudProviderDriver` for low-cost `cpu-16`/`cpu-32` builders and `--keep-alive` standing machines.
- **Ephemeral worker pools in Crew**: Allow `crew.json` Worker Pool slots (`scout crew`) to bind to `cloud:ephemeral` (`--ttl 2h`), automatically spinning up and tearing down *N* isolated cloud workers for large parallel sweeps.
- **Offline-Mac autonomy**: Pre-wire `scout mesh bridge` on `--keep-alive` cloud machines so paired iOS devices, Web, and Slack/GitHub integrations can wake and steer cloud agents while all personal Macs are offline.
- **Linux Scout Computer (`scout browser`)**: Wire remote `scout browser` snapshots and `scout show` visual artifacts from the cloud VM's virtual-display Chrome back to the Mac and Web canvas.

### Phase 3 (Months 3+): BYOC, team pools, and machine forking

- **BYOC provider drivers**: `scout cloud provider add hetzner|fly|aws` so teams with cloud credits or VPC mandates can run Scout's golden images and wake-on-ask scheduler inside their own cloud accounts.
- **Team cloud pools**: Shared team cloud machines governed by signed `scout mesh access` policies (`packages/cli/src/cli/commands/mesh-access.ts`).
- **Snapshot forking**: `scout cloud fork builder builder-exp` (copy-on-write volume + session state clone) to test two architectural directions in parallel from a warm build cache.

### Explicit non-goals

1. **Not production app hosting**: Scout Cloud will not host public customer websites, production databases, custom TLS domains, or load-balanced HTTP ingress.
2. **Not a browser IDE**: Scout Cloud will not ship or maintain a hosted VS Code fork. Users stay in their local terminal, editor, TUI, Mac app, or phone.
3. **Not an LLM token proxy in MVP**: Scout Cloud will not intermediate model API calls or mark up token spend; harnesses talk directly to Anthropic, OpenAI, xAI, Google, or Moonshot using the user's portable credentials.
4. **Not background two-way file sync**: Source code moves through Git remotes, commits, branches, and Scout diffs/attachments, never through fragile background `rsync` or Mutagen daemons fighting live agent edits.
5. **Not cloud macOS VMs in v1**: Apple's macOS virtualization license mandates 24-hour minimum dedicated-host leases on Apple silicon hardware, breaking per-second burst economics; local Macs handle macOS/Xcode work while Scout Cloud handles Linux and GPUs.
6. **Not enterprise compliance or untrusted intra-team multi-tenancy**: Consistent with `AGENTS.md`, v1 does not claim SOC 2, HIPAA, or hostile multi-user isolation *inside* a single workspace's VM.

---

## 8. Open decisions for Art

### Decision 1: CLI verb placement

Where should cloud machine lifecycle commands live in `packages/cli/src/cli/registry.ts`?

- **Option A: First-class `scout cloud` command** (`scout cloud up|ls|stop|rm|secrets|logs`), while `scout hosts` and `scout machines` automatically display cloud machines alongside local ones.
- **Option B: Subcommands under `scout machines`** (`scout machines up`, `scout machines stop`, `scout machines rm`).
- **Option C: Separate CLI extension** (`scout-cloud` binary installed via `scout extensions install`).
- **Recommendation: Option A.** `scout machines` has a clean, read-only passive-sighting contract today (`packages/protocol/src/machines.ts`), while Platform capabilities (`hub`, `browser`, `computer`, `auth`) each own one crisp top-level verb in `registry.ts`. Shipping `scout cloud` built-in avoids extension-install friction on first run.

### Decision 2: First-ask ergonomics when no cloud machine exists yet

What should happen if a signed-in user runs `scout ask --on cloud "run the tests"` before ever running `scout cloud up`?

- **Option A: Explicit `scout cloud up` required first.** `scout ask --on cloud` fails fast with a one-line instruction: `No machine named "cloud". Create one in ~10s: scout cloud up`.
- **Option B: Reserved `cloud` alias auto-provisions on first ask** (confirming once if interactive TTY, or proceeding when `--yes` / default cloud policy is enabled), booting a default `cpu-4` box cloned to the current repo during `FlightState = "waking"`.
- **Option C: Auto-provision any unknown `--on <name>`** as a new cloud machine.
- **Recommendation: Option A in Week 1, with Option B for the single reserved name `cloud` behind a one-time confirmation.** Never do Option C, because a typo like `scout ask --on archei` (meaning local `archie`) must fail fast rather than silently billing a new VM. Allowing `--on cloud` to offer one-keystroke creation makes the zero-to-one demo effortless while keeping named hosts typo-safe.

### Decision 3: Default mesh trust direction between the user's Mac and a Cloud VM

What peer trust tier (`TrustedPeerTier` in `packages/protocol/src/mesh.ts`) should `scout cloud up` install on the operator's Mac for the new cloud VM?

- **Option A: Asymmetric default (`control` on Cloud VM, `observe` + reply/operator-ask on Mac).** Your Mac can start any session on the cloud VM, and the cloud VM can reply to tasks and raise `--operator` decision/permission cards, but the cloud VM cannot spawn unprompted shell sessions on your Mac unless you pass `--trust control`.
- **Option B: Symmetric `control` on both sides** (matching `scout mesh enroll ssh://host` today), so a cloud orchestrator can freely run `scout ask --on <your-mac>` to delegate macOS/Xcode tasks back to your laptop.
- **Recommendation: Option A as default, with `--trust control` (Option B) as an explicit flag on `scout cloud up`.** Cloud VMs frequently clone third-party PRs and run autonomous loops with broad Linux permissions; preventing lateral session-spawn back onto the operator's Mac by default is a strong, zero-friction safety boundary.

### Decision 4: Secret survival across sleep/wake when the operator's Mac is offline

If secrets live only in guest RAM tmpfs (`/run/user/1000/scout/secrets`) and `auto-sleep` cleanly stops the VM, how do secrets return when the VM wakes?

- **Option A: Operator re-seal on wake (MVP) + sealed-at-rest envelope unlocked on wake (Phase 2).** When a Mac wakes the VM, the Mac re-pushes the X25519-sealed secret bundle automatically; for phone/webhook wakes when the Mac is asleep, the VM stores an AES-256-GCM encrypted secret blob on its persistent volume whose decryption share is held in RAM by the runtime's mesh-bridge/control-plane lease (so neither the raw disk snapshot alone nor the control plane alone can decrypt it).
- **Option B: Store secrets in a mode-`0600` file on the VM's encrypted persistent volume**, relying on cloud provider disk encryption.
- **Option C: Hosted secret vault on `console.openscout.app`** where the user enters API keys in the browser and the control plane injects them on every boot.
- **Recommendation: Option A.** It keeps `console.openscout.app` strictly zero-knowledge (avoiding the high-value breach target of Option C) and avoids leaving raw API keys on persistent agent filesystems where an agent or build script might accidentally tar/upload `$HOME` (Option B).

### Decision 5: Billing model at launch

How should Scout Cloud charge early Platform users?

- **Option A: Included monthly credit in Scout Pro/Platform (e.g. `$15/mo`) + prepaid wallet / auto-top-up with a mandatory hard monthly spend cap.**
- **Option B: Pure postpaid metered Stripe billing** at month end with optional alerts.
- **Option C: Flat monthly machine plans** (for example `$25/mo` for one `cpu-4` slot, `$49/mo` for `cpu-8`).
- **Recommendation: Option A.** Developers fear uncapped postpaid meters when autonomous agents loop overnight (Option B), while flat-rate slots (Option C) either lose money on 24/7 heavy builders or overcharge burst users. Included credit makes the first 150+ hours of `cpu-4` feel free for existing subscribers, and a hard spend cap builds immediate trust.

### Decision 6: Initial compute substrate

Which infrastructure provider should back the Managed Fleet MVP?

- **Option A: Fly Machines API** for MVP (`cpu-2`..`cpu-16` + `gpu-l4`), adding **Hetzner Cloud** behind `CloudProviderDriver` in Phase 2 for cheap high-core builders and 24/7 standing boxes.
- **Option B: Hetzner Cloud first**, accepting 20-second cold boots and snapshot-based sleep in exchange for 4x lower raw compute cost from day one.
- **Option C: E2B or Daytona** as a managed sandbox vendor.
- **Recommendation: Option A.** Wake-on-ask latency determines whether `scout ask --on cloud` feels magical (2 seconds on Fly) or sluggish (45+ seconds from a cold Hetzner snapshot), and writing a ~400-line `FlyCloudProviderDriver` directly avoids ceding margin and lifecycle control to a sandbox middleman (Option C).
