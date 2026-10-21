import { constants, closeSync, chmodSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { findScoutExtension, scoutExtensionDigest, scoutExtensionDirectoryProblem, scoutExtensionsHome } from "./extensions.ts";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1024;
const MAX_GENERATIONS = 8;
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
function directory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error("installer directories must not be symlinks");
  const problem = scoutExtensionDirectoryProblem(path);
  if (problem) throw new Error(`unsafe extension installation directory: ${problem}`);
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
export function mutateScoutExtension(action: "install" | "update" | "remove", name: string, source: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!NAME.test(name)) throw new Error("extension name must be a lowercase verb (up to 40 characters)");
  const selectedHome = scoutExtensionsHome(env); directory(selectedHome);
  const home = realpathSync(selectedHome);
  const managed = join(home, ".installed"); directory(managed);
  const generations = join(managed, name); directory(generations);
  const locks = join(home, ".locks"); directory(locks);
  const lock = join(locks, name);
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error(`extension ${name} is busy; inspect its installer lock before retrying`); }
  const id = randomUUID(), stage = join(home, `.stage-${id}`), generation = join(generations, id), pointer = join(home, `.publish-${id}`), target = join(home, name);
  let published = false;
  try {
    const present = (() => { try { return lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } })();
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
      scoutExtensionDigest(candidate);
    }
    renameSync(artifact, generation);
    symlinkSync(generation, pointer);
    renameSync(pointer, target); // The only activation point: old or complete new generation.
    published = true;
    if (action === "remove") {
      // The tombstone blocks accidental activation of a legacy-home copy.
      for (const entry of readdirSync(generations)) if (entry !== id) rmSync(join(generations, entry), { recursive: true, force: true });
    }
    const installed = findScoutExtension(name, { ...env, OPENSCOUT_EXTENSIONS_HOME: home });
    return { action, name, home, status: action === "remove" ? "removed" : "installed", version: installed?.version ?? null,
      digest: installed && !installed.refused ? scoutExtensionDigest(installed) : null, previousArtifact: action === "update" ? previous ?? null : null };
  } finally {
    rmSync(pointer, { force: true }); rmSync(stage, { recursive: true, force: true });
    if (!published) rmSync(generation, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}
