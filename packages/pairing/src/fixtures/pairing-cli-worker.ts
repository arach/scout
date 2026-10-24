import { runPairCommand } from "../../../cli/src/cli/commands/pair.ts";
import { createScoutCommandContext } from "../../../cli/src/cli/context.ts";
try {
  await runPairCommand(createScoutCommandContext({outputMode:"json"}),process.argv.slice(2));
} catch(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode=1;
}
