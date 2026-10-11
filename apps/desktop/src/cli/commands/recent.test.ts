import { describe, expect, test } from "bun:test";
import { parseScoutArgv } from "../argv.ts";
import { createScoutCommandContext } from "../context.ts";
import { findScoutCommandRegistration } from "../registry.ts";
import { loadScoutCommandHandler } from "./index.ts";
import { parseRecentCommandOptions, runRecentCommand } from "./recent.ts";

describe("recent command", () => {
  test("registers a real command, handles global JSON, and parses duration/machine", async () => {
    expect(findScoutCommandRegistration("recent")?.name).toBe("recent");
    expect(await loadScoutCommandHandler("recent")).toBe(runRecentCommand);
    const input = parseScoutArgv(["recent", "--machine", "mini", "--since=2h", "--json"]);
    expect(input.outputMode).toBe("json");
    expect(parseRecentCommandOptions(input.args, 1_800_000_000_000)).toEqual({ machine: "mini", since: 1_800_000_000_000 - 7_200_000 });
    expect(parseRecentCommandOptions([])).toEqual({});
    expect(parseRecentCommandOptions(["work", "on", "hex"])).toEqual({ topic: "work on hex" });
    expect(parseRecentCommandOptions(["--", "--help"])).toEqual({ topic: "--help" });
    expect(findScoutCommandRegistration("check")?.name).toBe("check");
    expect(findScoutCommandRegistration("recent")?.canonicalName).toBe("check");
  });
  test("accepts topic text and flags and finite positive durations", () => {
    for (const args of [["--topic", "hex"], ["--topic=hex"], ["--machine"], ["--machine="], ["--since", "--machine"], ["--since", "today"], ["--since", "0h"], ["--since=-2h"], ["--since=999999999999999999999999999d"]]) {
      expect(() => parseRecentCommandOptions(args)).toThrow();
    }
    expect(parseRecentCommandOptions(["--since", "1.5h"], 1_800_000_000_000).since).toBe(1_800_000_000_000 - 5_400_000);
  });
  test("help needs no broker and does not advertise topic as an option", async () => {
    const lines: string[] = [];
    const context = createScoutCommandContext({ stdout: (line) => lines.push(line), env: {}, cwd: "/tmp" });
    await runRecentCommand(context, ["--help"]);
    expect(lines.join("\n")).toContain("Usage: scout check");
    expect(lines.join("\n")).toContain("no timestamp");
    expect(lines.join("\n")).not.toContain("--topic");
  });
});
