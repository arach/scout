import { describe, expect, test } from "bun:test";

import { createScoutCommandContext } from "../context.ts";
import { renderWhoCommandHelp, runWhoCommand } from "./who.ts";
import { parseWhoCommandOptions } from "../options.ts";

describe("who command help", () => {
  test("documents routing discovery and qualified handles", () => {
    const help = renderWhoCommandHelp();

    expect(help).toContain("List agents known to the broker");
    expect(help).toContain("exact target");
    expect(help).toContain("Short handles");
    expect(help).toContain("@talkie#codex?5.5");
    expect(help).toContain("--machine <name>");
  });

  test("parses machine and context root together and rejects missing or unknown flags", () => {
    expect(parseWhoCommandOptions(["--machine", "mini", "--context-root", "/work"], "/tmp")).toMatchObject({ machine: "mini", currentDirectory: "/work" });
    expect(parseWhoCommandOptions(["--machine=node-1"], "/tmp").machine).toBe("node-1");
    for (const args of [["--machine"], ["--machine="], ["--machine", "--since"], ["--topic", "hello"]]) {
      expect(() => parseWhoCommandOptions(args, "/tmp")).toThrow();
    }
  });

  test("prints help before broker access", async () => {
    const lines: string[] = [];
    const context = createScoutCommandContext({
      cwd: "/tmp/openscout-test",
      env: {},
      stdout: (line) => lines.push(line),
      stderr: () => undefined,
      isTty: false,
    });

    await runWhoCommand(context, ["--help"]);

    expect(lines.join("\n")).toContain("Usage: scout who");
  });
});
