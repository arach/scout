import { describe, expect, test } from "bun:test";

import { expandTemplate, parseCommandFile, readGlassSettings, SET_KEYS } from "./glass-config.ts";

describe("glass command files", () => {
  test("frontmatter and body make a say command", () => {
    const parsed = parseCommandFile("review", "---\nhint: review the pick\nto: @claude\n---\n/review {selection}\n");
    expect(parsed).toEqual({
      name: "review",
      hint: "review the pick",
      to: "@claude",
      say: "/review {selection}",
      run: undefined,
      source: "commands/review.md",
    });
  });

  test("a bare body goes to Scoutbot, hinted by its first line", () => {
    const parsed = parseCommandFile("standup", "Give me a standup for {args}");
    expect(parsed).toMatchObject({ to: "scoutbot", hint: "Give me a standup for {args}", say: "Give me a standup for {args}" });
  });

  test("run: makes a macro", () => {
    expect(parseCommandFile("t", "---\nrun: go terminals\n---\n")).toMatchObject({ run: "go terminals", say: undefined });
  });

  test("built-ins can't be shadowed and names are checked", () => {
    expect(parseCommandFile("quit", "bye")).toBe("commands/quit.md: :quit is built in");
    expect(parseCommandFile("Bad Name", "x")).toContain("lowercase");
    expect(parseCommandFile("empty", "---\nhint: x\n---\n")).toContain("needs a message body");
  });
});

describe("glass settings", () => {
  test("reads config, aliases and both kinds of command, reporting problems", () => {
    const settings = readGlassSettings({
      config: {
        ink: "lacquer",
        font: { size: 14 },
        start: "@hudson",
        aliases: { t: "go terminals", q: "nope" },
        commands: { standup: { hint: "standup", say: "standup for {args}" }, review: { say: "dup" } },
      },
      commands: [{ name: "review", text: "/review {selection}" }],
      paths: { config: "/c.json", commands: "/cmds" },
    });
    expect(settings.ink).toBe("lacquer");
    expect(settings.fontSize).toBe(14);
    expect(settings.start).toBe("@hudson");
    expect(settings.aliases).toEqual({ t: "go terminals" });
    expect(settings.commands.map((c) => c.name)).toEqual(["review", "standup"]);
    expect(settings.errors).toEqual([
      "aliases.q: :q is built in",
      "config.json commands.review: :review is defined twice",
    ]);
    expect(settings.paths).toEqual({ config: "/c.json", commands: "/cmds" });
  });

  test("nothing injected means defaults", () => {
    expect(readGlassSettings(undefined)).toMatchObject({ ink: "scout", fontSize: 13, start: "scoutbot", commands: [], errors: [] });
  });

  test("templates and :set values", () => {
    expect(expandTemplate("/review {selection} in {conversation} {args}", { args: "now", selection: "the pick", conversation: "c1" }))
      .toBe("/review the pick in c1 now");
    expect(SET_KEYS.tint!.parse("0.5")).toBe(0.5);
    expect(SET_KEYS.tint!.parse("2")).toBeNull();
    expect(SET_KEYS.material!.parse("liquid")).toBe("liquid");
  });
});
