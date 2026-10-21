import { extractInstanceFlag } from "../../bin/lifecycle-preflight.mjs";
import { scoutDiscoveryEnv } from "./discovery-env.ts";
import { scoutCommandHelp } from "./command-help.ts";
import { renderScoutHelp } from "./help.ts";
import { renderScoutCompletion, scoutCompletionCandidates } from "./completion.ts";

/** Run before service imports, instance selection, local settings or maintenance. */
export async function runScoutDiscovery(argv: string[], version: string, env = process.env, write = (s: string) => console.log(s)): Promise<boolean> {
  const extracted = extractInstanceFlag(argv);
  argv = extracted.argv;
  let start = 0;
  while (start < argv.length) {
    if (argv[start] === "--json" || argv[start] === "--help" || argv[start] === "-h") start++;
    else if (argv[start] === "--instance") start += 2;
    else if (argv[start]?.startsWith("--instance=")) start++;
    else break;
  }
  if (argv[start] === "relay") start++;
  const command = argv[start];
  if (command === "completion") {
    env = scoutDiscoveryEnv(env, extracted.instance);
    const args = argv.slice(start + 1);
    if (args[0] === "--query") {
      if (!/^\d{1,2}$/.test(args[1] ?? "") || args[2] !== "--") throw new Error("invalid completion query");
      const candidates = await scoutCompletionCandidates(args.slice(3), Number(args[1]), env, version);
      if (candidates.length) write(candidates.join("\n"));
    } else if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
      write("Usage: scout completion zsh|bash|fish\nGenerate a shell script. See scout help completion --json and the Extensions documentation.");
    } else {
      if (args.length !== 1) throw new Error("usage: scout completion zsh|bash|fish");
      write(renderScoutCompletion(args[0]!));
    }
    return true;
  }
  const json = argv.includes("--json");
  if (command === "help" || (json && (argv.includes("--help") || argv.includes("-h")))) {
    env = scoutDiscoveryEnv(env, extracted.instance);
    const path = argv.slice(command === "help" ? start + 1 : start).filter(arg => !["--json", "--help", "-h", "--detail"].includes(arg));
    if (!path.length && !json) write(renderScoutHelp(version, argv.includes("--detail")));
    else {
      const help = scoutCommandHelp(path, version, env);
      write(json ? JSON.stringify(help) : help.markdown!);
    }
    return true;
  }
  return false;
}
