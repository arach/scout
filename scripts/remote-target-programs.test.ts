import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../packages/cli/src/cli/commands/update.ts", import.meta.url), "utf8");
const registry = readFileSync(new URL("./remote-target-programs.md", import.meta.url), "utf8");
const declarations = ["REMOTE_RUNTIME_STATUS_JS", "REMOTE_RUNTIME_STATUS_SHELL"];

// Explicitly named declarations only. Do not inspect/evaluate string contents
// or claim discovery of encoded sync operations. This is not a fence allowance.
function declarationDigest(text: string): string {
  const tree = ts.createSourceFile("update.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statements = declarations.map(name => {
    const matches = tree.statements.filter(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name));
    if (matches.length !== 1) throw Error(`Expected one declaration for ${name}`);
    return matches[0]!.getText(tree);
  });
  return createHash("sha256").update(statements.join("\n")).digest("hex");
}

function checkEntry(text: string, document: string): void {
  const sections = document.split(/^## /m).filter(section => section.startsWith("update-runtime-status\n"));
  if (sections.length !== 1) throw Error("Expected one update-runtime-status registry entry");
  const digests = [...sections[0]!.matchAll(/^Declaration SHA-256: `([a-f0-9]{64})`$/gm)];
  if (digests.length !== 1) throw Error("Expected one declaration digest");
  if (declarationDigest(text) !== digests[0]![1]) {
    throw Error("update-runtime-status changed: review the program and update its registry entry");
  }
}

test("the named target program and wrapper match the documentation registry", () => {
  expect(() => checkEntry(source, registry)).not.toThrow();
});

for (const [before, after] of [
  ['.spawnSync("openscout-runtime"', '.spawnSync("unreviewed-runtime"'],
  ["command -v node || command -v bun", "command -v unreviewed-interpreter"],
]) test(`an unregistered change to ${before} fails the named check`, () => {
  const changed = source.replace(before!, after!);
  expect(changed).not.toBe(source);
  expect(() => checkEntry(changed, registry)).toThrow("update-runtime-status changed");
});

test("removing or duplicating the registry entry fails the named check", () => {
  expect(() => checkEntry(source, registry.replace("## update-runtime-status\n", "## removed\n")))
    .toThrow("Expected one update-runtime-status registry entry");
  expect(() => checkEntry(source, registry + "\n## update-runtime-status\n"))
    .toThrow("Expected one update-runtime-status registry entry");
});

test("renaming or duplicating a named declaration fails the named check", () => {
  expect(() => checkEntry(source.replace("const REMOTE_RUNTIME_STATUS_JS =", "const RENAMED ="), registry))
    .toThrow("Expected one declaration for REMOTE_RUNTIME_STATUS_JS");
  expect(() => checkEntry(source + '\nconst REMOTE_RUNTIME_STATUS_JS = "duplicate";', registry))
    .toThrow("Expected one declaration for REMOTE_RUNTIME_STATUS_JS");
});
