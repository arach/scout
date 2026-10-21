import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoutBlock, claudeAllowList, removeScoutBlock, runAgentGuide, scoutBlock } from "./agent-guide.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "scout-agents-md-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".git"));
  return dir;
}

describe("AGENTS.md block", () => {
  test("adds once, refreshes in place, removes cleanly", () => {
    const original = "# Repo rules\n\nUse bun.\n";
    const added = applyScoutBlock(original);
    expect(added.change).toBe("added");
    expect(added.text).toBe(`# Repo rules\n\nUse bun.\n\n${scoutBlock()}\n`);
    expect(applyScoutBlock(added.text)).toEqual({ text: added.text, change: "unchanged" });

    const stale = added.text.replace("## Scout", "## Scout (old)");
    expect(applyScoutBlock(stale)).toEqual({ text: added.text, change: "updated" });

    const removed = removeScoutBlock(added.text);
    expect(removed).toEqual({ text: original, change: "removed" });
    expect(removeScoutBlock(original).change).toBe("absent");
  });

  test("keeps text after the block when removing", () => {
    const text = `# Rules\n\n${scoutBlock()}\n\n## Later\nKeep me.\n`;
    expect(removeScoutBlock(text).text).toBe("# Rules\n\n## Later\nKeep me.\n");
  });

  test("removing leaves every byte outside the block alone", () => {
    const text = `\nUSER A\n\n\n\nUSER B\n\n${scoutBlock()}\n`;
    expect(removeScoutBlock(text).text).toBe("\nUSER A\n\n\n\nUSER B\n");
  });

  test("add then remove gives back the exact bytes", () => {
    for (const input of ["", "USER", "USER\n", "USER\n\n\n", "USER  \n", "\n\nA\n\n\nB"]) {
      expect(removeScoutBlock(applyScoutBlock(input).text).text).toBe(input);
    }
  });

  test("refuses a dangling AGENTS.md symlink instead of creating its target", () => {
    const dir = project();
    const home = mkdtempSync(join(tmpdir(), "scout-agents-md-home-"));
    dirs.push(home);
    symlinkSync(join(home, "AGENTS.md"), join(dir, "AGENTS.md"));
    expect(() => runAgentGuide({ directory: dir, homeDirectory: home })).toThrow("symlink");
    expect(existsSync(join(home, "AGENTS.md"))).toBe(false);
  });

  test("refuses a symlinked AGENTS.md, which could point at a home-level file", () => {
    const dir = project();
    const home = mkdtempSync(join(tmpdir(), "scout-agents-md-home-"));
    dirs.push(home);
    writeFileSync(join(home, "AGENTS.md"), "# Mine\n");
    symlinkSync(join(home, "AGENTS.md"), join(dir, "AGENTS.md"));
    expect(() => runAgentGuide({ directory: dir, homeDirectory: home })).toThrow("symlink");
    expect(readFileSync(join(home, "AGENTS.md"), "utf8")).toBe("# Mine\n");
  });

  test("writes the project's AGENTS.md, honours dry run, refuses home", () => {
    const dir = project();
    writeFileSync(join(dir, "AGENTS.md"), "# Rules\n");
    expect(runAgentGuide({ directory: dir, dryRun: true }).change).toBe("added");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# Rules\n");
    expect(runAgentGuide({ directory: dir }).change).toBe("added");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("scout ask --on <host>");
    expect(runAgentGuide({ directory: dir, remove: true }).change).toBe("removed");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# Rules\n");
    expect(() => runAgentGuide({ directory: dir, homeDirectory: dir })).toThrow("home-level");
  });

  test("the allow list is read-only tools only", () => {
    const allow = claudeAllowList();
    expect(allow).toContain("mcp__scout__hosts_list");
    expect(allow.some((entry) => /__(ask|messages_send|agents_start)$/.test(entry))).toBe(false);
  });
});
