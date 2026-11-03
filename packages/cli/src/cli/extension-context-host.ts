import { currentExtensionChannelCoordinate } from "@openscout/runtime/extension-channel-qualification";

/** Context-only activation. API 1 and credential input authority are unchanged.
 * A supported coordinate is necessary, not sufficient: the fixed host facade
 * rechecks the coordinate and approved asset bytes synchronously at allocation.
 * There is no environment/CLI opt-in or fallback to another transport.
 */
export function scoutExtensionContextBackend(): boolean {
  return currentExtensionChannelCoordinate() !== null;
}

/** Internal fixed resolver. No user flag or environment override can load code.
 * Source runs use the runtime sibling; installed CLI runs use a fixed sidecar.
 * Loading this module never opens the product gate or allocates a descriptor.
 */
export async function loadScoutExtensionChannelHost(): Promise<typeof import("@openscout/runtime/extension-channel-host")> {
  const location = import.meta.url.endsWith(".ts")
    ? new URL("../../../runtime/src/extension-channel-host.ts", import.meta.url)
    : new URL("./extension-channel-host.mjs", import.meta.url);
  return await import(location.href);
}
