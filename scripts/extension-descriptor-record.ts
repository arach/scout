/** Explicit diagnostic only. A green record never qualifies this rejected mechanism. */
import { runDescriptorReclaimWitness, type DescriptorForm } from "../packages/cli/src/cli/extension-descriptor-witness.ts";
if (Bun.revision !== "0d9b296af33f2b851fcbf4df3e9ec89751734ba4") throw Error("record requires the exact rejected 1.3.14 revision");
const form = process.argv[2];
if (form !== "context" && form !== "credential") throw Error("choose context or credential");
console.log(JSON.stringify({ event: "runtime", version: Bun.version, revision: Bun.revision, platform: process.platform, qualification: "withdrawn" }));
try { await runDescriptorReclaimWitness({ form: form as DescriptorForm, mechanism: "node-extra-record", emit: event => console.log(JSON.stringify(event)) }); }
catch (error) { console.error(String(error)); process.exitCode = 1; }
