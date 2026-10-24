import { expect, test } from "bun:test";
import { parseTmuxSessionList, parseZellijSessionList } from "./tmux.ts";

test("keeps delimiters inside tmux current paths", () => {
  expect(parseTmuxSessionList("dev|2|1|100|200|zsh|/workspace/foo|bar\n")).toEqual([
    { name: "dev", windows: 2, attached: 1, createdAt: 100, activityAt: 200, currentCommand: "zsh", currentPath: "/workspace/foo|bar" },
  ]);
});

test("parses colorized zellij session inventory", () => {
  expect(parseZellijSessionList(
    "\x1B[32;1mexample-session\x1B[m [Created \x1B[35;1m13h\x1B[m ago] (\x1B[31;1mEXITED\x1B[m - attach to resurrect)\n",
  )).toEqual([{
    name: "example-session",
    state: "exited",
    raw: "example-session [Created 13h ago] (EXITED - attach to resurrect)",
  }]);
});
