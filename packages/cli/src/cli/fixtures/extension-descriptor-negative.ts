/** Deliberately corrupt ownership only in a disposable child, never the test runner. */
import { runDescriptorReclaimWitness } from "../extension-descriptor-witness.ts";
const [form, fault] = process.argv.slice(2);
if ((form !== "context" && form !== "credential") || (fault !== "stale-second-close" && fault !== "second-spawn-close")) throw Error("invalid negative control");
try { await runDescriptorReclaimWitness({ form, mechanism: "standard-control", fault }); }
catch (error) { console.log(JSON.stringify({ schema: "scout.descriptor-negative/v1", form, fault, failure: String(error) })); process.exitCode = 1; }
