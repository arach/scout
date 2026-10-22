/** Transport qualification only. Never authorizes a product capability. */
export const EXTENSION_CHANNEL_QUALIFICATION = Object.freeze({
  ruling: "fable-a-async-io-qualify/ffd214f2",
  head: "ffd214f22afd10e505d316d57634ef1111d0773b",
  version: "1.3.14", revision: "0d9b296af33f2b851fcbf4df3e9ec89751734ba4",
  adapter: "c09006358ff0c37c831da027fe417d09c4f8c0b194230a5901d85a4837e4e62f",
  shim: "6cb286471315213e7f5015a8fd1c0b2f38de2284b687a7c74d2f7c4e273437f0",
});
export type ExtensionChannelCoordinate = "darwin-arm64" | "linux-glibc-x64";
/** Pure predicate for refusal tests. Reports are read in memory, never written or logged. */
export function extensionChannelCoordinate(host: {
  version: unknown; revision: unknown; platform: unknown; arch: unknown; report: () => unknown;
}): ExtensionChannelCoordinate | null {
  if (host.version !== EXTENSION_CHANNEL_QUALIFICATION.version || host.revision !== EXTENSION_CHANNEL_QUALIFICATION.revision) return null;
  if (host.platform === "darwin" && host.arch === "arm64") return "darwin-arm64";
  if (host.platform !== "linux" || host.arch !== "x64") return null;
  try {
    const report = host.report() as {header?: {glibcVersionRuntime?: unknown}} | null;
    const version = report?.header?.glibcVersionRuntime;
    return typeof version === "string" && /^\d+\.\d+(?:\.\d+)?$/.test(version) ? "linux-glibc-x64" : null;
  } catch { return null; }
}
export function currentExtensionChannelCoordinate(): ExtensionChannelCoordinate | null {
  return extensionChannelCoordinate({version: typeof Bun === "undefined" ? null : Bun.version,
    revision: typeof Bun === "undefined" ? null : Bun.revision, platform: process.platform, arch: process.arch,
    report: () => process.report?.getReport()});
}
