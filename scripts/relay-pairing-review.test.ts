import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cases = ["T-WINDOW-TRUSTED", "T-WINDOW-DISRUPT", "T-REVOKED-RESOLVE", "T-RESOLVE-PAIRING-ROOM", "T-MULTI-PHONE", "T-RETIRED-ROOM", "T-QR-TRUSTED", "T-QR-REGRANT"];
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
        expect(observed.windowVisibleAfterReconnect).toBe(true);
        expect(observed.trustedReconnectChangedRevision).toBe(false);
      } else if (id === "T-WINDOW-DISRUPT") {
        expect(observed.rpcAfterWindowOpen, "existing relay session still answers after window opens").toBe(true);
      } else if (id === "T-REVOKED-RESOLVE") {
        expect(observed.revokedPhoneTrusted, "resolve/retry cannot regrant a revoked phone").toBe(false);
        expect(observed.revokedClose).toBe(4003);
        expect(observed.revokedRPC).toBe(false);
        expect(observed.windowVisibleAfterRetry).toBe(true);
        expect(observed.intendedPhoneAdmitted).toBe(true);
      } else if (id === "T-MULTI-PHONE") {
        expect(observed.secondPaired).toBe(true);
        expect(observed.firstStillOnline).toBe(true);
        expect(observed.firstClose).toBe(0);
        expect(observed.stableReconnectRoom).toBe(true);
        expect(observed.manifestReconnectRoom).toBe(observed.initialRoom);
        expect(observed.peers).toBe(2);
        expect(observed.windowClosed).toBe(true);
      } else if (id === "T-RETIRED-ROOM") {
        expect(observed.untrustedClose).toBe(4003);
        expect(observed.trustedNewConnectionClose).toBe(4003);
        expect(observed.currentRPC).toBe(true);
        expect(observed.survivesNextWindow).toBe(true);
        expect(observed.nextPhonePaired).toBe(true);
        expect(observed.activeUntilEmpty).toBe(true);
        expect(observed.bridgeLeftAfterLastDevice).toBe(true);
        expect(observed.windowClosed).toBe(true);
      } else if (id === "T-QR-TRUSTED" || id === "T-QR-REGRANT") {
        expect(observed.admitted).toBe(true);
        expect(observed.windowClosed).toBe(true);
        expect(observed.trusted).toBe(true);
        expect(observed.revisionChanged).toBe(id === "T-QR-REGRANT");
      } else {
        expect(observed.healthRoom).toBe(observed.resolvedRoom);
        expect(observed.pairingIndexed).toBe(false);
        expect(observed.resolvedRoom, "resolve must not publish the QR pairing room").not.toBe(observed.qrRoom);
      }
    } finally {
      clearTimeout(timeout); child.kill(); await child.exited;
      rmSync(root, {recursive: true, force: true});
    }
  }, 15_000);
}
