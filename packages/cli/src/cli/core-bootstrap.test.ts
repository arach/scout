import { expect, test } from "bun:test";
import { coreBootstrapInput, runCoreBootstrap } from "./core-bootstrap.ts";

test.each([
  { argv: ["--instance", "dev", "runtimes", "--json"] },
  { argv: ["runtimes", "--instance=dev", "--json"] },
  { argv: ["--json", "relay", "runtimes", "--instance", "dev"] },
])("early runtime selection removes global instance flags without leaking them to the handler: %j", ({ argv }) => {
  expect(coreBootstrapInput([...argv])).toMatchObject({ outputMode: "json", args: (argv as readonly string[]).includes("relay") ? ["runtimes"] : [] });
});
test("version takes precedence and unrelated custody commands do not enter this slice", async () => {
  expect(coreBootstrapInput(["--version", "runtimes"])).toBeNull();
  for (const command of ["setup", "doctor", "stop", "uninstall", "update", "mcp"]) {
    expect(coreBootstrapInput([command])).toBeNull(); expect(await runCoreBootstrap([command])).toBe(false);
  }
});
test("context-root, help and output grammar remain shared with the regular handler", () => {
  expect(coreBootstrapInput(["--help", "runtimes", "--context-root", "/tmp/example"])).toMatchObject({ helpRequested: true, args: ["--context-root", "/tmp/example"] });
});
