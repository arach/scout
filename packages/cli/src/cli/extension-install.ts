import { constants, closeSync, chmodSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findScoutExtension, scoutExtensionDigest, scoutExtensionDirectoryProblem, scoutExtensionsHome } from "./extensions.ts";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1024;
const MAX_GENERATIONS = 8;
const MAX_RECEIPT_BYTES = 32 * 1024;
const OPERATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}(?![\s\S])/;
const DIGEST = /^[a-f0-9]{64}(?![\s\S])/;
export type ScoutExtensionInstallOptions = {
  expected?: { absent: true } | { generation: string; digest: string };
  operationId?: string;
};
export class ScoutExtensionInstallError extends Error {
  constructor(public readonly code: "EXTENSION_CONDITION_INVALID" | "EXTENSION_PRECONDITION_FAILED" | "EXTENSION_RECEIPT_UNAVAILABLE", message: string) {
    super(message); this.name = "ScoutExtensionInstallError";
  }
}
export type ScoutExtensionInstallReceipt = {
  action: "install" | "update" | "remove";
  name: string;
  home: string;
  status: "installed" | "removed";
  version: string | null;
  digest: string | null;
  previousArtifact: string | null;
  publishedGeneration: string;
  operationId: string | null;
};
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
function directory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error("installer directories must not be symlinks");
  const problem = scoutExtensionDirectoryProblem(path);
  if (problem) throw new Error(`unsafe extension installation directory: ${problem}`);
}
function validateOptions(action: string, options: ScoutExtensionInstallOptions) {
  const { expected, operationId } = options;
  if ((operationId !== undefined && (typeof operationId !== "string" || !OPERATION_ID.test(operationId)))
    || (expected !== undefined && (!expected || typeof expected !== "object" || action === "remove" || !operationId
      || ("absent" in expected
        ? expected.absent !== true || Object.keys(expected).length !== 1 || action !== "install"
        : typeof expected.generation !== "string" || !isAbsolute(expected.generation) || !DIGEST.test(expected.digest)
          || Object.keys(expected).length !== 2 || action !== "update")))) {
    throw new ScoutExtensionInstallError("EXTENSION_CONDITION_INVALID", "use install with expected absence, or update with an absolute generation and SHA-256 digest; a condition requires an operation ID (1–128 letters, digits, . _ : -)");
  }
}

/** Read-only recovery after lost stdout. Records identify publication, not download origin or user grants. */
export function readScoutExtensionInstallReceipt(name: string, env: NodeJS.ProcessEnv = process.env): ScoutExtensionInstallReceipt {
  try {
    if (!NAME.test(name)) throw new Error("invalid extension name");
    const home = realpathSync(scoutExtensionsHome(env));
    const generations = join(home, ".installed", name), target = join(home, name);
    for (const path of [home, join(home, ".installed"), generations]) {
      if (!lstatSync(path).isDirectory() || scoutExtensionDirectoryProblem(path)) throw new Error("unsafe managed directory");
    }
    if (!lstatSync(target).isSymbolicLink()) throw new Error("not a managed selection");
    const generation = resolve(home, readlinkSync(target));
    if (dirname(generation) !== generations || realpathSync(generation) !== generation) throw new Error("invalid selected generation");
    const receipts = join(home, ".receipts", name);
    for (const path of [join(home, ".receipts"), receipts]) {
      if (!lstatSync(path).isDirectory() || scoutExtensionDirectoryProblem(path)) throw new Error("unsafe receipt directory");
    }
    const fd = openSync(join(receipts, `${generation.slice(generations.length + 1)}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let record: ScoutExtensionInstallReceipt;
    try {
      const info = fstatSync(fd), uid = process.getuid?.();
      if (!info.isFile() || uid === undefined || (info.uid !== uid && info.uid !== 0) || (info.mode & 0o022)) throw new Error("unsafe receipt file");
      const data = Buffer.alloc(MAX_RECEIPT_BYTES + 1); let size = 0, n: number;
      while (size < data.length && (n = readSync(fd, data, size, data.length - size, null))) size += n;
      if (size > MAX_RECEIPT_BYTES) throw new Error("receipt too large");
      record = JSON.parse(data.subarray(0, size).toString("utf8"));
    } finally { closeSync(fd); }
    const current = findScoutExtension(name, { ...env, OPENSCOUT_EXTENSIONS_HOME: home });
    if (!current || (current.refused && !current.removed)) throw new Error("selected artifact is refused");
    const digest = current.removed ? null : scoutExtensionDigest(current);
    if (!record || record.name !== name || record.home !== home || record.publishedGeneration !== generation
      || !["install", "update", "remove"].includes(record.action) || record.status !== (current.removed ? "removed" : "installed")
      || record.version !== (current.version ?? null) || record.digest !== digest
      || (record.operationId !== null && (typeof record.operationId !== "string" || !OPERATION_ID.test(record.operationId)))
      || (record.previousArtifact !== null && typeof record.previousArtifact !== "string")
      || resolve(home, readlinkSync(target)) !== generation) throw new Error("receipt does not match the current selection");
    return record;
  } catch {
    throw new ScoutExtensionInstallError("EXTENSION_RECEIPT_UNAVAILABLE", `no verified publication receipt for ${name} in the selected extension home; inspect the current selection before forming a new condition`);
  }
}
function copyArtifact(source: string, target: string) {
  let bytes = 0, files = 0;
  const visit = (from: string, to: string, depth: number) => {
    if (depth > 16) throw new Error("extension artifact exceeds directory depth limit");
    const info = lstatSync(from);
    if (info.isDirectory()) {
      if (++files > MAX_FILES) throw new Error("extension artifact has too many entries");
      mkdirSync(to, { mode: 0o700 });
      for (const name of readdirSync(from).sort()) visit(join(from, name), join(to, name), depth + 1);
    } else {
      if (!info.isFile() || ++files > MAX_FILES) throw new Error("extension artifact accepts only regular files and directories, not symlinks");
      const fd = openSync(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!fstatSync(fd).isFile()) throw new Error("extension artifact is not a regular file");
        const chunks: Buffer[] = []; let size = 0;
        for (;;) {
          const chunk = Buffer.alloc(64 * 1024); const n = readSync(fd, chunk);
          if (!n) break;
          bytes += n; size += n;
          if (bytes > MAX_BYTES) throw new Error("extension artifact exceeds 32 MiB");
          chunks.push(chunk.subarray(0, n));
        }
        writeFileSync(to, Buffer.concat(chunks, size), { flag: "wx", mode: (info.mode & 0o111) ? 0o700 : 0o600 });
      } finally { closeSync(fd); }
    }
  };
  visit(source, target, 0);
}

/** Installs trusted, prebuilt local artifacts only. Never downloads or executes install hooks. */
export function mutateScoutExtension(action: "install" | "update" | "remove", name: string, source: string | undefined, env: NodeJS.ProcessEnv = process.env, options: ScoutExtensionInstallOptions = {}): ScoutExtensionInstallReceipt {
  if (!NAME.test(name)) throw new Error("extension name must be a lowercase verb (up to 40 characters)");
  validateOptions(action, options);
  const selectedHome = scoutExtensionsHome(env); directory(selectedHome);
  const home = realpathSync(selectedHome);
  const managed = join(home, ".installed"); directory(managed);
  const generations = join(managed, name); directory(generations);
  const locks = join(home, ".locks"); directory(locks);
  const lock = join(locks, name);
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error(`extension ${name} is busy; inspect its installer lock before retrying`); }
  const id = randomUUID(), stage = join(home, `.stage-${id}`), generation = join(generations, id), pointer = join(home, `.publish-${id}`), target = join(home, name);
  let published = false, receiptPath: string | undefined;
  try {
    const present = (() => { try { return lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } })();
    // The public lock, not a caller's earlier inspection, protects this comparison.
    if (options.expected) {
      let matches = false;
      try {
        const expected = options.expected;
        if ("absent" in expected) matches = !present;
        else if (present?.isSymbolicLink()) {
          const selected = resolve(home, readlinkSync(target));
          const current = findScoutExtension(name, { ...env, OPENSCOUT_EXTENSIONS_HOME: home });
          matches = selected === expected.generation && dirname(selected) === generations && realpathSync(selected) === selected
            && !!current && !current.refused && !current.removed && scoutExtensionDigest(current) === expected.digest;
        }
      } catch { /* Unknown or unsafe current state cannot satisfy a condition. */ }
      if (!matches) throw new ScoutExtensionInstallError("EXTENSION_PRECONDITION_FAILED", `extension ${name} no longer matches the expected state; inspect its selection and receipt before retrying`);
    }
    let previous: string | undefined;
    if (present) {
      if (!present.isSymbolicLink()) throw new Error("installer will not replace an unmanaged directory; move it aside explicitly first");
      previous = resolve(home, readlinkSync(target));
      if (!inside(generations, previous) || !lstatSync(previous).isDirectory()) throw new Error("installer will not replace an unmanaged or dangling link");
      if (realpathSync(dirname(previous)) !== realpathSync(generations)) throw new Error("invalid managed extension generation");
    }
    const current = findScoutExtension(name, { ...env, OPENSCOUT_EXTENSIONS_HOME: home });
    if (action === "install" && present && !current?.removed) throw new Error(`extension ${name} is already installed; use update`);
    if (action !== "install" && (!present || current?.removed)) throw new Error(`extension ${name} is not installed in the writable extension home`);
    if (action !== "remove" && readdirSync(generations).length >= MAX_GENERATIONS) throw new Error("retained generation limit reached (8); remove and reinstall to clear history");
    mkdirSync(stage, { mode: 0o700 });
    const artifact = join(stage, name);
    let version: string | null = null, digest: string | null = null;
    if (action === "remove") {
      mkdirSync(artifact, { mode: 0o700 });
      writeFileSync(join(artifact, "extension.json"), JSON.stringify({ api: 1, disabled: true }), { mode: 0o600 });
    } else {
      if (!source) throw new Error(`${action} requires a prebuilt artifact directory`);
      copyArtifact(resolve(source), artifact);
      const manifestPath = join(artifact, "extension.json");
      if (lstatSync(manifestPath).size > 16 * 1024) throw new Error("extension manifest exceeds 16 KiB");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || manifest.disabled !== undefined
        || typeof manifest.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?$/.test(manifest.version)
        || typeof manifest.command !== "string" || isAbsolute(manifest.command)
        || manifest.command.split(/[\\/]/).some((part: string) => !part || part === "." || part === "..")) throw new Error("artifact needs a version and an in-directory command");
      chmodSync(join(artifact, manifest.command), 0o700);
      const candidate = findScoutExtension(name, { ...env, OPENSCOUT_EXTENSIONS_HOME: stage });
      if (!candidate || candidate.refused) throw new Error(candidate?.refused ?? "artifact has no valid extension manifest");
      // Force digest bounds before publication; execution is never a validation step.
      digest = scoutExtensionDigest(candidate); version = candidate.version ?? null;
    }
    const receipt: ScoutExtensionInstallReceipt = { action, name, home, status: action === "remove" ? "removed" : "installed", version, digest,
      previousArtifact: action === "update" ? previous ?? null : null, publishedGeneration: generation, operationId: options.operationId ?? null };
    const receipts = join(home, ".receipts"); directory(receipts);
    const verbReceipts = join(receipts, name); directory(verbReceipts);
    const recordPath = join(verbReceipts, `${id}.json`);
    // Complete the correlated record before the selection can point at this generation.
    const receiptJSON = JSON.stringify(receipt) + "\n";
    if (Buffer.byteLength(receiptJSON) > MAX_RECEIPT_BYTES) throw new Error("publication receipt exceeds 32 KiB");
    const receiptFD = openSync(recordPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    receiptPath = recordPath;
    try { writeFileSync(receiptFD, receiptJSON); } finally { closeSync(receiptFD); }
    renameSync(artifact, generation);
    symlinkSync(generation, pointer);
    renameSync(pointer, target); // The only activation point: old or complete new generation.
    published = true;
    if (action === "remove") {
      // The tombstone blocks accidental activation of a legacy-home copy.
      for (const entry of readdirSync(generations)) if (entry !== id) {
        rmSync(join(generations, entry), { recursive: true, force: true });
        rmSync(join(verbReceipts, `${entry}.json`), { force: true });
      }
    }
    return receipt;
  } finally {
    rmSync(pointer, { force: true }); rmSync(stage, { recursive: true, force: true });
    if (!published) { rmSync(generation, { recursive: true, force: true }); if (receiptPath) rmSync(receiptPath, { force: true }); }
    rmSync(lock, { recursive: true, force: true });
  }
}
