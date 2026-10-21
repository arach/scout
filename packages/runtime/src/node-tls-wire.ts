import { createHash } from "node:crypto";
import { X509Certificate } from "@peculiar/x509";

/** The §11.2 pin: SHA-256 hex of a SubjectPublicKeyInfo DER. */
export function tlsSpkiFingerprintFromDer(spkiDer: Buffer): string {
  return createHash("sha256").update(spkiDer).digest("hex");
}

/**
 * The §11.2 pin computed from a peer's *certificate* DER — the form the
 * pinning client (§11.4) observes on the wire. The pin is over the
 * SubjectPublicKeyInfo, not the certificate, so re-issuance never moves it.
 */
export function tlsSpkiFingerprintFromCertificateDer(certificateDer: Buffer): string {
  const certificate = new X509Certificate(asBufferSource(certificateDer));
  return tlsSpkiFingerprintFromDer(Buffer.from(certificate.publicKey.rawData));
}


function asBufferSource(der: Buffer): Uint8Array<ArrayBuffer> { return new Uint8Array(der); }
