/** Dormant production facade. Transport qualification is NOT product authorization.
 * The trusted Bun host must keep SIGPIPE ignored from before channel allocation
 * until every endpoint closes. The shim checks and refuses any other disposition
 * before allocation; it never changes process-global signal policy. Host/native
 * code must not reset SIGPIPE while any channel is active.
 * Darwin: exclude foreign native fork/exec during the create/mark interval.
 * Linux: pipe2/SOCK_CLOEXEC creation is atomic. These are trusted-host constraints,
 * not same-user isolation. The adapter is the sole closer of each raw endpoint.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { createExtensionChannelCandidate } from "./extension-channel-io.js";
import { currentExtensionChannelCoordinate, EXTENSION_CHANNEL_QUALIFICATION as Q } from "./extension-channel-qualification.js";

function unavailable(): never { throw new Error("extension_channel_host_unavailable"); }
function bytes(url: URL, maximum: number): Buffer {
  const stat = lstatSync(url);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) unavailable();
  const data = readFileSync(url); if (data.length > maximum) unavailable(); return data;
}
function hash(data: Uint8Array) { return createHash("sha256").update(data).digest("hex"); }
/** Fixed paths only. No environment/CLI loader override or checkout-HEAD lookup.
 * A source build verifies the reviewed blobs. Emitted builds additionally bind
 * every channel module and C asset to the build record before native loading.
 * Trusted-build integrity is not confinement against a same-user code editor. */
export function verifyExtensionChannelHostAssets(): void {
  try {
    if (import.meta.url.endsWith(".ts")) {
      if (hash(bytes(new URL("./extension-channel-io.ts", import.meta.url), 128 * 1024)) !== Q.adapter
        || hash(bytes(new URL("./extension-channel-native.c", import.meta.url), 128 * 1024)) !== Q.shim) unavailable();
      return;
    }
    const record = JSON.parse(bytes(new URL("./extension-channel-artifact.json", import.meta.url), 16384).toString());
    const files = import.meta.url.endsWith(".mjs") ? ["extension-channel-host.mjs", "extension-channel-native.c"]
      : ["extension-channel-host.js", "extension-channel-io.js", "extension-channel-qualification.js", "inherited-descriptors.js", "extension-channel-native.c"];
    if (record.schema !== "scout.extension-channel-artifact/v1" || record.ruling !== Q.ruling
      || record.adapter !== Q.adapter || record.shim !== Q.shim || record.version !== Q.version || record.revision !== Q.revision
      || JSON.stringify(record.platforms) !== JSON.stringify(["darwin-arm64", "linux-glibc-x64"])
      || !record.files || Object.keys(record.files).sort().join() !== files.slice().sort().join()) unavailable();
    for (const file of files) if (hash(bytes(new URL(`./${file}`, import.meta.url), 1024 * 1024)) !== record.files[file]) unavailable();
    if (record.files["extension-channel-native.c"] !== Q.shim) unavailable();
  } catch { unavailable(); }
}
/** Both checks are synchronous; no await between qualification and allocation.
 * Numeric source is borrowed by spawn, then source.close() runs before await.
 * No FileHandle, Socket, stream, Bun.file, raw-close API or evidence hook escapes.
 */
export function allocateExtensionChannel(form: "context" | "credential") {
  if (!currentExtensionChannelCoordinate()) unavailable();
  verifyExtensionChannelHostAssets();
  const pair = createExtensionChannelCandidate(form);
  return {parent: pair.parent, source: pair.child, target: pair.target};
}
