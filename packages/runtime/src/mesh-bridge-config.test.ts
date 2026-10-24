import { expect, test } from "bun:test";
import { validateMeshBridgeConfig } from "./mesh-bridge-config.js";

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
