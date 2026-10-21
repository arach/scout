import { describe, expect, test } from "bun:test";
import { parseScoutArgv } from "../argv.ts";
import { createScoutCommandContext } from "../context.ts";
import { shouldEnsureBrokerUptodateForCommand } from "../uptodate.ts";
import { findScoutCommandRegistration } from "../registry.ts";
import { loadScoutCommandHandler } from "./index.ts";
import { parseRouteCommand, runRouteCommand } from "./route.ts";

describe("route command", () => {
  test("registered, JSON global flag, no automatic broker maintenance", async () => {
    expect(findScoutCommandRegistration("where")?.name).toBe("where");
    expect(findScoutCommandRegistration("route")).toMatchObject({ canonicalName: "where", hidden: true, status: "deprecated" });
    expect(await loadScoutCommandHandler("where")).toBe(runRouteCommand);
    expect(await loadScoutCommandHandler("route")).toBe(runRouteCommand);
    const input = parseScoutArgv(["route", "render queue", "--machine=mini", "--kind", "project", "--json", "--explain"]);
    expect(input.outputMode).toBe("json");
    expect(parseRouteCommand(input.args)).toEqual({ command: "query", query: "render queue", options: { machine: "mini", kind: "project", explain: true } });
    expect(shouldEnsureBrokerUptodateForCommand("route", ["index"])).toBe(false);
  });
  test("strict parser and subcommand escape", () => {
    expect(parseRouteCommand(["--", "index"]).query).toBe("index");
    expect(parseRouteCommand(["index", "--full"]).options.full).toBe(true);
    expect(parseRouteCommand(["status"]).command).toBe("status");
    for (const args of [[], ["status", "--full"], ["index", "topic"], ["query", "--kind=work"], ["query", "--machine"], ["feedback", "topic"]]) {
      expect(() => parseRouteCommand(args)).toThrow();
    }
  });
  test("help never contacts broker", async () => {
    const output: string[] = [];
    await runRouteCommand(createScoutCommandContext({ stdout: (s) => output.push(s) }), ["--help"]);
    expect(output.join("\n")).toContain("does not dispatch");
    expect(output.join("\n")).toContain("index [--full]");
  });
});
