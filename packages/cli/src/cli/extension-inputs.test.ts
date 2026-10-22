import { afterAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findScoutExtension } from "./extensions.ts";
import { mutateScoutExtension } from "./extension-install.ts";
import { assertScoutExtensionInputGrant, grantScoutExtensionInput, listScoutExtensionInputGrants, revokeScoutExtensionInputGrant,
  scoutExtensionGrantStore, scoutExtensionInputBinding, scoutExtensionDeclarationDigest, type ExtensionInputBinding } from "./extension-input-grants.ts";
const root = mkdtempSync(join(import.meta.dir, "../../node_modules/.extension-inputs-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const declaration = { context: "scout.extension-context/v1", requires: ["selection/v1", "distribution.endpoint/v1"], inputSchema: "scout.extension-inputs/v1",
  credentialInputs: [{ id: "distribution-key", source: { kind: "environment", name: "SCOUT_DIST_KEY" }, presence: "optional", destination: "distribution", purpose: "Authenticate an explicitly requested fixture download" }],
  destinations: [{ id: "distribution", defaultUrl: "https://downloads.example.test/base/", overrideProjection: "distribution.endpoint/v1" }] };
let count = 0;
function fixture(invocation: unknown = declaration) {
  const base = join(root, `f${++count}`), source = join(base, "artifact"), home = join(base, "home"); mkdirSync(source, { recursive: true }); mkdirSync(home);
  writeFileSync(join(source, "extension.json"), JSON.stringify({ api: 2, command: "run", version: "1.0.0", invocation }));
  writeFileSync(join(source, "run"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: process.env.PATH, OPENSCOUT_INSTANCE: "prod", SCOUT_HOME: join(home, "scout"),
    OPENSCOUT_EXTENSIONS_HOME: join(base, "extensions"), SCOUT_DIST_KEY: "synthetic-credential-never-serialize", FORCE_COLOR: "3" };
  mutateScoutExtension("install", "input-fixture", source, env);
  const selection = { uid: process.getuid!(), home, instance: "prod", instanceRoot: null, scoutHome: env.SCOUT_HOME!, endpoint: env.OPENSCOUT_DIST_URL };
  const binding = () => scoutExtensionInputBinding(findScoutExtension("input-fixture", env)!, env, selection);
  return { base, source, home, env, selection, binding };
}
async function cli(f: ReturnType<typeof fixture>, args: string[]) {
  const child = spawn(process.execPath, [join(import.meta.dir, "main.ts"), "--json", "extensions", "permissions", ...args], { env: f.env, cwd: f.base, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { const code = await new Promise<number | null>(done => child.once("close", done)); return { code, stdout, stderr }; } finally { clearTimeout(timer); }
}
function refused(result: { code: number | null; stdout: string; stderr: string }, reason: string) {
  expect(result.code).toBe(69); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain("\x1b");
  expect(JSON.parse(result.stderr)).toMatchObject({ schema: "scout.cli.command-unavailable/v1", reason }); expect(result.stderr).not.toContain("synthetic-credential");
}
function grantArgs(binding: ExtensionInputBinding) { return ["grant", "input-fixture", "--tree-digest", binding.treeDigest, "--declaration-digest", binding.declarationDigest,
  "--input", "distribution-key", "--destination", binding.destination.origin + binding.destination.basePath, "--acknowledge-unknown-origin"]; }

test("credential declarations negotiate closed schemas, source and destinations without executing a candidate", () => {
  const good = fixture(); expect(findScoutExtension("input-fixture", good.env)?.invocation?.inputSchema).toBe("scout.extension-inputs/v1");
  const cases = [ { ...declaration, inputSchema: "unknown/v1" }, { ...declaration, requires: ["selection/v1"] },
    { ...declaration, credentialInputs: [{ ...declaration.credentialInputs[0], source: { kind: "file", name: "SCOUT_DIST_KEY" } }] },
    { ...declaration, credentialInputs: [{ ...declaration.credentialInputs[0], source: { kind: "environment", name: "OTHER_SECRET" } }] },
    { ...declaration, destinations: [{ ...declaration.destinations[0], defaultUrl: "https://user:password@example.test" }] },
    { ...declaration, credentialInputs: [declaration.credentialInputs[0], declaration.credentialInputs[0]] },
    { ...declaration, credentialInputs: [{ ...declaration.credentialInputs[0], purpose: "bad\npurpose" }] }, { ...declaration, unexpected: "value" } ];
  for (const invocation of cases) {
    const f = fixture(); writeFileSync(join(f.env.OPENSCOUT_EXTENSIONS_HOME!, "input-fixture", "extension.json"), JSON.stringify({ api: 2, command: "run", invocation }));
    expect(findScoutExtension("input-fixture", f.env)?.refusalReason).toBe("incompatible");
    expect(() => mutateScoutExtension("update", "input-fixture", f.source, f.env)).not.toThrow();
  }
});
test("explicit grants bind every identity axis independently, and declaration changes never inherit authority", () => {
  const f = fixture(), binding = f.binding(); expect(listScoutExtensionInputGrants(f.env).grants).toEqual([]);
  expect(() => assertScoutExtensionInputGrant(f.env, binding)).toThrow("input_not_authorized");
  const grant = grantScoutExtensionInput(f.env, binding); expect(() => assertScoutExtensionInputGrant(f.env, binding)).not.toThrow();
  const changes: Partial<ExtensionInputBinding>[] = [{ uid: binding.uid + 1 }, { instance: "other" }, { home: "/other-home" }, { instanceRoot: "/other-root" },
    { extensionRoot: { ...binding.extensionRoot, inode: String(BigInt(binding.extensionRoot.inode) + 1n) } }, { verb: "other" },
    { treeDigest: "sha256:scout-extension-tree-v1:" + "b".repeat(64) }, { declarationDigest: "sha256:scout-extension-declaration-v1:" + "c".repeat(64) },
    { destination: { ...binding.destination, origin: "https://other.example.test" } }, { destination: { ...binding.destination, basePath: "/other" } }];
  for (const change of changes) expect(() => assertScoutExtensionInputGrant(f.env, { ...binding, ...change })).toThrow("input_not_authorized");
  expect(scoutExtensionDeclarationDigest({ ...findScoutExtension("input-fixture", f.env)!.invocation!, requires: ["selection/v1"] })).not.toBe(binding.declarationDigest);
  expect(revokeScoutExtensionInputGrant(f.env, grant.id).revoked).toBe(true); expect(() => assertScoutExtensionInputGrant(f.env, binding)).toThrow("input_not_authorized");
  const policy = listScoutExtensionInputGrants(f.env); expect(policy.audit.map(item => item.event)).toEqual(["grant", "revoke"]); expect(policy.revision).toBe(2);
  expect(readFileSync(scoutExtensionGrantStore(f.env), "utf8")).not.toContain(f.env.SCOUT_DIST_KEY!);
});
test("policy refuses corruption, unsafe modes, symlinks and busy locks; atomic mutations retain audit", () => {
  for (const mode of ["corrupt", "permissions", "symlink", "busy", "audit"] as const) {
    const f = fixture(); grantScoutExtensionInput(f.env, f.binding()); const path = scoutExtensionGrantStore(f.env);
    if (mode === "corrupt") writeFileSync(path, "{broken");
    if (mode === "audit") { const policy = JSON.parse(readFileSync(path, "utf8")); policy.grants = []; writeFileSync(path, JSON.stringify(policy)); }
    if (mode === "permissions") chmodSync(path, 0o620);
    if (mode === "symlink") { const moved = join(f.base, "other-policy"); writeFileSync(moved, readFileSync(path), { mode: 0o600 }); rmSync(path); symlinkSync(moved, path); }
    if (mode === "busy") mkdirSync(join(dirname(path), ".lock"), { mode: 0o700 });
    expect(() => listScoutExtensionInputGrants(f.env)).toThrow(mode === "busy" ? "input_policy_busy" : "input_policy_invalid");
  }
  const f = fixture(); f.env.SCOUT_HOME = join(f.env.OPENSCOUT_EXTENSIONS_HOME!, "input-fixture");
  expect(() => grantScoutExtensionInput(f.env, f.binding())).toThrow("input_policy_invalid");
});
test("management uses names and pinned digests only; install/update never issue grants and continuity refuses", async () => {
  const f = fixture(), binding = f.binding();
  const inspect = await cli(f, ["inspect", "input-fixture"]); expect(inspect.code).toBe(0); expect(JSON.parse(inspect.stdout).originEvidence).toBe("unknown-local");
  expect(inspect.stdout).not.toContain(f.env.SCOUT_DIST_KEY!);
  refused(await cli(f, grantArgs(binding).filter(value => value !== "--acknowledge-unknown-origin")), "input_policy_invalid");
  refused(await cli(f, [...grantArgs(binding), "--continuity"]), "input_provenance_unverified");
  const result = await cli(f, grantArgs(binding)); expect(result.code).toBe(0); const grant = JSON.parse(result.stdout); expect(grant.binding).toEqual(binding);
  refused(await cli(f, grantArgs({ ...binding, declarationDigest: "sha256:scout-extension-declaration-v1:" + "c".repeat(64) })), "input_not_authorized");
  expect((await cli(f, ["revoke", grant.id])).code).toBe(0); expect(JSON.parse((await cli(f, ["list"])).stdout).grants).toEqual([]);
  mutateScoutExtension("update", "input-fixture", f.source, f.env); expect(listScoutExtensionInputGrants(f.env).grants).toEqual([]);
});

test("permission revalidation happens under the policy lock and changed selection cannot be granted", () => {
  const f = fixture(), binding = f.binding();
  expect(() => grantScoutExtensionInput(f.env, binding, () => ({ ...binding, instance: "different" }))).toThrow("selection_changed");
  expect(listScoutExtensionInputGrants(f.env).grants).toEqual([]);
  grantScoutExtensionInput(f.env, binding);
  expect(() => assertScoutExtensionInputGrant(f.env, binding, () => { throw new Error("changed"); })).toThrow("input_policy_invalid");
  expect(existsSync(join(dirname(scoutExtensionGrantStore(f.env)), ".lock"))).toBe(false);
});

import { deriveOpenScoutInstanceLayout } from "@openscout/runtime/instance";
import { captureScoutExtensionSelection } from "./extension-context.ts";
import { prepareScoutExtensionContext } from "./extension-context-runner.ts";
import { prepareScoutExtensionInputSession, encodeScoutExtensionInputResponse, EXTENSION_INPUT_REQUEST_SCHEMA } from "./extension-input-session.ts";
import { scoutExtensionContextBackend } from "./extension-context-host.ts";
function sessionFor(f: ReturnType<typeof fixture>, current = () => true) {
  const extension = findScoutExtension("input-fixture", f.env)!;
  const layout = deriveOpenScoutInstanceLayout({ env: f.env, home: f.home, name: "prod" });
  const frame = prepareScoutExtensionContext({ extension, env: f.env, selection: captureScoutExtensionSelection({ layout, env: f.env, home: f.home, uid: process.getuid!(), cwd: f.base }),
    cli: { version: "1.2.3", executable: join(import.meta.dir, "main.ts"), runtimeExecutable: process.execPath, cwd: f.base, output: "json" }, brokerUrl: "http://127.0.0.1:43110" });
  const session = prepareScoutExtensionInputSession(extension, frame, f.env, current)!;
  return { session, request: { schema: EXTENSION_INPUT_REQUEST_SCHEMA, id: session.metadata.id, treeDigest: session.metadata.treeDigest } };
}
test("input model is lazy, presence is frozen, absence is not denied and only one bounded response can contain a value", () => {
  if (!scoutExtensionContextBackend()) { expect(scoutExtensionContextBackend()).toBe(false); return; }
  const f = fixture(), initial = sessionFor(f); expect(JSON.stringify(initial.session.metadata)).not.toContain(f.env.SCOUT_DIST_KEY!);
  expect(initial.session.metadata.present).toBe(true); expect(listScoutExtensionInputGrants(f.env).grants).toEqual([]);
  expect(() => initial.session.request(initial.request)).toThrow("input_not_authorized");
  for (const value of [undefined, "", " \t\n "]) {
    const absent = fixture(); if (value === undefined) delete absent.env.SCOUT_DIST_KEY; else absent.env.SCOUT_DIST_KEY = value;
    const input = sessionFor(absent); expect(input.session.metadata.present).toBe(false);
    expect(input.session.request(input.request).status).toBe("absent"); expect(existsSync(scoutExtensionGrantStore(absent.env))).toBe(false);
  }
  grantScoutExtensionInput(f.env, f.binding()); const approved = sessionFor(f), response = approved.session.request(approved.request);
  expect(response.status).toBe("provided"); expect(response.value).toBe(f.env.SCOUT_DIST_KEY); expect(encodeScoutExtensionInputResponse(response).at(-1)).toBe(10);
  expect(() => approved.session.request(approved.request)).toThrow("input_protocol_invalid");
  for (const value of ["x".repeat(8193), "a\nb", "a\u0085b", "a\u0000b", "a\ud800"]) {
    const bad = fixture(); bad.env.SCOUT_DIST_KEY = value; grantScoutExtensionInput(bad.env, bad.binding()); const input = sessionFor(bad);
    expect(input.session.metadata.present).toBe(true); expect(() => input.session.request(input.request)).toThrow("input_value_invalid");
  }
  expect(() => encodeScoutExtensionInputResponse({ ...response, value: "\\".repeat(8192) })).toThrow("input_value_invalid");
});
test("request-time model rejects idle revocation, changed source, changed selection and unknown or repeated requests", () => {
  if (!scoutExtensionContextBackend()) { expect(scoutExtensionContextBackend()).toBe(false); return; }
  for (const mutation of ["revoke", "source", "selection", "declaration", "update", "endpoint"]) {
    const f = fixture(), grant = grantScoutExtensionInput(f.env, f.binding()), input = sessionFor(f, () => mutation !== "selection");
    if (mutation === "revoke") revokeScoutExtensionInputGrant(f.env, grant.id);
    if (mutation === "source") f.env.SCOUT_DIST_KEY = "different-synthetic-input";
    if (mutation === "endpoint") f.env.OPENSCOUT_DIST_URL = "https://different.example.test/path";
    if (mutation === "declaration") writeFileSync(join(f.env.OPENSCOUT_EXTENSIONS_HOME!, "input-fixture", "extension.json"), JSON.stringify({ api: 2, command: "run", invocation: { ...declaration, credentialInputs: [{ ...declaration.credentialInputs[0], purpose: "Different disclosure" }] } }));
    if (mutation === "update") { writeFileSync(join(f.source, "auxiliary"), "changed"); mutateScoutExtension("update", "input-fixture", f.source, f.env); }
    expect(() => input.session.request(input.request)).toThrow(mutation === "revoke" ? "input_not_authorized" : mutation === "source" ? "input_source_changed" : "selection_changed");
  }
  for (const value of [{}, { schema: "unknown", id: "distribution-key" }, { schema: EXTENSION_INPUT_REQUEST_SCHEMA, id: "other", treeDigest: "wrong" }]) {
    const f = fixture(), input = sessionFor(f); expect(() => input.session.request(value)).toThrow("input_protocol_invalid");
  }
});

test("unqualified input transport refuses a valid granted declaration before any provider execution", async () => {
  const f = fixture(), marker = join(f.base, "provider-executed");
  writeFileSync(join(f.source, "run"), `#!/bin/sh\nprintf x > '${marker}'\n`, { mode: 0o700 });
  mutateScoutExtension("update", "input-fixture", f.source, f.env); grantScoutExtensionInput(f.env, f.binding());
  const preload = join(f.base, "reserved.ts");
  writeFileSync(preload, `import{SCOUT_COMMANDS}from ${JSON.stringify(join(import.meta.dir, "registry.ts"))};SCOUT_COMMANDS.push({name:'input-fixture',summary:'Input test',provider:'extension'});`);
  const child = spawn(process.execPath, ["--preload", preload, join(import.meta.dir, "main.ts"), "--json", "input-fixture"], { env: f.env, cwd: f.base, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", data => stdout += data); child.stderr.on("data", data => stderr += data);
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try { const code = await new Promise<number | null>(done => child.once("close", done)); refused({ code, stdout, stderr }, scoutExtensionContextBackend() ? "input_backend_unproven" : "context_backend_unproven"); expect(existsSync(marker)).toBe(false); }
  finally { clearTimeout(timer); }
});
