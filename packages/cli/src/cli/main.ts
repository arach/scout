import { ScoutCommandUnavailableError, renderScoutCommandUnavailable } from "./command-unavailable.ts";
import { runScoutDiscovery } from "./discovery.ts";
import { SCOUT_APP_VERSION } from "../lib/shared/product.ts";
import { applyInstanceFlag, preflightLifecycle } from "../../bin/lifecycle-preflight.mjs";
import {
  applyOpenScoutInstanceEnvironment,
  assertOpenScoutInstanceIsolation,
  selectCliOpenScoutInstance,
  selectStatuslineOpenScoutInstance,
} from "@openscout/runtime/instance";

// Service imports can initialize local state, so load them only after help and
// lifecycle validation have completed, including when running from source.
try {
  // `scout --instance <name>` / OPENSCOUT_INSTANCE picks the target instance:
  // its broker port, socket, homes and identity. Materialize it before any
  // service module reads env, and refuse a non-prod instance that would reach
  // prod (for example an inherited OPENSCOUT_BROKER_URL on 43110).
  if (await runScoutDiscovery(process.argv.slice(2), SCOUT_APP_VERSION)) {
    // Discovery is read-only and must not bootstrap runtime services.
  } else {
    applyInstanceFlag(process);
    if (process.argv[2] === "statusline") {
      // The Claude statusline targets prod unless asked otherwise.
      selectStatuslineOpenScoutInstance(process.env);
    } else {
      // Explicit --instance / OPENSCOUT_INSTANCE, else the client pointer a
      // Scout terminal or agent was launched with, else prod.
      selectCliOpenScoutInstance(process.env);
    }
    applyOpenScoutInstanceEnvironment(process.env);
    assertOpenScoutInstanceIsolation("scout");
    const help = preflightLifecycle(process.argv.slice(2));
    if (help !== null) console.log(help);
    else await import("./main-dispatch.ts");
  }
} catch (error) {
  if (error instanceof ScoutCommandUnavailableError) {
    if (process.argv.includes("--json")) {
      process.stderr.write(JSON.stringify(error.toJSON()) + "\n");
    } else {
      console.error(renderScoutCommandUnavailable(error, false));
    }
    process.exit(error.exitCode);
  }
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
