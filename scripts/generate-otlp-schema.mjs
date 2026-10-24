import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = join(root, "packages/runtime/src/otlp");
const protoDir = join(target, "proto");
const revision = "8654ab7a5a43ca25fe8046e59dcd6935c3f76de0";
const repository = "open-telemetry/opentelemetry-proto";
const files = [
  "LICENSE",
  "opentelemetry/proto/common/v1/common.proto",
  "opentelemetry/proto/resource/v1/resource.proto",
  "opentelemetry/proto/trace/v1/trace.proto",
  "opentelemetry/proto/logs/v1/logs.proto",
  "opentelemetry/proto/metrics/v1/metrics.proto",
  "opentelemetry/proto/collector/trace/v1/trace_service.proto",
  "opentelemetry/proto/collector/logs/v1/logs_service.proto",
  "opentelemetry/proto/collector/metrics/v1/metrics_service.proto",
];
for (const file of files) {
  const path = join(protoDir, file);
  if (process.argv.includes("--fetch")) {
    const body = execFileSync("gh", ["api", `repos/${repository}/contents/${file}?ref=${revision}`, "-H", "Accept: application/vnd.github.raw+json"], { maxBuffer: 1024 * 1024 });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  } else {
    await readFile(path);
  }
}
const require = createRequire(join(root, "packages/runtime/package.json"));
const protobuf = require("protobufjs");
const schema = new protobuf.Root();
schema.resolvePath = (_origin, path) => isAbsolute(path) ? path : join(protoDir, path);
await schema.load(files.filter((file) => file.includes("/collector/")));
schema.resolveAll();
const descriptor = schema.toJSON();
function removeServices(namespace) {
  for (const [name, entry] of Object.entries(namespace.nested ?? {})) {
    if (entry.methods) delete namespace.nested[name];
    else removeServices(entry);
  }
}
removeServices(descriptor);
await writeFile(join(target, "schema.generated.ts"), `import type { INamespace } from "protobufjs";\n\nexport const otlpSchema: INamespace = ${JSON.stringify(descriptor, null, 2)};\n`);
await writeFile(join(protoDir, "provenance.json"), `${JSON.stringify({ repository, revision, tag: "v1.7.0", files, generator: "scripts/generate-otlp-schema.mjs", protobufjs: "7.6.6" }, null, 2)}\n`);
console.log("Generated pinned OTLP request/response schema");
