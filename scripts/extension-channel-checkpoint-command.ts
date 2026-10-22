import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Bun bare test arguments are filters. Validate files before using explicit paths. */
export function checkpointFiles(...paths: string[]): string[] {
  return paths.map(path => {
    const explicit = path.startsWith("./") ? path : `./${path}`;
    try {
      if (statSync(explicit).isFile()) return explicit;
    } catch {}
    throw Error(`qualification file missing or not regular: ${explicit}`);
  });
}

export async function command(args: string[], env = process.env) {
  // Agent reporter modes hide case identities even with piped output. Keep the
  // caller's JIT lane and other environment, but never inherit reporter modes.
  const childEnv = { ...env };
  delete childEnv.FORCE_COLOR;
  delete childEnv.CLAUDECODE;
  delete childEnv.NO_COLOR;
  const child = Bun.spawn(args, { env: childEnv, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  process.stdout.write(out);
  process.stderr.write(err);
  if (code !== 0) throw Error(`qualification command failed: ${args.join(" ")}`);
  return out + err;
}


/** The fence validates every entry/usage. Its success count must equal the
 * current complete on-disk policy inventory, not a historical minimum. */
export function verifyFenceInventory(output: string, root = process.cwd()): number {
  for (const directory of ["packages", "apps", "scripts/sync-exec-allowlist"]) {
    if (!lstatSync(join(root, directory)).isDirectory()) throw Error("qualification fence scan root missing");
  }
  let expected = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) expected++;
      else throw Error("qualification fence inventory must contain regular per-key JSON files");
    }
  };
  visit(join(root, "scripts/sync-exec-allowlist"));
  const records = [...output.matchAll(/^Sync exec fence passed \((\d+) allowlisted symbol\/file pairs\)\.$/gm)];
  const observed = records.length === 1 ? Number(records[0]![1]) : NaN;
  if (!expected || observed !== expected) throw Error(`qualification fence inventory mismatch: expected ${expected}, observed ${observed}`);
  return observed;
}
