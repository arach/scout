import { runCoreBootstrap } from "./cli/core-bootstrap.ts";

try {
  if (!await runCoreBootstrap(process.argv.slice(2))) await import("./node-onboarding.ts");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
