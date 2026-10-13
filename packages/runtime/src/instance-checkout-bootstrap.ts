// Side-effect module for entrypoints a developer runs from a source checkout
// (`bun packages/runtime/src/broker-daemon.ts`, the pairing controller). An
// unset OPENSCOUT_INSTANCE defaults to `dev` (main checkout) or
// `dev-<worktree folder>` (linked worktree), so a checkout never lands on the
// installed prod instance. Supervised service processes and published
// packages are untouched. Import FIRST, before any other module.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyCheckoutOpenScoutInstanceDefault,
  applyOpenScoutInstanceEnvironment,
  type ApplyOpenScoutInstanceResult,
} from "./instance.js";

export const openScoutCheckoutInstanceDefault: string | null = applyCheckoutOpenScoutInstanceDefault(
  dirname(fileURLToPath(import.meta.url)),
);
export const openScoutInstanceBootstrap: ApplyOpenScoutInstanceResult = applyOpenScoutInstanceEnvironment(process.env);
