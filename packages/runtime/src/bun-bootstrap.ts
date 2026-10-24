// Run before instance selection or process-entry module side effects.
import { enforceBunVersion } from "../bin/bun-preflight.mjs";
enforceBunVersion();
