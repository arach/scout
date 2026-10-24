// Keep byte-identical to packages/cli/bin/bun-preflight.mjs: both packages
// ship standalone launchers, before workspace dependencies can be loaded.
export const MINIMUM_BUN_VERSION = "1.4.0";

export function supportedBunVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[^\s]+)?$/.exec(version ?? "");
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 1 || major === 1 && minor >= 4;
}

export function bunVersionError(version = process.versions.bun) {
  return version !== undefined && !supportedBunVersion(version)
    ? `Scout requires Bun ${MINIMUM_BUN_VERSION} or newer; installed: ${version}. Upgrade: bun upgrade`
    : null;
}

export function enforceBunVersion() {
  const error = bunVersionError();
  if (error) {
    console.error(error);
    process.exit(1);
  }
}
