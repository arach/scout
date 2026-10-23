// Noise-secured pairing transport, shared by the pairing bridge (responder)
// and this machine's own local readers (initiator, see pairing-local-socket).
export { NoiseHandshake, generateKeyPair, type KeyPair, type NoiseSession, type HandshakePattern, type Role } from "./noise.js";
export { loadOrCreateIdentity, tryLoadIdentity, tryLoadIdentityPublicKeyHex, createQRPayload, validateQRPayload, saveTrustedPeer, refreshTrustedPeer, isTrustedPeer, loadTrustedPeers, bytesToHex, hexToBytes, type QRPayload, type TrustedPeer } from "./identity.js";
export { SecureTransport, type SecureTransportEvents, type SecureTransportReadyInfo, type SocketLike } from "./transport.js";
