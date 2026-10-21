// Build the same fixture/assertions for Node; replace only the test runner.
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(packageRoot, "node_modules/.cache/remote-tail-tests");
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/remote-tail.test.ts")],
  outdir, naming: "remote-tail.test.mjs", target: "node", format: "esm",
  packages: "external",
  plugins: [{
    name: "node-test-runner",
    setup(build) {
      build.onLoad({ filter: /remote-tail\.test\.ts$/ }, async ({ path }) => ({
        contents: (await Bun.file(path).text()).replace('from "bun:test"', 'from "node:test"'),
        loader: "ts",
      }));
    },
  }],
});
if (!result.success) throw new AggregateError(result.logs, "Remote tail Node test build failed.");
console.log(resolve(outdir, "remote-tail.test.mjs"));
