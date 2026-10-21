import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { loadScoutAgentStatuses } from "../../lib/core/agents/service.ts";
import { renderScoutAgentStatusList } from "../../lib/ui/terminal/agents.ts";

export async function runPsCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseContextRootCommandOptions("ps", args, defaultScoutContextDirectory(context));
  const agents = await loadScoutAgentStatuses({
    currentDirectory: options.currentDirectory,
  });
  context.output.writeValue(agents, renderScoutAgentStatusList);
}
