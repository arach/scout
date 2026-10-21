/** Shared execution-policy metadata checks. Callers stat the selected file or
 * path component; only ancestors explicitly passed with allowSticky can use
 * the sticky-folder exception. Strict paths require getuid rather than guessing. */
export function untrustedPathMetadata(
  path: string,
  info: { uid: number; mode: number },
  allowSticky = false,
): string | undefined {
  if (!allowSticky) {
    const uid = process.getuid?.();
    if (uid === undefined || (info.uid !== uid && info.uid !== 0)) {
      return `${path} is not owned by the current user or root`;
    }
  }
  const mode = info.mode;
  if ((mode & 0o002) === 0 || (allowSticky && (mode & 0o1000) !== 0)) return undefined;
  return `anyone on this machine can write to ${path}`;
}
