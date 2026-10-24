import { expect, test } from "bun:test";
import { createScoutCommandContext } from "../context.ts";
import { renderPairCommandHelp, runPairCommand } from "./pair.ts";

test("pair help names the four host-local request operations", async () => {
  const lines:string[]=[];
  await runPairCommand(createScoutCommandContext({stdout:line=>lines.push(line)}),["--help"]);
  expect(lines.join("\n")).toBe(renderPairCommandHelp());
  for(const command of ["requests [list]","requests show <token>","requests approve <token>","requests deny <token>"]) {
    expect(lines.join("\n")).toContain(command);
  }
  expect(lines.join("\n")).toContain("host-local");
});

test("malformed request commands fail before opening state or starting pairing", async () => {
  for(const args of [["requests","approve"],["requests","deny","a","b"],["requests","unknown"]]) {
    await expect(runPairCommand(createScoutCommandContext(),args)).rejects.toThrow("Usage: scout pair");
  }
});
