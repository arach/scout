import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { INHERITED_DESCRIPTOR_LAYOUTS, MAX_INHERITED_DESCRIPTOR_SLOT } from "@openscout/runtime/inherited-descriptors";
import { scoutExtensionContextBackend } from "./extension-context-host.ts";

/** Mirror foreground stdio, not auxiliary stdout pipes. Exit is the reap boundary. */
test("runtime-owned credential slot is duplex and GC never closes an unrelated descriptor", async () => {
  const home = mkdtempSync(join(tmpdir(), "scout-credential-duplex-"));
  const unrelated = openSync(join(home, "unrelated"), "w");
  const identity = fstatSync(unrelated); let completed = false;
  try {
    for (let iteration = 0; iteration < 5; iteration++) {
      const slot = INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.credential;
      const stdio: Array<"pipe" | "ignore" | "inherit"> = Array(MAX_INHERITED_DESCRIPTOR_SLOT + 1).fill("ignore");
      stdio[0] = stdio[1] = stdio[2] = "inherit"; stdio[slot] = "pipe";
      const script = `import{createReadStream,writeSync,fstatSync}from'node:fs';const fd=Number(process.argv[1]);try{writeSync(fd,'request\\n')}catch(e){console.error(JSON.stringify({phase:'request-write',fd,code:e.code}));process.exit(92)}let data='';try{for await(const part of createReadStream(null,{fd,autoClose:true}))data+=part;}catch(e){console.error(JSON.stringify({phase:'response-read',fd,code:e.code}));process.exit(93)}if(data!=='response\\n')process.exit(91);`;
      const child = spawn(process.execPath, ["-e", script, String(slot)], { stdio, env: { HOME: home, PATH: process.env.PATH } });
      const exited = new Promise<number | null>((done, reject) => { child.once("exit", done); child.once("error", reject); });
      const channel = (child.stdio as unknown[])[slot] as Duplex | null;
      let request = "", timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`duplex deadline: exit=${child.exitCode}, signal=${child.signalCode}, requestBytes=${request.length}`)), 5000); });
      try {
        if (!scoutExtensionContextBackend()) {
          expect(channel).toBeNull(); child.kill("SIGKILL"); await Promise.race([exited, deadline]);
        } else {
          expect(channel?.readable).toBe(true); expect(channel?.writable).toBe(true);
          channel!.on("error", () => {});
          channel!.on("data", chunk => { request += chunk; if (request === "request\n") channel!.end("response\n", () => channel!.destroy()); });
          Bun.gc(true);
          expect(await Promise.race([exited, deadline])).toBe(0); expect(request).toBe("request\n");
        }
      } finally {
        clearTimeout(timer); channel?.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await Promise.race([exited, Bun.sleep(1000).then(() => { if (child.exitCode === null && child.signalCode === null) throw new Error("owned witness child not reaped"); })]);
      }
      Bun.gc(true); await Bun.sleep(5); Bun.gc(true);
      const current = fstatSync(unrelated);
      expect(current.isFile()).toBe(true); expect(current.dev).toBe(identity.dev); expect(current.ino).toBe(identity.ino);
    }
    completed = true;
    console.error(JSON.stringify({ witness: "scout.credential-duplex/v1", version: Bun.version, revision: Bun.revision, platform: process.platform,
      qualified: scoutExtensionContextBackend(), iterations: 5, unrelatedDescriptorSurvived: true }));
  } finally {
    let lost = false;
    try { const current = fstatSync(unrelated); if (current.dev === identity.dev && current.ino === identity.ino) closeSync(unrelated); else lost = true; }
    catch { lost = true; }
    rmSync(home, { recursive: true, force: true });
    if (lost) { console.error("credential witness: unrelated descriptor ownership was lost"); if (completed) throw new Error("unrelated descriptor lost during final cleanup"); }
  }
}, 35_000);
