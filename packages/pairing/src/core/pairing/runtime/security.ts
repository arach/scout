import { loadTrustedPeers } from "./security/index.ts";

export * from "./security/index.ts";

export type PairingQrPayload = import("./security.ts").QRPayload;

export { createQRPayload as createQrPayload } from "./security.ts";

export function trustedPeerCount() {
  return loadTrustedPeers().size;
}
