import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  findPublishDependencyFailures, PUBLISHED_WORKSPACE_PACKAGES,
} from "./check-packed-manifests.mjs";

// Independent reviewed fixture: do not derive expected install bytes from the
// source package being audited, which is how M0's dependency regression escaped.
const dependencies = {
  "@lydell/node-pty": "1.2.0-beta.12",
  "bonjour-service": "^1.4.4",
  "picomatch": "^4.0.4",
  "reflect-metadata": "0.2.2",
  "ws": "^8.18.3",
};
const scout = (extra = {}) => ({ name: "@openscout/scout", version: "0.3.9", dependencies: { ...dependencies }, ...extra });

test("the reviewed five Scout install dependencies pass exactly", () => {
  assert.deepEqual(findPublishDependencyFailures(scout()), []);
});

test("a normalized unpublished workspace dependency is rejected, not just workspace: syntax", () => {
  const failures = findPublishDependencyFailures(scout({ dependencies: { ...dependencies, "@openscout/runtime": "0.3.9" } }));
  assert.ok(failures.some((x) => x.includes("@openscout/runtime=0.3.9") && x.includes("outside the publish set")));
});

test("all seven M0 build inputs are refused as packed install dependencies", () => {
  for (const name of ["@modelcontextprotocol/core", "@modelcontextprotocol/sdk", "@modelcontextprotocol/server", "@openscout/protocol", "@openscout/runtime", "@trpc/client", "zod"]) {
    assert.ok(findPublishDependencyFailures(scout({ dependencies: { ...dependencies, [name]: "0.3.9" } })).some((x) => x.includes(`dependencies.${name}=`)), name);
  }
});

test("reviewed dependency ranges cannot drift or hide npm aliases", () => {
  for (const range of ["^99.0.0", "npm:@openscout/runtime@0.3.9", "workspace:*"]) {
    assert.ok(findPublishDependencyFailures(scout({ dependencies: { ...dependencies, ws: range } })).length > 0);
  }
});

test("missing install dependencies and invalid dependency maps fail closed", () => {
  const missing = { ...dependencies }; delete missing.ws;
  for (const deps of [missing, null, undefined, [], "ws"]) {
    assert.ok(findPublishDependencyFailures(scout({ dependencies: deps })).length > 0);
  }
});

test("optional, peer and bundled dependency paths cannot bypass the review list", () => {
  for (const [section, value] of [
    ["optionalDependencies", { "@openscout/runtime": "0.3.9" }],
    ["peerDependencies", { "@openscout/runtime": "0.3.9" }],
    ["bundleDependencies", ["@openscout/runtime"]],
    ["bundledDependencies", true],
  ]) assert.ok(findPublishDependencyFailures(scout({ [section]: value })).some((x) => x.includes(section)));
});

test("development-only build inputs are not runtime install dependencies", () => {
  assert.deepEqual(findPublishDependencyFailures(scout({ devDependencies: { "@openscout/runtime": "0.3.9", zod: "4.4.3" } })), []);
  assert.deepEqual(findPublishDependencyFailures({ name: "@openscout/protocol", dependencies: {} }), []);
});

test("the diagnostic publish set agrees with ship-npm.sh", () => {
  const script = readFileSync(new URL("./ship-npm.sh", import.meta.url), "utf8");
  const directories = /PUBLISH_PACKAGES=\(([^)]+)\)/.exec(script)[1].trim().split(/\s+/);
  const names = directories.map((dir) => JSON.parse(readFileSync(new URL(`../packages/${dir}/package.json`, import.meta.url), "utf8")).name);
  assert.deepEqual([...PUBLISHED_WORKSPACE_PACKAGES].sort(), names.sort());
});

test("both manifest-only and full archive audits inspect the packed manifest, not checkout dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "scout-packed-deps-"));
  try {
    mkdirSync(join(root, "package"));
    const tarball = join(root, "candidate.tgz");
    const script = new URL("./check-packed-manifests.mjs", import.meta.url).pathname;
    const pack = (manifest) => {
      writeFileSync(join(root, "package/package.json"), JSON.stringify(manifest));
      const result = spawnSync("tar", ["-czf", tarball, "-C", root, "package"], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    pack(scout({ dependencies: { ...dependencies, "@openscout/runtime": "0.3.9" } }));
    for (const mode of ["--publish-dependencies", "--tarball"]) {
      const result = spawnSync(process.execPath, [script, mode, tarball], { encoding: "utf8" });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /@openscout\/runtime=0\.3\.9.*outside the publish set/);
    }
    pack(scout());
    const result = spawnSync(process.execPath, [script, "--publish-dependencies", tarball], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /manifest-only; not a full archive audit/);
    assert.ok(!result.stdout.includes("@openscout/runtime"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
