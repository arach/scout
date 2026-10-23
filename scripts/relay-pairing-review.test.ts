import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = ["T-WINDOW-TRUSTED", "T-WINDOW-DISRUPT", "T-REVOKED-RESOLVE", "T-RESOLVE-PAIRING-ROOM"];
for (const flavor of ["web", "desktop"]) for (const id of cases) {
  test(`${id} (${flavor})`, async () => {
    const root = mkdtempSync(join(tmpdir(), "relay-pairing-review-"));
    const home = join(root, "home"), pairing = join(root, "pairing");
    mkdirSync(home, {mode: 0o700}); mkdirSync(pairing, {mode: 0o700});
    const child = Bun.spawn([process.execPath, "scripts/relay-pairing-review-worker.ts", flavor, id], {
      cwd: process.cwd(), env: {...process.env, HOME: home, OPENSCOUT_PAIRING_HOME: pairing},
      stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [code, out, err] = await Promise.all([child.exited,
        new Response(child.stdout).text(), new Response(child.stderr).text()]);
      console.log(out); if (code !== 0) console.error(err);
      expect(code).toBe(0); // Fixture success is separate from the behavior oracle.
      const line = out.split("\n").find(text => text.startsWith("REVIEW_OBSERVATION "));
      expect(line).toBeDefined();
      const observed = JSON.parse(line!.slice("REVIEW_OBSERVATION ".length));
      if (id === "T-WINDOW-TRUSTED") {
        expect(observed.newPhoneAdmitted, "new phone can pair after trusted resolve/reconnect").toBe(true);
      } else if (id === "T-WINDOW-DISRUPT") {
        expect(observed.rpcAfterWindowOpen, "existing relay session still answers after window opens").toBe(true);
      } else if (id === "T-REVOKED-RESOLVE") {
        expect(observed.revokedPhoneTrusted, "resolve/retry cannot regrant a revoked phone").toBe(false);
        expect(observed.revokedClose).toBe(4003);
        expect(observed.intendedPhoneAdmitted).toBe(true);
      } else {
        expect(observed.resolvedRoom, "resolve must not publish the QR pairing room").not.toBe(observed.qrRoom);
      }
    } finally {
      clearTimeout(timeout); child.kill(); await child.exited;
      rmSync(root, {recursive: true, force: true});
    }
  }, 15_000);
}
