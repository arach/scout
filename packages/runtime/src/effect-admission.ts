/** Trusted local hook, never deserialized authority. Do not retain a positive
 * result: invoke again at each protected submission after an async boundary. */
export function admitSynchronousEffect(beforeEffect?: () => void): void {
  const result: unknown = beforeEffect?.();
  if (result && (typeof result === "object" || typeof result === "function")
    && typeof (result as { then?: unknown }).then === "function") {
    throw new Error("synchronous effect admission required");
  }
}
