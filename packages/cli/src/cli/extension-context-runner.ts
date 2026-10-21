import { scoutExtensionContextBackend } from "./extension-context-host.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, join } from "node:path";
import { constants as osConstants } from "node:os";
import type { Writable } from "node:stream";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "@openscout/runtime/inherited-descriptors";
import { findScoutExtension, scoutExtensionRoots, type ScoutExtension } from "@openscout/runtime/scout-extensions";
import { readScoutExtensionInstallReceipt } from "./extension-install.ts";
import { contextRefusal, encodeScoutExtensionContext, projectScoutExtensionContext, type ScoutExtensionContext, type ScoutExtensionSelection } from "./extension-context.ts";

export function prepareScoutExtensionContext(input: {
  extension: ScoutExtension; env: NodeJS.ProcessEnv; selection: ScoutExtensionSelection | undefined;
  cli: ScoutExtensionContext["cli"]; brokerUrl: string; ports?: { broker?: number; web?: number; pairing?: number };
}): ScoutExtensionContext {
  const { extension, env } = input;
  if (!input.selection || !extension.invocation) contextRefusal(extension.name);
  try {
    const receipt = readScoutExtensionInstallReceipt(extension.name, env);
    if (!receipt.treeDigest || receipt.status !== "installed") throw new Error();
    return projectScoutExtensionContext({ selection: input.selection, invocation: extension.invocation,
      cli: input.cli, brokerUrl: input.brokerUrl, ports: input.ports,
      extension: { name: extension.name, selectedRoot: realpathSync(extension.root), readRoots: scoutExtensionRoots(env).map(root => resolve(input.cli.cwd, root)),
        artifact: receipt.publishedGeneration, version: receipt.version, treeDigest: receipt.treeDigest } });
  } catch { contextRefusal(extension.name); }
}

/** Runtime-owned extra pipe; no borrowed numeric source descriptors. All other extra targets are ignored. */
export function scoutExtensionContextStdio(): Array<"inherit" | "ignore" | "pipe"> {
  const stdio: Array<"inherit" | "ignore" | "pipe"> = Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore");
  for (const slot of Object.values(INHERITED_DESCRIPTOR_LAYOUTS.stdio)) stdio[slot] = "inherit";
  stdio[INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.context] = "pipe";
  return stdio;
}

/** Bounded write completion (OS delivery, not a provider acknowledgement); end sends LF then EOF. */
export function deliverScoutExtensionContext(stream: Writable, wire: Buffer, childClosed: Promise<unknown>, timeoutMs = 5000): Promise<void> {
  return new Promise((resolveDone, reject) => {
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); stream.off("finish", onFinish); stream.destroy();
      error ? reject(error) : resolveDone();
    };
    const onError = () => done(new Error("context_delivery_failed"));
    const onFinish = () => done();
    const timer = setTimeout(() => done(new Error("context_delivery_timeout")), timeoutMs);
    stream.on("error", onError);
    stream.once("close", () => { stream.off("error", onError); stream.off("finish", onFinish); });
    stream.once("finish", onFinish);
    childClosed.then(() => done(new Error("context_child_closed")), onError);
    try { stream.end(wire); } catch { onError(); }
  });
}
function sameSelection(extension: ScoutExtension, frame: ScoutExtensionContext, env: NodeJS.ProcessEnv): boolean {
  try {
    const current = findScoutExtension(extension.name, env), receipt = readScoutExtensionInstallReceipt(extension.name, env);
    return !!current && !current.refused && current.api === 2 && current.command === extension.command
      && JSON.stringify(current.invocation) === JSON.stringify(extension.invocation)
      && (env.OPENSCOUT_INSTANCE?.trim() || "prod") === frame.selection.instance
      && frame.selection.uid === process.getuid?.()
      && realpathSync(current.root) === frame.extensions.selectedRoot
      && realpathSync(join(current.root, current.name)) === frame.extensions.artifact
      && receipt.publishedGeneration === frame.extensions.artifact && receipt.treeDigest === frame.extensions.treeDigest;
  } catch { return false; }
}
export async function stopScoutExtensionContextChild(child: ChildProcess, closed: Promise<unknown>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) { await closed; return; }
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 250);
  try { await closed; } finally { clearTimeout(timer); }
}
export async function runScoutExtensionWithContext(extension: ScoutExtension, args: readonly string[], env: NodeJS.ProcessEnv,
  frame: ScoutExtensionContext, selectionEnv: NodeJS.ProcessEnv): Promise<number> {
  const wire = encodeScoutExtensionContext(frame);
  if (!sameSelection(extension, frame, selectionEnv)) contextRefusal(extension.name, "selection_changed");
  if (!scoutExtensionContextBackend()) contextRefusal(extension.name, "context_backend_unproven");
  const child = spawn(extension.command, args, { env, cwd: frame.cli.cwd, stdio: scoutExtensionContextStdio() });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => child.once("close", (code, signal) => resolveExit({ code, signal })));
  let spawnError = false;
  child.once("error", () => { spawnError = true; });
  const stream = (child.stdio as Array<unknown>)[INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.context] as Writable | null;
  const swallow = () => {}; stream?.on("error", swallow);
  stream?.once("close", () => stream.off("error", swallow));
  const forward = (signal: NodeJS.Signals) => { child.kill(signal); };
  const wait = () => {};
  process.on("SIGTERM", forward); process.on("SIGHUP", forward); process.on("SIGINT", wait);
  try {
    if (!stream) { await stopScoutExtensionContextChild(child, closed); contextRefusal(extension.name, "context_delivery_failed"); }
    try { await deliverScoutExtensionContext(stream, wire, closed); }
    catch { await stopScoutExtensionContextChild(child, closed); contextRefusal(extension.name, "context_delivery_failed"); }
    const status = await closed;
    if (spawnError) contextRefusal(extension.name, "context_delivery_failed");
    return status.signal ? 128 + (osConstants.signals[status.signal] ?? 1) : status.code ?? 1;
  } finally {
    stream?.destroy();
    process.off("SIGTERM", forward); process.off("SIGHUP", forward); process.off("SIGINT", wait);
  }
}
