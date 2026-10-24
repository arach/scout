/** Test-only caller contexts: real migrated owner and real Noise admission.
 * Display flags alone are never used to mint transport authority. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransportDomain } from "../../packages/runtime/src/pairing-security/transport.ts";
import { bytesToHex } from "../../packages/runtime/src/pairing-security/identity.ts";
import { capsuleFixture } from "./pairing-capsule.ts";
import { fixtureHost, generateKeyPair, liveTransport } from "./live-transport.ts";

/** One isolated durable store per test file. Each caller still gets its own
 * domain and Noise handshake, and each resolver reads current authority. */
export function pairedRouterFixture() {
  const root = mkdtempSync(join(tmpdir(), "pairing-capsule-router-"));
  const domains = new Set<TransportDomain>();
  const dispose = () => {
    try { for (const domain of domains) domain.dispose(); }
    finally { domains.clear(); rmSync(root, { recursive: true, force: true }); }
  };
  try {
    const host = generateKeyPair(), phone = generateKeyPair();
    const key = bytesToHex(phone.publicKey);
    const { owner } = capsuleFixture(root, {
      generations: 2, keys: 1, publicKeys: [key], migrate: true,
    });
    return {
      bind<T extends { bridge: object }>(context: T, options: { local?: boolean } = {}) {
        const domain = new TransportDomain(context.bridge, bytesToHex(host.publicKey), owner);
        domains.add(domain);
        const close = () => { try { domain.dispose(); } finally { domains.delete(domain); } };
        try {
          fixtureHost(domain, host);
          const peer = liveTransport(domain, options.local ? host : phone, options);
          const ctx = peer.server.bindContext({
            deviceId: key.slice(0, 16), secureTransport: true, trustedPeer: true, ...context,
          });
          return { ctx, dispose: close };
        } catch (error) { close(); throw error; }
      },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
