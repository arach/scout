import { expect, test } from "bun:test";
import { parseLocateOptions, runLocateCommand } from "./locate.ts";
import { loadScoutCommandHandler } from "./index.ts";
import { shouldEnsureBrokerUptodateForCommand } from "../uptodate.ts";

test("locate parses scope and literal clues and never triggers a broker restart", async () => {
  expect(await loadScoutCommandHandler("locate")).toBe(runLocateCommand);
  expect(shouldEnsureBrokerUptodateForCommand("locate")).toBe(false);
  expect(parseLocateOptions(["permissions", "--machine=mini", "--project", "/scout", "--agent", "a"])).toEqual({ query: "permissions", machine: "mini", projectRoot: "/scout", agentId: "a" });
  expect(parseLocateOptions(["--", "--help"])).toEqual({ query: "--help" });
  expect(() => parseLocateOptions(["--machine"])).toThrow("Missing value");
  expect(() => parseLocateOptions(["--unknown", "x"])).toThrow("Unexpected");
  expect(() => parseLocateOptions([])).toThrow("Provide recipient");
});
