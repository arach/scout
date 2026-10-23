import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const cases: Record<string, Record<string, unknown>> = {
  "A-KEYED": {approvalStatus: 200, deliveredStatus: 302, wrongRPC: false, wrongClose: 4003, remainsOpen: true,
    paired: true, closed: true, replayStatus: 410, noQR: true},
  "A-LEGACY": {approvalStatus: 200, paired: true, secondRPC: false, secondClose: 4003, consumed: true, replayStatus: 410},
  "A-PRIVATE": {privacy: true, privateUnindexed: true, resolvePrivate: false, healthPrivate: false, resolveStable: true, healthStable: true,
    qrUnchanged: true, otherStatus: 302, otherOwnRoom: true, distinctRequests: true, ownPayload: true},
  "A-AUTHORITY": {revokedRPC: false, revokedClose: 4003, revokedTrusted: false, invalidated: true},
  "A-COEXIST": {independent: true, firstConsumed: true, firstPaired: true, otherSurvivesTrustedAdmission: true,
    qrPaired: true, secondSurvivesQR: true, secondPaired: true, authorityCancelsThird: true},
  "A-DELIVERY": {deniedClosed: true, requestNotQR: true, denied: 403, deniedLocation: null, expired: 410, expiredLocation: null,
    pending: 202, pendingLocation: null, live: 302, replay: 410, replayLocation: null},
  "A-STARTUP-AUTHORITY": {approvalStatus: 503, noPayload: true, regranted: false, trusted: false},
  "A-RACE": {denialStatus: 200, lateApprovalStatus: 409, closed: true, poll: 403},
  "A-RETRY": {afterCleanupStatus: 409, sameRoom: true, sameId: true, sameDeadline: true, reopenStatus: 409, cancelled: true},
  "A-LOCAL-AUTH": {errorCode: -32001, noRoom: true, remainsOpen: true},
  "A-HEADER": {normalized: true, prefixStatus: 400, notRedisclosed: true},
  "A-EXPIRY": {expired: true},
  "A-CANCEL-FIRST": {opened: false, noGrant: true},
  "A-SPENT-POLL": {statuses: [410, 410, 410, 410, 410], spent: true, noTouch: true, noLocation: true,
    expiredBodies: true, textStatus: 410, textExpired: true, unknownStatus: 202, restartStatus: 202, restartNoRoom: true},
};
for (const flavor of ["web", "desktop"]) for (const [id, expected] of Object.entries(cases)) {
  test(`${id} (${flavor})`, async () => {
    const root = mkdtempSync(join(tmpdir(), "approval-pairing-"));
    const home = join(root, "home"), pairing = join(root, "pairing");
    mkdirSync(home, {mode: 0o700}); mkdirSync(pairing, {mode: 0o700});
    const child = Bun.spawn([process.execPath, "scripts/approval-pairing-worker.ts", flavor, id], {
      cwd: process.cwd(), env: {...process.env, HOME: home, OPENSCOUT_PAIRING_HOME: pairing}, stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 12000);
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      console.log(out); if (code !== 0) console.error(err);
      expect(code).toBe(0);
      const line = out.split("\n").find(text => text.startsWith("APPROVAL_OBSERVATION "));
      expect(line).toBeDefined();
      const observed = JSON.parse(line!.slice("APPROVAL_OBSERVATION ".length));
      for (const [key, value] of Object.entries(expected)) expect(observed[key], `${id}: ${key}`).toEqual(value);
    } finally { clearTimeout(timeout); child.kill(); await child.exited; rmSync(root, {recursive: true, force: true}); }
  }, 15000);
}
