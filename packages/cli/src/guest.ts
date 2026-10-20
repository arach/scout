import { createHash, createPublicKey } from "node:crypto";
import { resolveBrokerControlUrl } from "@openscout/runtime/local-config";
import { verifySignedNodeCard, type SignedNodeCard } from "@openscout/runtime/mesh/node-identity";

export const GUEST_HELP = `scout guest — approve external assistants on the local runtime

  scout guest list [--json]
  scout guest targets [--json]
  scout guest approve --public-key <base64-SPKI> --label <name> --allow <exact-agent-id>
    --expires-at <ISO-time> --request-id <stable-id> [--yes] [--json]
  scout guest revoke <grant-id> --key-id <full-fingerprint> [--yes] [--json]

Run on the destination machine. Only the local runtime is required: no macOS app,
public profile, hosted gateway, or GitHub login. Uses OPENSCOUT_BROKER_URL or local
runtime configuration; remote URLs and redirects are refused.

Approve and revoke preview their exact scope unless --yes is supplied. Repeat
--allow for multiple exact agent IDs. Expiry must be an absolute time within 30
days. Reuse the same request ID and expiry after an uncertain approval response.
Approval never replaces existing access: review and revoke an obsolete grant
explicitly, checking its key ID against the assistant's public key first.

Output is JSON. Approval includes the stored grant, bootstrap, allowed_targets
and expires_at for scout-tailscale connect --bootstrap <file>. Importing that
response requires the independently verified node key. Approval does not prove
connectivity or a completed reply. Keep existing assistant keys, pins and proxy.
`;

type Grant = { id: string; requestId: string; keyId: string; label: string;
  allowedTargets: string[]; expiresAt: number; status: string };
type Approval = { requestId: string; clientPublicKey: string; label: string; allowedTargets: string[]; expiresAt: number };
type Options = { command: string; yes: boolean; id?: string; keyId?: string; approval?: Approval };

export function guestPublicKey(value: string): { publicKey: string; keyId: string } {
  try {
    if (value.length > 200) throw new Error();
    const input = Buffer.from(value, "base64");
    const key = createPublicKey({ key: input, format: "der", type: "spki" });
    const der = key.export({ format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519" || !der.equals(input)) throw new Error();
    return { publicKey: der.toString("base64"), keyId: createHash("sha256").update(der).digest("hex") };
  } catch { throw new Error("--public-key must be an Ed25519 public key in base64 SPKI format; never supply a private key."); }
}

export function parseGuestArgs(args: string[], now = Date.now()): Options {
  args = args.filter(arg => arg !== "--json");
  const command = args[0] ?? "list";
  if (!["list", "targets", "approve", "revoke"].includes(command)) throw new Error(`Unknown guest command: ${command}`);
  const options: Options = { command, yes: false };
  const values = new Map<string, string>(); const targets: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--json") continue;
    if (flag === "--yes") { options.yes = true; continue; }
    if (command === "revoke" && !flag.startsWith("-") && !options.id) { options.id = flag; continue; }
    const permitted = command === "approve" ? ["--public-key", "--label", "--allow", "--expires-at", "--request-id"]
      : command === "revoke" ? ["--key-id"] : [];
    if (!permitted.includes(flag)) throw new Error(`Unexpected guest ${command} argument: ${flag}`);
    const value = args[++i]?.trim();
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--allow") targets.push(value);
    else {
      if (values.has(flag)) throw new Error(`${flag} may only be supplied once`);
      values.set(flag, value);
    }
  }
  if (["list", "targets"].includes(command) && options.yes) throw new Error("--yes only applies to approve or revoke");
  if (command === "revoke") {
    if (!options.id || !/^gg_[A-Za-z0-9-]+$/.test(options.id)) throw new Error("revoke requires an exact grant ID from scout guest list");
    options.keyId = values.get("--key-id");
    if (!/^[a-f0-9]{64}$/.test(options.keyId ?? "")) throw new Error("revoke requires --key-id with the assistant's full SHA-256 fingerprint");
  }
  if (command === "approve") {
    const { publicKey, keyId } = guestPublicKey(values.get("--public-key") ?? "");
    options.keyId = keyId;
    const requestId = values.get("--request-id") ?? ""; const label = values.get("--label") ?? "";
    const expiry = values.get("--expires-at") ?? ""; const expiresAt = Date.parse(expiry);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(requestId)) throw new Error("--request-id must be 1-80 letters, digits or dashes; reuse it on retries");
    if (!label || label.length > 80) throw new Error("--label must be 1-80 characters");
    if (!targets.length || targets.length > 50 || targets.some(t => !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(t))) throw new Error("--allow must list 1-50 exact agent IDs; no wildcards or selectors");
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiry) || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 30 * 86400_000) throw new Error("--expires-at must be an absolute ISO time with timezone, in the future and within 30 days");
    options.approval = { requestId, clientPublicKey: publicKey, label, allowedTargets: [...new Set(targets)].sort(), expiresAt };
  }
  return options;
}

export function guestLocalUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Guest approval must use a literal loopback runtime URL (127.0.0.1 or ::1), without credentials, path, query or fragment. Run it on the destination machine.");
  }
  return url;
}

function isGrant(value: unknown): value is Grant {
  if (!value || typeof value !== "object") return false;
  const g = value as Grant;
  return typeof g.id === "string" && typeof g.requestId === "string" && typeof g.keyId === "string"
    && typeof g.label === "string" && Array.isArray(g.allowedTargets) && g.allowedTargets.every(t => typeof t === "string")
    && Number.isFinite(g.expiresAt) && typeof g.status === "string";
}

function matches(grant: Grant, approval: Approval, keyId: string): boolean {
  return grant.requestId === approval.requestId && grant.keyId === keyId && grant.label === approval.label
    && JSON.stringify([...grant.allowedTargets].sort()) === JSON.stringify(approval.allowedTargets)
    && grant.expiresAt === approval.expiresAt && grant.status === "active";
}

function validBootstrap(bootstrap: any, grantId: string): boolean {
  try {
    const card = bootstrap?.card;
    return bootstrap?.protocol === "scout-guest/1" && bootstrap.grantId === grantId
      && typeof bootstrap.nodeId === "string" && bootstrap.nodeId.length > 0
      && /^[a-f0-9]{64}$/.test(bootstrap.nodeKeyId)
      && card?.nodeId === bootstrap.nodeId && card.keyId === bootstrap.nodeKeyId
      && typeof card.publicKey === "string" && typeof card.signature === "string"
      && typeof card.label === "string" && typeof card.version === "string" && typeof card.nonce === "string"
      && Number.isFinite(card.issuedAt) && Array.isArray(card.capabilities) && card.capabilities.every((x: unknown) => typeof x === "string")
      && Array.isArray(card.endpoints) && card.endpoints.length > 0 && card.endpoints.every((x: unknown) => typeof x === "string")
      && /^[a-f0-9]{64}$/.test(card.tls?.spkiFingerprint ?? "")
      && card.endpoints.some((endpoint: string) => {
        try { const url = new URL(endpoint); return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password; }
        catch { return false; }
      })
      && verifySignedNodeCard(card as SignedNodeCard);
  } catch { return false; }
}

export async function runGuestCommand(args: string[], context: {
  env?: NodeJS.ProcessEnv; stdout?: (text: string) => void;
} = {}): Promise<void> {
  const print = context.stdout ?? (text => process.stdout.write(text + "\n"));
  if (args[0] === "help" || args.some(a => a === "--help" || a === "-h")) { print(GUEST_HELP); return; }
  const options = parseGuestArgs(args);
  const env = context.env ?? process.env;
  const base = guestLocalUrl(env.OPENSCOUT_BROKER_URL?.trim() || resolveBrokerControlUrl());
  async function request(path: string, body?: unknown): Promise<any> {
    const response = await fetch(new URL(path, base), { method: body === undefined ? "GET" : "POST",
      redirect: "error", headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Local runtime refused guest operation (HTTP ${response.status}): ${(await response.text()).slice(0, 500)}`);
    return response.json();
  }
  async function targets() {
    const node = await request("/v1/node");
    const snapshot = await request("/v1/snapshot?scope=agents");
    if (typeof node?.id !== "string" || !node.id || !snapshot?.agents || Array.isArray(snapshot.agents)
      || typeof snapshot.agents !== "object") throw new Error("Runtime returned invalid guest target discovery");
    // Match the guest API's authority filter. General `who` also includes
    // observed session IDs and configured aliases that are not guest targets.
    const agents = Object.values(snapshot.agents).filter((agent: any) => agent?.authorityNodeId === node.id);
    if (agents.some((agent: any) => typeof agent.id !== "string" || !agent.id || typeof agent.displayName !== "string")) {
      throw new Error("Runtime returned invalid guest target discovery");
    }
    return { nodeId: node.id, targets: agents.map((agent: any) => ({ id: agent.id, displayName: agent.displayName })) };
  }
  if (options.command === "targets") {
    print(JSON.stringify({ broker: base.href, ...await targets(), verification: "Registered targets only; verify a completed reply after approval." }, null, 2)); return;
  }
  const inventory = await request("/v1/guest-grants");
  if (!Array.isArray(inventory?.grants) || !inventory.grants.every(isGrant)) throw new Error("Runtime returned an invalid guest inventory");
  const grants: Grant[] = inventory.grants;
  if (options.command === "list") { print(JSON.stringify({ broker: base.href, grants }, null, 2)); return; }
  if (options.command === "revoke") {
    const grant = grants.find(g => g.id === options.id);
    if (!grant || grant.keyId !== options.keyId) throw new Error("Grant is missing or its assistant key does not match. Nothing was changed.");
    if (!options.yes) { print(JSON.stringify({ action: "revoke", preview: true, broker: base.href, grant, next: "Repeat this exact command with --yes to revoke this grant only." }, null, 2)); return; }
    // IDs and key bindings are immutable; never resolve a label into a grant.
    const result = await request("/v1/guest-grants/revoke", { grantId: grant.id });
    if (result?.ok !== true || !isGrant(result.grant) || result.grant.id !== grant.id || result.grant.keyId !== options.keyId || result.grant.status !== "revoked") throw new Error("Revocation response was not confirmed. Inspect scout guest list before retrying this same grant ID.");
    print(JSON.stringify({ action: "revoked", broker: base.href, grant: result.grant }, null, 2)); return;
  }
  const approval = options.approval!;
  const existing = grants.find(g => g.requestId === approval.requestId);
  if (existing && !matches(existing, approval, options.keyId!)) throw new Error("This request ID already has different or inactive access, including its expiry. Review it; do not reuse the ID for a new decision.");
  const conflict = grants.find(g => g.status === "active" && g.keyId === options.keyId && g.requestId !== approval.requestId);
  // A retry must still retrieve an already-approved handoff if its target has
  // since gone offline. New decisions must select registered local targets.
  if (!existing) {
    const discovery = await targets();
    const unavailable = approval.allowedTargets.filter(id => !discovery.targets.some(agent => agent.id === id));
    if (unavailable.length) throw new Error(`Targets are not registered for guest access on ${discovery.nodeId}: ${unavailable.join(", ")}. Run scout guest targets; nothing was changed.`);
  }
  if (!options.yes) {
    print(JSON.stringify({ action: "approve", preview: true, broker: base.href, keyId: options.keyId, ...approval,
      expires_at: new Date(approval.expiresAt).toISOString(), conflictingGrant: conflict ?? null,
      next: conflict ? "Existing access remains unchanged. Review and explicitly revoke the matching old grant before approving new access." : "Repeat this exact command with --yes to approve." }, null, 2)); return;
  }
  if (conflict) throw new Error(`This key already has active grant ${conflict.id}. Approval never revokes or replaces it; review existing access first.`);
  let result: any;
  try { result = await request("/v1/guest-grants", approval); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\nApproval may have succeeded. Retry the same --request-id ${approval.requestId} and absolute expiry; do not mint another request ID.`); }
  if (!isGrant(result?.grant) || !matches(result.grant, approval, options.keyId!)) throw new Error("Approval response did not match the reviewed key, scope and expiry. Inspect scout guest list; do not create another grant.");
  if (!validBootstrap(result.bootstrap, result.grant.id)) throw new Error(`Local approval may exist, but the bootstrap is missing, mismatched or invalid. Retry the same --request-id ${approval.requestId} and absolute expiry to retrieve its handoff; do not create another grant.`);
  print(JSON.stringify({ action: "approved", broker: base.href, grant: result.grant, bootstrap: result.bootstrap,
    allowed_targets: result.grant.allowedTargets, expires_at: new Date(result.grant.expiresAt).toISOString(),
    verification: "Pending: import in the assistant, verify its signed connection, then obtain a completed agent reply." }, null, 2));
}
