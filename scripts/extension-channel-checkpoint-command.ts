import { statSync } from "node:fs";
export { verifyFenceInventory } from "./extension-channel-fence-inventory.ts";

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
  // A nonzero child can emit a large refusal record. Do not throw (and let the
  // caller exit) while either hosted output pipe still has buffered bytes.
  const write = (stream: NodeJS.WritableStream, text: string) => new Promise<void>((resolve, reject) => {
    stream.write(text, error => error ? reject(error) : resolve());
  });
  const writes = await Promise.allSettled([write(process.stdout, out), write(process.stderr, err)]);
  for (const result of writes) if (result.status === "rejected") throw result.reason;
  if (code !== 0) throw Error(`qualification command failed: ${args.join(" ")}`);
  return out + err;
}
