/** A per-call trusted hook. Never keep an admitted result or copy it into config. */
export class EffectAdmissionRefusal extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EffectAdmissionRefusal";
  }
}
export function admitEffect(beforeEffect?: () => void): void {
  try {
    const result: unknown = beforeEffect?.();
    if (result && (typeof result === "object" || typeof result === "function")
      && typeof (result as { then?: unknown }).then === "function") {
      throw new Error("synchronous effect admission required");
    }
  } catch (cause) { throw cause instanceof EffectAdmissionRefusal ? cause : new EffectAdmissionRefusal(cause); }
}
export function rethrowEffectRefusal(error: unknown): never {
  throw error instanceof EffectAdmissionRefusal ? error.cause : error;
}
