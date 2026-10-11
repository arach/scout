import { resolve } from "node:path";

import { createScoutOutput, type ScoutOutput, type ScoutOutputMode } from "./output.ts";

export type ScoutCommandContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  output: ScoutOutput;
  isTty: boolean;
};

export function createScoutCommandContext(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  outputMode?: ScoutOutputMode;
  isTty?: boolean;
} = {}): ScoutCommandContext {
  // Use the drainable Node streams. Bun's native console can buffer outside
  // process.stdout after an isTTY probe; finishing that stream alone then
  // cannot flush a large console.log before the package shim forces exit.
  const stdout = input.stdout ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const stderr = input.stderr ?? ((line: string) => { process.stderr.write(`${line}\n`); });

  return {
    cwd: input.cwd ?? process.cwd(),
    env: input.env ?? process.env,
    stdout,
    stderr,
    output: createScoutOutput(input.outputMode ?? "plain", stdout),
    isTty: input.isTty ?? Boolean(process.stdout.isTTY),
  };
}

export function defaultScoutContextDirectory(context: Pick<ScoutCommandContext, "cwd" | "env">): string {
  const configured = context.env.OPENSCOUT_SETUP_CWD?.trim();
  return configured ? resolve(configured) : context.cwd;
}
