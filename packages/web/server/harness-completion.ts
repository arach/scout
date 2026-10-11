/**
 * Cheap one-shot completions through the operator's own coding-agent
 * subscriptions: Claude Code (`claude -p`) or Codex (`codex exec`), run
 * headless with no tools, no session persistence and a neutral cwd.
 *
 * No API keys: whichever CLI is signed in pays from its plan. The pick
 * follows the Claude/Codex quota gauges, the one with more room first,
 * and falls back to the other when a run fails.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { ServiceGauge } from "./service-budgets.ts";

export type HarnessCompletionProvider = "claude" | "codex";

export type HarnessCompleteInput = { systemPrompt: string; body: string };
export type HarnessCompleteResult = { text: string; model: string };

/** The fast, cheap model each subscription offers. */
export const HARNESS_CHEAP_MODELS: Record<HarnessCompletionProvider, string> = {
  claude: "claude-haiku-5-5",
  codex: "gpt-6-luna",
};

const RUN_TIMEOUT_MS = 90_000;
const RUN_KILL_GRACE_MS = 5_000;
const RUN_SETTLE_GRACE_MS = 2_000;

function findBinary(name: string): string | null {
  const dirs = [
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    ...(process.env.PATH ?? "").split(":"),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function run(
  command: string,
  args: string[],
  stdin: string,
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Its own process group, so a timeout reaches the launcher's descendants too
    // (an npm launcher's child inherits these pipes and would hold them open).
    const ownGroup = process.platform !== "win32";
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env, detached: ownGroup });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      settle();
    };
    const signalTree = (signal: NodeJS.Signals) => {
      try {
        if (ownGroup && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* already gone */ }
    };
    const timeoutError = () => new Error(`${command} timed out after ${RUN_TIMEOUT_MS / 1000}s`);
    let closed = false;
    let groupKilled = false;
    // On timeout: TERM the group, then always KILL it after a grace period, even
    // if the launcher already exited (a worker in the group may ignore TERM). The
    // run settles only after that KILL and the pipes closing, so a fallback
    // harness never runs beside this one; pipes still open after a bounded wait
    // are torn down.
    timers.push(setTimeout(() => {
      timedOut = true;
      signalTree("SIGTERM");
      timers.push(setTimeout(() => {
        signalTree("SIGKILL");
        groupKilled = true;
        if (closed) return finish(() => reject(timeoutError()));
        timers.push(setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(() => reject(timeoutError()));
        }, RUN_SETTLE_GRACE_MS));
      }, RUN_KILL_GRACE_MS));
    }, RUN_TIMEOUT_MS));
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      closed = true;
      if (!timedOut) finish(() => resolve({ code, stdout, stderr }));
      else if (groupKilled) finish(() => reject(timeoutError()));
    });
    child.stdin.end(stdin);
  });
}

/** A scratch cwd so no project CLAUDE.md / AGENTS.md leaks into the read. */
async function neutralCwd(): Promise<string> {
  const dir = join(tmpdir(), "openscout-harness-completion");
  await mkdir(dir, { recursive: true });
  return dir;
}

async function completeWithClaude(input: HarnessCompleteInput): Promise<HarnessCompleteResult> {
  const bin = findBinary("claude");
  if (!bin) throw new Error("Claude Code is not installed.");
  const model = HARNESS_CHEAP_MODELS.claude;
  const { code, stdout, stderr } = await run(bin, [
    "-p",
    "--model", model,
    "--output-format", "json",
    "--no-session-persistence",
    "--tools", "",
    "--strict-mcp-config",
    "--system-prompt", input.systemPrompt,
  ], input.body, await neutralCwd());
  let parsed: { result?: unknown; is_error?: unknown } | null = null;
  try {
    parsed = JSON.parse(stdout) as { result?: unknown; is_error?: unknown };
  } catch {
    // Fall through to the error below.
  }
  if (code !== 0 || !parsed || parsed.is_error || typeof parsed.result !== "string") {
    const detail = (typeof parsed?.result === "string" ? parsed.result : stderr || stdout).trim().slice(0, 200);
    throw new Error(`Claude Code run failed${detail ? `: ${detail}` : ""}`);
  }
  return { text: parsed.result, model: `${model} via Claude Code` };
}

async function completeWithCodex(input: HarnessCompleteInput): Promise<HarnessCompleteResult> {
  const bin = findBinary("codex");
  if (!bin) throw new Error("Codex is not installed.");
  const model = HARNESS_CHEAP_MODELS.codex;
  const outDir = await mkdtemp(join(tmpdir(), "openscout-codex-out-"));
  const outFile = join(outDir, "last.txt");
  try {
    const { code, stderr } = await run(bin, [
      "exec",
      "--skip-git-repo-check",
      "-s", "read-only",
      "-m", model,
      "-c", "model_reasoning_effort=low",
      "--ephemeral",
      "-o", outFile,
      "-",
    ], `${input.systemPrompt}\n\n${input.body}`, await neutralCwd());
    const text = existsSync(outFile) ? (await readFile(outFile, "utf8")).trim() : "";
    if (code !== 0 || !text) {
      throw new Error(`Codex run failed${stderr.trim() ? `: ${stderr.trim().slice(-200)}` : ""}`);
    }
    return { text, model: `${model} via Codex` };
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

const RUNNERS: Record<HarnessCompletionProvider, (input: HarnessCompleteInput) => Promise<HarnessCompleteResult>> = {
  claude: completeWithClaude,
  codex: completeWithCodex,
};

/** How full a provider's tightest quota window is, 0–1; unknown sorts last-but-usable. */
function tightestFill(gauges: ServiceGauge[], id: HarnessCompletionProvider): number {
  const fills = gauges
    .filter((gauge) => gauge.id === id && gauge.kind === "quota")
    .flatMap((gauge) => gauge.kind === "quota"
      ? [gauge.fill, ...(gauge.windows ?? []).filter((window) => !window.awaitingReset).map((window) => window.fill)]
      : []);
  return fills.length ? Math.max(...fills) : 0.5;
}

/** Claude and Codex, the one with more quota room first. */
export function harnessCompletionOrder(gauges: ServiceGauge[]): HarnessCompletionProvider[] {
  const order: HarnessCompletionProvider[] = ["claude", "codex"];
  return order.sort((a, b) => tightestFill(gauges, a) - tightestFill(gauges, b));
}

/**
 * One completion on the subscription with the most room, falling back to
 * the other. `loadGauges` is the service-budgets reading; when it fails
 * the order defaults to Claude, then Codex.
 */
export async function completeViaSubscription(
  input: HarnessCompleteInput,
  options: { loadGauges?: () => Promise<ServiceGauge[]> } = {},
): Promise<HarnessCompleteResult> {
  const gauges = await options.loadGauges?.().catch(() => []) ?? [];
  const errors: string[] = [];
  for (const provider of harnessCompletionOrder(gauges)) {
    try {
      return await RUNNERS[provider](input);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join(" · ") || "No coding-agent subscription is available.");
}
