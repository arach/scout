import { applyInstanceFlag, extractInstanceFlag, parseScoutArgv } from "../../bin/lifecycle-preflight.mjs";
import { applyOpenScoutInstanceEnvironment, assertOpenScoutInstanceIsolation, selectCliOpenScoutInstance } from "@openscout/runtime/instance";

/** Select before the legacy ask/lifecycle graph loads. Only the independently
 * ported runtimes slice is eligible; setup/doctor still need the runtime seam. */
export function coreBootstrapInput(argv: string[]) {
  const input = parseScoutArgv(extractInstanceFlag(argv).argv);
  const command = input.command === "relay" ? input.args[0] : input.command;
  return command === "runtimes" && !input.versionRequested ? input : null;
}

export async function runCoreBootstrap(argv: string[]): Promise<boolean> {
  const input = coreBootstrapInput(argv);
  if (!input) return false;
  applyInstanceFlag(process);
  selectCliOpenScoutInstance(process.env);
  applyOpenScoutInstanceEnvironment(process.env);
  assertOpenScoutInstanceIsolation("scout");
  const { createScoutCommandContext } = await import("./context.ts");
  const { runRuntimesCommand } = await import("./commands/runtimes.ts");
  const args = input.command === "relay" ? input.args.slice(1) : input.args;
  await runRuntimesCommand(createScoutCommandContext({ outputMode: input.outputMode }), input.helpRequested ? ["--help", ...args] : args);
  return true;
}
