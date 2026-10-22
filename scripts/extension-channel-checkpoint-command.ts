import { statSync } from "node:fs";

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
