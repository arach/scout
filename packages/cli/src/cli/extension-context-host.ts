/** API 1 is deliberately outside this new capability gate. */
export function scoutExtensionContextBackend(): boolean {
  // No qualified host. At exact 1.3.14 (0d9b296a) the native subprocess retains
  // ownership of a Node-wrapped extra pipe's number and closes it again at GC
  // after the wrapper's socket destroyed it — a measured double owner (macOS),
  // with the finalizer path in shared non-Windows source. A backend qualifies
  // only by passing the corrected reclaim witness with a single descriptor owner.
  return false;
}
