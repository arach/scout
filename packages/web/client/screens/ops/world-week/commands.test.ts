import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BY_ID, CMD_LINE, COMMANDS, GROUPS, KEYMAP, KEY_CONFLICTS, bindLine, keyLookup, keySig, paletteRows, parseLine, sheetRows, stripFor } from "./commands.ts";

// the engine's handler table, read from its source: every registry id must have one, and nothing else may
const ENGINE = readFileSync(join(import.meta.dir, "engine.ts"), "utf8");
const block = ENGINE.slice(ENGINE.indexOf("const HANDLERS = {"), ENGINE.indexOf("/* /handlers */"));
const HANDLED = [...block.matchAll(/^  ([a-z]+): \(/gm)].map(m => m[1]);

describe("the registry", () => {
  test("ids are unique, every entry has a group, a syntax, a description and a handler", () => {
    expect(new Set(COMMANDS.map(c => c.id)).size).toBe(COMMANDS.length);
    expect(HANDLED.length).toBeGreaterThan(40);
    for (const c of COMMANDS) {
      expect(GROUPS).toContain(c.group);
      expect(c.desc.length).toBeGreaterThan(10);
      expect(c.syntax.startsWith(":" + c.names[0])).toBe(true);
      expect(HANDLED).toContain(c.id);
    }
    expect(HANDLED.filter(id => !BY_ID[id])).toEqual([]);
  });
  test("verbs and aliases are unique across commands", () => {
    const names = COMMANDS.flatMap(c => c.names);
    expect(new Set(names).size).toBe(names.length);
  });
  test("no two bindings share a key in one scope", () => {
    expect(KEY_CONFLICTS).toEqual([]);
  });
  test("every key is a : line the grammar accepts", () => {
    for (const c of COMMANDS) for (const b of c.keys || []) expect(CMD_LINE.test(bindLine(c, b))).toBe(true);
  });
  test("every argument completion is a valid line (or a prefix waiting for a name)", () => {
    for (const c of COMMANDS) for (const a of c.args || []) {
      const line = `${c.names[0]} ${a}`;
      if (!a.endsWith(" ")) expect({ line, ok: CMD_LINE.test(line) }).toEqual({ line, ok: true });
    }
  });
  test("the grammar keeps the old lines and leaves words alone", () => {
    for (const line of ["goto wed 14:00", "g -2d", "speed 1h/s", "window 4h", "errors off", "stuck 10m", "tally inline", "theme paper", "accent default",
      "find devon", "lane all", "open worktree ca13", "cam save top", "tour the-week", "fly cam top", "chatter off", "zero", "q", "i", "preview"])
      expect({ line, ok: CMD_LINE.test(line) }).toEqual({ line, ok: true });
    for (const words of ["show me errors", "back two hours", "zero in on devon", "what's broken", "go to wednesday"])
      expect({ words, ok: CMD_LINE.test(words) }).toEqual({ words, ok: false });
  });
  test(":chatter is a command now (it used to fall through to the resolver as words)", () => {
    expect(parseLine("chatter off")?.cmd.id).toBe("chatter");
  });
});

describe("keys", () => {
  test("the innermost scope wins, and a key reaches global when no panel binds it", () => {
    expect(keyLookup("h", ["w", "global"])?.cmd.id).toBe("slice");
    expect(keyLookup("h", ["global"])?.cmd.id).toBe("focus");
    expect(keyLookup("]", ["work", "global"])?.cmd.id).toBe("linked");
    expect(keyLookup("]", ["global"])?.cmd.id).toBe("window");
    expect(keyLookup("n", ["c", "global"])?.cmd.id).toBe("trouble");
    expect(keyLookup("0", ["c", "global"])?.cmd.id).toBe("lane");
  });
  test("keySig: shift is spelled for named keys only", () => {
    expect(keySig({ key: "N", shiftKey: true })).toBe("N");
    expect(keySig({ key: "ArrowLeft", shiftKey: true })).toBe("S-ArrowLeft");
    expect(keySig({ key: "Tab", shiftKey: true })).toBe("S-Tab");
    expect(KEYMAP.global!["S-Tab"]!.cmd.id).toBe("focus");
  });
  test("the footer shows about eight essentials in GLOBAL and the panel's own keys when focused", () => {
    const g = stripFor(["global"]);
    expect(g.length).toBeGreaterThanOrEqual(6);
    expect(g.length).toBeLessThanOrEqual(9);
    const c = stripFor(["c", "global"]).map(([, w]) => w);
    expect(c).toContain("remove");
    expect(c).toContain("lane");
  });
});

describe("palette and sheet derive from the registry", () => {
  test("nothing typed lists recent lines, then every group", () => {
    const rows = paletteRows("", { recent: ["window 4h"] });
    expect(rows[0]).toMatchObject({ kind: "recent", line: "window 4h" });
    expect(rows.filter(r => r.kind === "group").map(r => r.group)).toEqual([...GROUPS]);
  });
  test("a verb prefix fuzzy-matches, with its description and key", () => {
    const rows = paletteRows("wi");
    expect(rows[0]).toMatchObject({ kind: "cmd", line: "window", strong: true });
    expect(rows[0]!.keys).toContain("1–6");
    expect(paletteRows("err")[0]!.line).toBe("errors");
  });
  test("a verb and a space offers its arguments", () => {
    expect(paletteRows("window ").map(r => r.line)).toEqual(["window live", "window 5m", "window 30m", "window 4h", "window 24h", "window all", "window wider", "window narrower", "window off"]);
    expect(paletteRows("theme e").map(r => r.line)[0]).toBe("theme ember");
    expect(paletteRows("find ")[0]!.kind).toBe("hint");
  });
  test("words that aren't a verb list nothing (they go to the resolver)", () => {
    expect(paletteRows("show me errors")).toEqual([]);
  });
  test("the sheet covers every command, grouped, and search narrows it", () => {
    const all = sheetRows("");
    expect(all.reduce((a, g) => a + g.rows.length, 0)).toBe(COMMANDS.length);
    expect(all.map(g => g.group)).toEqual(GROUPS.filter(g => COMMANDS.some(c => c.group === g)));
    const stuck = sheetRows("stuck").flatMap(g => g.rows.map(r => r.id));
    expect(stuck).toContain("stuck");
    expect(stuck).toContain("trouble");
    expect(stuck.length).toBeLessThan(8);
  });
  test("the engine no longer carries hand-written key text", () => {
    expect(ENGINE).not.toContain("const KEYS = {");
    expect(ENGINE).not.toContain("function globalKey");
  });
});
