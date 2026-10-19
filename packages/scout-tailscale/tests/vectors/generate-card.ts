// Regenerates node-card-v1.json from the runtime's own card signer, so the
// Python verifier is tested against the TypeScript canonical JSON.
//   bun packages/scout-tailscale/tests/vectors/generate-card.ts > packages/scout-tailscale/tests/vectors/node-card-v1.json
import { createPrivateKey, createPublicKey } from "node:crypto";
import { buildSignedNodeCard, verifySignedNodeCard } from "../../../runtime/src/node-identity.ts";

const seed = Buffer.alloc(32);
for (let i = 0; i < 32; i++) seed[i] = 0x40 + i;
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const publicKey = createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }))
  .export({ format: "der", type: "spki" }).toString("base64");
const identity = { version: 1, publicKey, privateKey: pkcs8.toString("base64"), createdAt: 0 } as never;
const issuedAt = 1_800_000_000_000;
const card = buildSignedNodeCard(identity, {
  nodeId: "mini-7f3k",
  label: "Mini ✓ café \"quoted\"",
  version: "0.2.107",
  capabilities: ["invoke", "agents"],
  endpoints: ["https://mini.tail0000.ts.net:43111", "https://100.64.0.7:43111"],
  tls: { spkiFingerprint: "b".repeat(64) },
}, issuedAt);
if (!verifySignedNodeCard(card, issuedAt + 1)) throw new Error("runtime rejected its own card");
console.log(JSON.stringify({
  description: "Signed node card from runtime buildSignedNodeCard. Deterministic test key; never use outside tests.",
  verifiedAt: issuedAt + 1,
  card,
}, null, 2));
