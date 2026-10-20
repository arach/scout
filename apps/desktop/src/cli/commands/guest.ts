import type { ScoutCommandContext } from "../context.ts";
import { runGuestCommand as runSharedGuestCommand } from "../../../../../packages/cli/src/guest.ts";

export async function runGuestCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  await runSharedGuestCommand(args, { env: context.env, stdout: context.stdout });
}
