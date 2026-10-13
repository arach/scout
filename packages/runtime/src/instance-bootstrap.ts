// Side-effect module: import FIRST in a process entrypoint so OPENSCOUT_INSTANCE
// is materialized into process.env before any other module evaluates its
// module-level paths, ports or identity. Children inherit the result.
//
// Entrypoints that run straight from a source checkout (broker daemon, pairing
// controller) import ./instance-checkout-bootstrap.js instead, which also
// defaults an unset OPENSCOUT_INSTANCE to `dev` / `dev-<worktree>`.

import { applyOpenScoutInstanceEnvironment, type ApplyOpenScoutInstanceResult } from "./instance.js";

export const openScoutInstanceBootstrap: ApplyOpenScoutInstanceResult = applyOpenScoutInstanceEnvironment(process.env);
