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

export type CheckpointOutput = {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  timeoutMs?: number;
};
const OUTPUT_DRAIN_MS = 5000;
/** One shared wall-clock budget for both pipes, including backpressure. */
async function drainOutput(out: string, err: string, output: CheckpointOutput): Promise<unknown> {
  const timeoutMs = output.timeoutMs ?? OUTPUT_DRAIN_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Error("invalid qualification output drain budget");
  const write = (stream: NodeJS.WritableStream, text: string) => new Promise<void>((resolve, reject) => {
    // A write callback can report the error before the stream emits it. Keep
    // its one-shot error listener in that case, so the later event is handled.
    const onError = (error: Error) => reject(error);
    stream.once("error", onError);
    try {
      stream.write(text, error => {
        if (error) reject(error);
        else {stream.removeListener("error", onError); resolve();}
      });
    } catch (error) {stream.removeListener("error", onError); reject(error);}
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const writes = Promise.allSettled([write(output.stdout ?? process.stdout, out), write(output.stderr ?? process.stderr, err)])
      .then(results => results.find(result => result.status === "rejected")?.reason);
    return await Promise.race([writes, new Promise<Error>(resolve => {
      timer = setTimeout(() => resolve(Error(`qualification output drain timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}

export async function command(args: string[], env = process.env, output: CheckpointOutput = {}) {
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
  const failure = await drainOutput(out, err, output);
  // Drain failure never replaces a child's refusal or turns it into success.
  if (code !== 0) throw Error(`qualification command failed: ${args.join(" ")}`, {cause: failure});
  // A zero-exit child with unobservable output is not checkpoint evidence.
  if (failure) throw Error("qualification output drain failed", {cause: failure});
  return out + err;
}
