import { scoutDiscoveryEnv } from "./discovery-env.ts";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { findScoutCommandRegistration, listScoutPrimaryCommands, SCOUT_GLOBAL_FLAGS, SCOUT_COMMAND_GLOBAL_FLAGS } from "./registry.ts";
import { scoutGrammarFlags } from "./command-help.ts";
import { findScoutExtension, listScoutExtensions, scoutExtensionEnv, SCOUT_COMPLETION_WORD, type ScoutExtension } from "./extensions.ts";
import type { ScoutCommandGrammar } from "./registry-grammar.ts";

export const SCOUT_COMPLETION_TIMEOUT_MS = 500;
const MAX_OUTPUT = 16 * 1024;
const MAX_WORDS = 256;

/** Optional trusted extension hook. No shell, no stdin, no secret Scout environment. */
export async function completeScoutExtension(extension: ScoutExtension, words: string[], env: NodeJS.ProcessEnv, cliVersion: string): Promise<string[]> {
  // A caller holding an earlier result cannot bypass revocation or an update.
  const current = findScoutExtension(extension.name, env);
  if (!current || current.refused) return [];
  if (!current.complete) return current.completion ?? [];
  if (words.length > 64 || words.some(w => w.length > 2048 || w.includes("\0"))) return [];
  return new Promise(resolve => {
    let output = Buffer.alloc(0), finished = false;
    const child = spawn(current.complete!, words, { shell: false, detached: process.platform !== "win32",
      cwd: join(current.root, current.name),
      env: scoutExtensionEnv({ env, extension: current, cliVersion, outputMode: "plain", brokerUrl: env.OPENSCOUT_BROKER_URL?.trim() ?? "" }),
      stdio: ["ignore", "pipe", "ignore"] });
    const stop = () => {
      // Completion is short-lived: also fence descendants that inherited its pipe.
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {}
    };
    const finish = (result: string[]) => {
      if (finished) return;
      finished = true; clearTimeout(timer); stop(); child.stdout?.destroy(); resolve(result);
    };
    const timer = setTimeout(() => finish([]), SCOUT_COMPLETION_TIMEOUT_MS);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (output.length + chunk.length > MAX_OUTPUT) finish([]);
      else output = Buffer.concat([output, chunk]);
    });
    child.once("error", () => finish([]));
    // `close` waits for the pipe's last bytes; the deadline still bounds a stranded pipe.
    child.once("close", code => {
      const suggestions = output.toString("utf8").split(/\r?\n/).filter(Boolean);
      finish(code === 0 && suggestions.length <= MAX_WORDS && suggestions.every(w => SCOUT_COMPLETION_WORD.test(w)) ? suggestions : []);
    });
  });
}

/** `words` excludes scout; cursor is zero-based and includes the possibly empty current token. */
export async function scoutCompletionCandidates(words: string[], cursor: number, env: NodeJS.ProcessEnv = process.env, cliVersion = "unknown"): Promise<string[]> {
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= words.length || words.length > 64
    || words.some(w => w.length > 2048 || /[\0\r\n]/.test(w))) return [];
  words = words.slice(0, cursor + 1);
  const prefix = words.pop()!;
  let grammar: ScoutCommandGrammar | undefined;
  let command: string | undefined, expectValue: string | undefined, positional = false, helpMode = false;
  let flags = scoutGrammarFlags(SCOUT_GLOBAL_FLAGS);
  for (const word of words) {
    if (expectValue) {
      if (expectValue === "--instance") env = scoutDiscoveryEnv(env, word);
      expectValue = undefined; continue;
    }
    if (word === "--") { positional = true; continue; }
    if (!positional && word.startsWith("-")) {
      const flag = [...flags].reverse().find(f => f.name === word.split("=")[0]);
      if (flag?.takesValue && !word.includes("=")) expectValue = flag.name;
      if (word.startsWith("--instance=")) env = scoutDiscoveryEnv(env, word.slice("--instance=".length));
      continue;
    }
    if (!command) {
      // `relay` remains the CLI's compatibility namespace.
      if (word === "relay") continue;
      if (word === "help") { helpMode = true; flags.push(...scoutGrammarFlags("--detail")); continue; }
      command = word;
      const registration = findScoutCommandRegistration(command);
      if (!registration || registration.provider === "extension") {
        const extension = findScoutExtension(command, env);
        if (helpMode || !extension || extension.refused) return [];
        const offset = words.indexOf(word) + 1;
        return filterCandidates(await completeScoutExtension(extension, [...words.slice(offset), prefix], env, cliVersion), prefix);
      }
      grammar = registration.grammar;
      flags = [...scoutGrammarFlags(SCOUT_COMMAND_GLOBAL_FLAGS), ...scoutGrammarFlags(grammar?.flags ?? "")];
      continue;
    }
    const child: ScoutCommandGrammar | undefined = grammar?.subcommands?.[word];
    grammar = child;
    if (child) flags = [...flags, ...scoutGrammarFlags(child.flags)];
  }
  if (positional) return [];
  if (expectValue || prefix.includes("=")) return []; // No dynamic identities, paths, credentials or network lookups.
  if (!command) return filterCandidates([
    ...listScoutPrimaryCommands().map(c => c.name),
    ...listScoutExtensions(env).filter(e => !e.refused && (!findScoutCommandRegistration(e.name) || findScoutCommandRegistration(e.name)?.provider === "extension")).map(e => e.name),
    ...flags.map(f => f.name),
  ], prefix);
  // Help can name any command without importing its implementation.
  const children = Object.keys(grammar?.subcommands ?? {});
  return filterCandidates(prefix.startsWith("-") ? flags.map(f => f.name) : [...children, ...flags.map(f => f.name)], prefix);
}
function filterCandidates(values: string[], prefix: string): string[] {
  return [...new Set(values)].filter(w => SCOUT_COMPLETION_WORD.test(w) && w.startsWith(prefix)).sort().slice(0, MAX_WORDS);
}

/** Shells pass tokens as argv and consume lines as data. Never eval hook output. */
export function renderScoutCompletion(shell: string): string {
  const header = "# Scout completion: live command registry + installed API-1 manifests.\n";
  if (shell === "bash") return header + `# Source this file in bash (3.2 or newer).
_scout() {
  local item
  COMPREPLY=()
  while IFS= read -r item; do
    [[ -n "$item" ]] && COMPREPLY+=("$item")
  done < <(command scout completion --query "$((COMP_CWORD - 1))" -- "\${COMP_WORDS[@]:1}" 2>/dev/null)
}
complete -F _scout scout
`;
  if (shell === "zsh") return header + `# Source this file after compinit.
_scout() {
  local -a candidates
  candidates=("\${(@f)$(command scout completion --query "$((CURRENT - 2))" -- "\${words[@]:1}" 2>/dev/null)}")
  (( \${#candidates} )) && compadd -- "\${candidates[@]}"
}
compdef _scout scout
`;
  if (shell === "fish") return header + `function __scout_complete
  set -l words (commandline -opc)
  set -e words[1]
  set -l current (commandline -ct)
  command scout completion --query (count $words) -- $words "$current" 2>/dev/null
end
complete -c scout -f -a '(__scout_complete)'
`;
  throw new Error("usage: scout completion zsh|bash|fish");
}
