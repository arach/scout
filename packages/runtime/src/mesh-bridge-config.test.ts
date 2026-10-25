import { DEFAULT_OPENSCOUT_MESH_RELAY_URL, DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL } from "@openscout/protocol";
import { expect, test } from "bun:test";
import { isMeshBridgeCredentialAudience, validateMeshBridgeConfig } from "./mesh-bridge-config.js";

test("one bridge policy validates exact token, keychain, fixed-path and issuer boundaries", () => {
  const support = "/tmp/bridge-policy-fixture";
  const valid = { relayUrl: "https://issuer.example.test", token: "a".repeat(8192), tokenKeychainService: "A".repeat(128), tokenFile: `${support}/mcp-bridge.token` };
  expect(validateMeshBridgeConfig(valid, support).relayOrigin).toBe("https://issuer.example.test");
  for (const field of [
    { token: "a".repeat(8193) }, { token: "" }, { token: "trailing\n" }, { token: "with space" }, { token: "with\nnewline" }, { token: null },
    { tokenKeychainService: "A".repeat(129) }, { tokenKeychainService: "1invalid" }, { tokenKeychainService: "with space" }, { tokenKeychainService: "Valid\n" },
    { tokenFile: "/tmp/arbitrary-file" }, { tokenFile: "" }, { tokenFile: false },
    { relayUrl: "http://issuer.example.test" }, { relayUrl: "https://issuer.example.test/path" },
    { relayUrl: "https://issuer.example.test?query" }, { relayUrl: "https://issuer.example.test#fragment" },
    { relayUrl: "https://user:password@issuer.example.test" }, { dir: "/tmp/other" },
  ]) expect(() => validateMeshBridgeConfig({ ...valid, ...field }, support)).toThrow();
  for (const relayUrl of ["http://127.0.0.1:43199", "http://localhost:43199", "http://[::1]:43199"]) {
    expect(validateMeshBridgeConfig({ ...valid, relayUrl }, support).relayOrigin).toBe(relayUrl);
  }
  expect(() => validateMeshBridgeConfig({ ...valid, relayUrl: "http://localhost.example.test" }, support)).toThrow();
});

test("issuer audience is exact, closed and secure, with no loopback pair exception", () => {
  const allowed = (relay: string, destination: string) => isMeshBridgeCredentialAudience(new URL(relay), new URL(destination));
  expect(allowed(DEFAULT_OPENSCOUT_MESH_RELAY_URL, DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL)).toBe(true);
  expect(allowed("https://self.example.test", "https://self.example.test/path")).toBe(true);
  expect(allowed("http://127.0.0.1:43199", "http://127.0.0.1:43199")).toBe(true);
  for (const [relay, destination] of [
    [DEFAULT_OPENSCOUT_MESH_RELAY_URL, "https://other.example.test"],
    ["https://other.example.test", DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL],
    [DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL, DEFAULT_OPENSCOUT_MESH_RELAY_URL],
    [DEFAULT_OPENSCOUT_MESH_RELAY_URL, `${DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL}:444`],
    [DEFAULT_OPENSCOUT_MESH_RELAY_URL.replace("https:", "http:"), DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL.replace("https:", "http:")],
    ["http://127.0.0.1:43199", "http://localhost:43199"],
    ["http://127.0.0.1:43199", "http://127.0.0.1:43200"],
    ["http://127.0.0.1:43199", DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL],
    ["https://user:secret@self.example.test", "https://self.example.test"],
    ["https://self.example.test", "https://user:secret@self.example.test"],
  ]) expect(allowed(relay!, destination!)).toBe(false);
});
