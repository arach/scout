import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "@openscout/runtime/inherited-descriptors";
import { scoutExtensionContextBackend } from "./extension-context-host.ts";

/** Capability witness only: no key, policy store, environment override or native mapping. */
test("runtime-owned credential slot is duplex and GC never closes an unrelated descriptor", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-credential-duplex-"));
  const unrelated = openSync(join(home, "unrelated"), "w");
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
      const slot = INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.credential;
      const stdio: Array<"pipe" | "ignore"> = Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore");
      stdio[1] = "pipe"; stdio[2] = "pipe"; stdio[slot] = "pipe";
      const script = `import{createReadStream,writeSync,fstatSync}from'node:fs';const fd=Number(process.argv[1]);try{writeSync(fd,'request\\n')}catch(e){console.error(e.code);process.exit(92)}let data='';try{for await(const part of createReadStream(null,{fd,autoClose:true}))data+=part;}catch(e){console.error(e.code);process.exit(93)}if(data!=='response\\n')process.exit(91);console.log('duplex-eof');`;
      const child = spawn(process.execPath, ["-e", script, String(slot)], { stdio, env: { HOME: home, PATH: process.env.PATH } });
      const closed = new Promise<number | null>(done => child.once("close", done));
      const channel = (child.stdio as unknown[])[slot] as Duplex | null;
      let output = "", errors = "";
      child.stdout?.on("data", chunk => output += chunk); child.stderr?.on("data", chunk => errors += chunk);
      const timer = setTimeout(() => {
        console.error(JSON.stringify({ witnessDeadline: true, exitCode: child.exitCode, signal: child.signalCode, output, errors, readable: channel?.readable, writable: channel?.writable }));
        channel?.destroy(); child.kill("SIGKILL");
      }, 5000);
      try {
        if (!scoutExtensionContextBackend()) {
          expect(channel).toBeNull(); child.kill("SIGKILL"); await closed;
        } else {
          expect(channel?.readable).toBe(true); expect(channel?.writable).toBe(true);
          let request = "";
          channel!.on("error", () => {});
          channel!.on("data", chunk => { request += chunk; if (request === "request\n") channel!.end("response\n", () => channel!.destroy()); });
          Bun.gc(true);
          const status = await closed; expect(errors).toBe(""); expect(status).toBe(0); expect(request).toBe("request\n"); expect(output.trim()).toBe("duplex-eof"); expect(errors).toBe("");
        }
      } finally {
        clearTimeout(timer); channel?.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await closed;
      }
      Bun.gc(true); await Bun.sleep(5); Bun.gc(true);
      expect(fstatSync(unrelated).isFile()).toBe(true);
    }
    console.error(JSON.stringify({ witness: "scout.credential-duplex/v1", version: Bun.version, revision: Bun.revision, platform: process.platform,
      qualified: scoutExtensionContextBackend(), iterations: 5, unrelatedDescriptorSurvived: true }));
  } finally { closeSync(unrelated); rmSync(home, { recursive: true, force: true }); }
}, 35_000);
