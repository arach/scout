import { INSTALL_HELP, SETUP_HELP, UP_HELP, renderAppCommandHelp } from "../../bin/lifecycle-preflight.mjs";
import { findScoutCommandRegistration, SCOUT_COMMANDS, SCOUT_GLOBAL_FLAGS, SCOUT_COMMAND_GLOBAL_FLAGS, unknownScoutCommandMessage } from "./registry.ts";
import type { ScoutCommandGrammar } from "./registry-grammar.ts";
import { findScoutExtension, listScoutExtensions, readScoutExtensionDocs } from "./extensions.ts";

export type ScoutHelpFlag = { name: string; takesValue: boolean };
export function scoutGrammarFlags(spec: string): ScoutHelpFlag[] {
  return spec.split(/\s+/).filter(Boolean).map(token => ({ name: token.replace(/=$/, ""), takesValue: token.endsWith("=") }));
}
function grammarView(grammar: ScoutCommandGrammar): { flags: ScoutHelpFlag[]; subcommands: Record<string, ReturnType<typeof grammarView>> } {
  return { flags: scoutGrammarFlags(grammar.flags), subcommands: Object.fromEntries(
    Object.entries(grammar.subcommands ?? {}).map(([name, child]) => [name, grammarView(child)])) };
}

/** Data-only help. In particular, neither extension commands nor completion hooks run here. */
export function scoutCommandHelp(path: string[], version: string, env: NodeJS.ProcessEnv = process.env) {
  const name = path[0];
  if (!name) return { schemaVersion: 1, version, globalFlags: scoutGrammarFlags(SCOUT_GLOBAL_FLAGS), commands: [
    ...SCOUT_COMMANDS.filter(c => !c.hidden).map(c => ({ name: c.name, summary: c.summary, provider: c.provider ?? "builtin" })),
    ...listScoutExtensions(env).filter(e => !e.refused && !findScoutCommandRegistration(e.name)).map(e => ({ name: e.name, summary: e.summary ?? "", provider: "extension" })),
  ] };
  const registration = findScoutCommandRegistration(name);
  if (!registration || registration.provider === "extension") {
    const extension = findScoutExtension(name, env);
    if (extension?.refused) throw new Error(extension.refused);
    if (extension) {
      if (path.length > 1) throw new Error("extension help is provided for the verb; consult its Markdown for subcommands");
      const markdown = readScoutExtensionDocs(extension, env) ?? `scout ${name} — ${extension.summary ?? "Installed extension"}\n\nThis extension ships no Markdown help. Try scout ${name} --help.`;
      return { schemaVersion: 1, version, name, provider: "extension", summary: extension.summary ?? "", markdown,
        extensionVersion: extension.version ?? null, globalFlags: scoutGrammarFlags(SCOUT_COMMAND_GLOBAL_FLAGS),
        completion: extension.complete ? { kind: "executable" } : { kind: "static", words: extension.completion ?? [] } };
    }
    if (!registration) throw new Error(unknownScoutCommandMessage(name, version));
  }
  let grammar = registration!.grammar ?? { flags: "" };
  let flags = [...scoutGrammarFlags(SCOUT_COMMAND_GLOBAL_FLAGS), ...scoutGrammarFlags(grammar.flags)];
  for (const part of path.slice(1)) {
    const child = grammar.subcommands?.[part];
    if (!child) throw new Error(`unknown subcommand: scout ${path.join(" ")}`);
    grammar = child;
    flags.push(...scoutGrammarFlags(grammar.flags));
  }
  const tree = grammarView(grammar);
  flags = [...new Map(flags.map(flag => [flag.name, flag])).values()];
  const usage = `scout ${path.join(" ")}${Object.keys(tree.subcommands).length ? " <subcommand>" : ""} [options]`;
  const lifecycleMarkdown: Record<string, string> = { app: renderAppCommandHelp(), install: INSTALL_HELP, setup: SETUP_HELP, up: UP_HELP };
  const markdown = lifecycleMarkdown[name] ?? [`Usage: ${usage}`, "", registration!.summary,
    ...(flags.length ? ["", "Flags:", ...flags.map(flag => `  ${flag.name}${flag.takesValue ? " <value>" : ""}`)] : []),
    ...(Object.keys(tree.subcommands).length ? ["", "Subcommands:", ...Object.keys(tree.subcommands).map(child => `  ${child}`)] : []),
    "", `Detailed usage and examples: scout ${name} --help`,
  ].join("\n");
  return { schemaVersion: 1, version, name, path, provider: "builtin", summary: registration!.summary, usage,
    flags, subcommands: tree.subcommands, markdown };
}
