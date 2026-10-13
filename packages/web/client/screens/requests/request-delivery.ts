/**
 * Where a decision stands. A slow reply stays "sending" until it settles;
 * a refusal is the server's answer (4xx); anything else that fails (5xx,
 * network) may still have landed, so it is unconfirmed, never "failed".
 */
export type RequestDelivery =
  | { state: "sending"; label: string }
  | { state: "delivered"; label: string }
  | { state: "refused"; label: string; reason: string }
  | { state: "unconfirmed"; label: string };

export function failedDelivery(label: string, cause: unknown, fallback: string): RequestDelivery {
  const status = (cause as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { state: "refused", label, reason: cause instanceof Error && cause.message ? cause.message : fallback };
  }
  return { state: "unconfirmed", label };
}
