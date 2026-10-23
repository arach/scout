/** Test-only caller context: real migrated owner and real Noise admission.
 * Display flags alone are never used to mint transport authority. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransportDomain } from "../../packages/runtime/src/pairing-security/transport.ts";
import { bytesToHex } from "../../packages/runtime/src/pairing-security/identity.ts";
import { capsuleFixture } from "./pairing-capsule.ts";
import { fixtureHost, generateKeyPair, liveTransport } from "./live-transport.ts";

export function pairedRouterContext<T extends { bridge: object }>(context: T) {
  const root = mkdtempSync(join(tmpdir(), "pairing-capsule-router-"));
  let domain: TransportDomain | undefined;
  const dispose = () => {
    domain?.dispose();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const host = generateKeyPair(), phone = generateKeyPair();
    const key = bytesToHex(phone.publicKey);
    const { owner } = capsuleFixture(root, {
      generations: 2, keys: 1, publicKeys: [key], migrate: true,
    });
    domain = new TransportDomain(context.bridge, bytesToHex(host.publicKey), owner);
    fixtureHost(domain, host);
    const peer = liveTransport(domain, phone);
    const ctx = peer.server.bindContext({
      deviceId: key.slice(0, 16), secureTransport: true, trustedPeer: true, ...context,
    });
    return { ctx, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
