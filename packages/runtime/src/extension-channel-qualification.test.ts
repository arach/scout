import {expect, test} from "bun:test";
import {extensionChannelCoordinate, currentExtensionChannelCoordinate, EXTENSION_CHANNEL_QUALIFICATION as Q} from "./extension-channel-qualification.ts";
import {allocateExtensionChannel, verifyExtensionChannelHostAssets} from "./extension-channel-host.ts";
const host = {version: Q.version, revision: Q.revision, platform: "linux", arch: "x64", report: () => ({header:{glibcVersionRuntime:"2.39"}})};
test("exact runtime predicate requires full Bun revision and a positive libc identity", () => {
  expect(extensionChannelCoordinate(host)).toBe("linux-glibc-x64");
  for (const change of [{version:"1.3.13"}, {revision:Q.revision.slice(0,8)}, {revision:"other"}, {platform:"win32"}, {arch:"arm64"}]) expect(extensionChannelCoordinate({...host,...change})).toBeNull();
  expect(extensionChannelCoordinate({...host,platform:"darwin",arch:"arm64",report:()=>{throw Error("must not read Darwin report");}})).toBe("darwin-arm64");
});
for (const value of [null, {}, {header:{}}, {header:{glibcVersionRuntime:""}}, {header:{glibcVersionRuntime:"musl"}}, {header:{glibcVersionRuntime:2.39}}, {header:{glibcVersionRuntime:"2.39\n"}}]) test(`missing/malformed libc report refuses ${JSON.stringify(value)}`, () => {
  expect(extensionChannelCoordinate({...host,report:()=>value})).toBeNull();
});
test("report exception refuses without logging or fallback", () => {
  expect(extensionChannelCoordinate({...host,report:()=>{throw Error("private report");}})).toBeNull();
});
test("source asset hashes bind to the reviewed tuple", () => { expect(verifyExtensionChannelHostAssets).not.toThrow(); });
test("unsupported actual runtime refuses before compilation/allocation", () => {
  if (currentExtensionChannelCoordinate()) return;
  expect(()=>allocateExtensionChannel("context")).toThrow("extension_channel_host_unavailable");
});
test("real exact-revision glibc/musl measurements retain opposite detector outcomes", async () => {
  const measurements = await Bun.file(new URL("./test-helpers/extension-channel-hosts.json",import.meta.url)).json();
  for (const measured of measurements.hosts) {
    expect(measured.version).toBe(Q.version); expect(measured.revision).toBe(Q.revision);
    expect(extensionChannelCoordinate({...measured,report:()=>({header:measured.header})})).toBe(measured.expected);
  }
});
