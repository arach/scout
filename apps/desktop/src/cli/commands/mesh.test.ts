import { expect, test } from "bun:test";
import { createScoutCommandContext } from "../context.ts";
import { runMeshCommand } from "./mesh.ts";

test("mesh help explains dormant hosts, --all and explicit-name access", async () => {
  const lines: string[] = [];
  const context = createScoutCommandContext({ env: {}, stdout: line => lines.push(line) });
  await runMeshCommand(context, ["--help"]);
  const help = lines.join("\n");
  expect(help).toContain("Hosts unseen for 7 days are dormant: hidden from status, doctor and nodes.");
  expect(help).toContain("Add --all to include them. A dormant host still answers to its name.");
});
