import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import config from "../../../../dewey.config.ts";

test("Dewey index and llms include the canonical Extensions page", () => {
  const root = resolve(import.meta.dir, "../../../..");
  const read = (name: string) => readFileSync(resolve(root, name), "utf8");
  const markdown = read("docs/extensions.md");
  expect(markdown).toContain("title: Extensions"); expect(markdown).toContain("order: 3");
  expect(config.agent.sections).toContain("extensions"); expect(config.docs.required).toContain("extensions");
  expect(read("llms.txt")).toContain("Extensions: /docs/extensions");
  const section = JSON.parse(read("docs.json")).sections.find((s: { id: string }) => s.id === "extensions");
  expect(section.title).toBe("Extensions");
  expect(section.content).toBe(markdown.replace(/^---[\s\S]*?---\s*/, "").trim());
  for (const phrase of ["install", "update", "remove", "500 ms", "complete", "completion", "docs", "schemaVersion", "Custody decides origin"]) expect(section.content).toContain(phrase);
});
